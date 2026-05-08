// ============================================================
// NAVAL COMBAT — Встроенная аудио-сводка в админ-панели
// ============================================================
(function initAdminAudioInline() {
  var REFRESH_MS = 1000;
  var DETAILS_ID = "adminAudioInlineBody";
  var _inlineAutoCleanupRunning = false;
  var LS_OPEN_KEY = "mb_admin_audio_inline_open_v1";

  function esc(val) {
    if (typeof escHtml === "function") return escHtml(val);
    return String(val == null ? "" : val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function bytesFmt(bytes) {
    if (typeof fmtBytes === "function") return fmtBytes(bytes);
    var b = Number(bytes || 0);
    if (!isFinite(b)) return "—";
    if (b < 1024) return b + " Б";
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " КБ";
    return (b / (1024 * 1024)).toFixed(2) + " МБ";
  }

  function renderSection(title, rows) {
    var html = '<div class="mon-section"><div class="mon-section-title">' + esc(title) + '</div><table class="mon-table">';
    (rows || []).forEach(function (row) {
      if (!row) return;
      html += '<tr><td class="mon-key">' + esc(row.k) + '</td><td class="mon-val">' + row.v + "</td></tr>";
    });
    return html + "</table></div>";
  }

  function getAudioCommonRows(volumePct) {
    var as = (typeof audioState !== "undefined" && audioState) ? audioState : null;
    var enabled = !!(as && as.enabled);
    var unlocked = !!(as && as.unlocked);
    var queueLen = as && as.queue ? as.queue.length : 0;
    var queuePlaying = !!(as && as.queuePlaying);
    var pct = Math.max(0, Math.min(100, Number(volumePct || 0)));
    var volCtl = '<span class="mon-limit-control">'
      + '<button type="button" class="mon-limit-btn" data-inline-role="audio-volume" data-delta="-5" title="Уменьшить громкость">−</button>'
      + '<input type="text" class="mon-limit-input" id="adminInlineAudioVolumeInput" value="' + pct + '" readonly aria-readonly="true">'
      + '<button type="button" class="mon-limit-btn" data-inline-role="audio-volume" data-delta="5" title="Увеличить громкость">+</button>'
      + "</span> <span class=\"mon-dim\">%</span>";

    return [
      { k: "Звук", v: enabled ? '<span class="mon-green">ВКЛ</span>' : '<span class="mon-red">ВЫКЛ</span>' },
      { k: "Разблокирован", v: unlocked ? '<span class="mon-green">ДА</span>' : '<span class="mon-red">НЕТ</span>' },
      { k: "Громкость", v: volCtl },
      { k: "Очередь", v: queueLen + (queuePlaying ? " (воспроизводится)" : " (пусто)") }
    ];
  }

  function collectIosBufferData() {
    var ae = (typeof audioEngine !== "undefined" && audioEngine) ? audioEngine : null;
    if (!ae) return null;
    var keys = Object.keys(ae.buffers || {});
    var pcmBytes = 0;
    keys.forEach(function (src) {
      var buf = ae.buffers[src];
      if (!buf || !buf.length) return;
      pcmBytes += (buf.length * (buf.numberOfChannels || 1) * 4);
    });
    return {
      buffersDecoded: keys.length,
      buffersPcmBytes: pcmBytes,
      inflightCount: Object.keys(ae.inflight || {}).length,
      activeSources: ae.activeSources ? ae.activeSources.size : 0
    };
  }

  function shouldAutoCleanup(audioIosData, limits) {
    if (!audioIosData || !limits) return false;
    if (typeof isPcmLimitExceeded === "function") return isPcmLimitExceeded(audioIosData, limits);
    var memLimitBytes = Math.max(0, Number(limits.maxPcmMb || 0)) * 1024 * 1024;
    return (Number(audioIosData.buffersDecoded || 0) > Number(limits.maxDecoded || 0))
      || (Number(audioIosData.buffersPcmBytes || 0) > memLimitBytes);
  }

  function tryAutoCleanupPcm(limits) {
    if (_inlineAutoCleanupRunning) return false;
    if (typeof clearAudioV2PcmBuffers !== "function") return false;
    var ai = collectIosBufferData();
    if (!ai) return false;
    if (!shouldAutoCleanup(ai, limits)) return false;

    _inlineAutoCleanupRunning = true;
    try {
      clearAudioV2PcmBuffers({
        maxDecoded: limits.maxDecoded,
        maxPcmBytes: limits.maxPcmMb * 1024 * 1024,
        keepRecentCount: limits.keepRecent
      });
      return true;
    } catch (e) {
      return false;
    } finally {
      _inlineAutoCleanupRunning = false;
    }
  }

  function getPcmLimits() {
    if (typeof loadPcmMonitorLimits === "function") return loadPcmMonitorLimits();
    return { maxDecoded: 15, maxPcmMb: 20, keepRecent: 3 };
  }

  function savePcmLimits(maxDecoded, maxPcmMb, keepRecent) {
    if (typeof savePcmMonitorLimits === "function") {
      return savePcmMonitorLimits(maxDecoded, maxPcmMb, keepRecent);
    }
    return {
      maxDecoded: Math.max(0, Number(maxDecoded || 0)),
      maxPcmMb: Math.max(0, Number(maxPcmMb || 0)),
      keepRecent: Math.max(0, Number(keepRecent || 0))
    };
  }

  function getVolumePct() {
    if (typeof loadMonitorVolumePct === "function") return loadMonitorVolumePct();
    var as = (typeof audioState !== "undefined" && audioState) ? audioState : null;
    return Math.round(((as && as.volume) || 0) * 100);
  }

  function applyVolumePct(pct) {
    var safe = Math.max(0, Math.min(100, Number(pct || 0)));
    if (typeof applyMonitorVolumePct === "function") return applyMonitorVolumePct(safe);
    if (typeof audioState !== "undefined" && audioState) audioState.volume = safe / 100;
    return safe;
  }

  function renderInlineAudio() {
    var body = document.getElementById(DETAILS_ID);
    if (!body) return;

    // Авто-подрезка PCM буферов (как в мониторе), даже если монитор не открыт.
    try {
      if (typeof audioEngine !== "undefined" && audioEngine) {
        var lim = getPcmLimits();
        tryAutoCleanupPcm(lim);
      }
    } catch (e0) {}

    var html = "";
    var volumePct = getVolumePct();
    html += renderSection("🔊 АУДИО — ОБЩЕЕ", getAudioCommonRows(volumePct));

    var isIos = (typeof audioEngine !== "undefined" && audioEngine);
    if (isIos) {
      var limits = getPcmLimits();
      var ai = collectIosBufferData();
      var pcmCls = "mon-green";
      if (ai && ai.buffersPcmBytes > 80 * 1024 * 1024) pcmCls = "mon-red";
      else if (ai && ai.buffersPcmBytes > 30 * 1024 * 1024) pcmCls = "mon-gold";

      var rows = ai ? [
        { k: "Декодировано файлов", v: '<span class="' + (ai.buffersDecoded > 0 ? "mon-green" : "") + '">' + ai.buffersDecoded + "</span>" },
        { k: "Лимит декодировано", v: '<span class="mon-limit-control">'
            + '<button type="button" class="mon-limit-btn" data-inline-role="pcm-limit-dec" data-delta="-1">−</button>'
            + '<input type="text" class="mon-limit-input" id="adminInlinePcmLimitDecodedInput" value="' + limits.maxDecoded + '" readonly aria-readonly="true">'
            + '<button type="button" class="mon-limit-btn" data-inline-role="pcm-limit-dec" data-delta="1">+</button>'
            + "</span>" },
        { k: "Память (PCM float32)", v: '<span class="' + pcmCls + '">' + bytesFmt(ai.buffersPcmBytes) + '</span>'
            + ' <button type="button" class="mon-clear-pcm" id="adminInlineClearPcmBtn">Применить лимиты</button>' },
        { k: "Лимит памяти PCM", v: '<span class="mon-limit-control">'
            + '<button type="button" class="mon-limit-btn" data-inline-role="pcm-limit-mb" data-delta="-1">−</button>'
            + '<input type="text" class="mon-limit-input" id="adminInlinePcmLimitMbInput" value="' + limits.maxPcmMb + '" readonly aria-readonly="true">'
            + '<button type="button" class="mon-limit-btn" data-inline-role="pcm-limit-mb" data-delta="1">+</button>'
            + '</span> <span class="mon-dim">МБ</span>' },
        { k: "Нижний порог (оставить)", v: '<span class="mon-limit-control">'
            + '<button type="button" class="mon-limit-btn" data-inline-role="pcm-limit-keep" data-delta="-1">−</button>'
            + '<input type="text" class="mon-limit-input" id="adminInlinePcmKeepRecentInput" value="' + limits.keepRecent + '" readonly aria-readonly="true">'
            + '<button type="button" class="mon-limit-btn" data-inline-role="pcm-limit-keep" data-delta="1">+</button>'
            + '</span> <span class="mon-dim">последних звуков</span>' },
        { k: "Загружаются сейчас", v: String(ai.inflightCount) },
        { k: "Активных источников", v: String(ai.activeSources) }
      ] : [{ k: "Статус", v: '<span class="mon-red">Ошибка чтения буферов</span>' }];
      html += renderSection("🎵 WEB AUDIO API — БУФЕРЫ В ПАМЯТИ", rows);
    } else {
      html += renderSection("🎵 WEB AUDIO API — БУФЕРЫ В ПАМЯТИ", [
        { k: "Статус", v: '<span class="mon-dim">Недоступно в audio_v1 (HTMLAudioElement)</span>' }
      ]);
    }

    body.innerHTML = html;
  }

  function bindInlineControls() {
    var host = document.getElementById(DETAILS_ID);
    if (!host || host._adminInlineBound) return;
    host._adminInlineBound = true;

    host.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var btn = t.closest(".mon-limit-btn");
      if (btn) {
        var role = btn.getAttribute("data-inline-role");
        var delta = Number(btn.getAttribute("data-delta") || 0);
        if (!delta) return;

        if (role === "audio-volume") {
          applyVolumePct(getVolumePct() + delta);
          renderInlineAudio();
          return;
        }

        var cur = getPcmLimits();
        if (role === "pcm-limit-dec") cur.maxDecoded = Math.max(0, Number(cur.maxDecoded || 0) + delta);
        if (role === "pcm-limit-mb") cur.maxPcmMb = Math.max(0, Number(cur.maxPcmMb || 0) + delta);
        if (role === "pcm-limit-keep") cur.keepRecent = Math.max(0, Number(cur.keepRecent || 0) + delta);
        var saved3 = savePcmLimits(cur.maxDecoded, cur.maxPcmMb, cur.keepRecent);
        // Если текущий кэш уже превышает новые лимиты — применим сразу.
        try { tryAutoCleanupPcm(saved3); } catch (e2) {}
        renderInlineAudio();
        return;
      }

      if (t.closest("#adminInlineClearPcmBtn")) {
        var decInput = document.getElementById("adminInlinePcmLimitDecodedInput");
        var mbInput = document.getElementById("adminInlinePcmLimitMbInput");
        var keepInput = document.getElementById("adminInlinePcmKeepRecentInput");
        var saved = savePcmLimits(
          decInput ? decInput.value : 15,
          mbInput ? mbInput.value : 20,
          keepInput ? keepInput.value : 3
        );
        if (typeof clearAudioV2PcmBuffers === "function") {
          clearAudioV2PcmBuffers({
            maxDecoded: saved.maxDecoded,
            maxPcmBytes: saved.maxPcmMb * 1024 * 1024,
            keepRecentCount: saved.keepRecent
          });
        }
        renderInlineAudio();
      }
    });
  }

  function bootstrap() {
    var body = document.getElementById(DETAILS_ID);
    if (!body) return;

    // Восстанавливаем состояние свернуто/развернуто блока "🔊 АУДИО СВОДКА"
    var detailsEl = body.closest ? body.closest("details") : null;
    if (detailsEl) {
      try {
        var raw = localStorage.getItem(LS_OPEN_KEY);
        if (raw === "1") detailsEl.open = true;
        else if (raw === "0") detailsEl.open = false;
      } catch (e0) {}

      if (!detailsEl._adminAudioInlineStateBound) {
        detailsEl._adminAudioInlineStateBound = true;
        detailsEl.addEventListener("toggle", function () {
          try { localStorage.setItem(LS_OPEN_KEY, detailsEl.open ? "1" : "0"); } catch (e1) {}
        });
      }
    }

    bindInlineControls();
    renderInlineAudio();
    setInterval(renderInlineAudio, REFRESH_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
