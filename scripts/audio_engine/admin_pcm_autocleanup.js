// ============================================================
// NAVAL COMBAT — Глобальная авто-очистка PCM по лимитам
// Работает всегда во время сессии, независимо от UI.
// ============================================================
(function initGlobalPcmAutocleanup() {
  var REFRESH_MS = 2000;
  var _running = false;
  var LOG_PREFIX = "[PCM AUTO-CLEANUP]";

  function getLimits() {
    if (typeof loadPcmMonitorLimits === "function") {
      return loadPcmMonitorLimits();
    }
    return { maxDecoded: 15, maxPcmMb: 20, keepRecent: 3 };
  }

  function collectIosData() {
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
      buffersPcmBytes: pcmBytes
    };
  }

  function exceedsLimits(audioIosData, limits) {
    if (typeof isPcmLimitExceeded === "function") {
      return isPcmLimitExceeded(audioIosData, limits);
    }
    if (!audioIosData || !limits) return false;
    var memLimitBytes = Math.max(0, Number(limits.maxPcmMb || 0)) * 1024 * 1024;
    return (Number(audioIosData.buffersDecoded || 0) > Number(limits.maxDecoded || 0))
      || (Number(audioIosData.buffersPcmBytes || 0) > memLimitBytes);
  }

  function tick() {
    if (_running) return;
    _running = true;
    try {
      if (typeof audioEngine === "undefined" || !audioEngine) return;
      if (typeof clearAudioV2PcmBuffers !== "function") return;

      var limits = getLimits();
      var ai = collectIosData();
      if (!ai) return;
      if (!exceedsLimits(ai, limits)) return;

      var beforeDecoded = ai.buffersDecoded;
      var beforeMb = Math.round(ai.buffersPcmBytes / 1024 / 1024 * 100) / 100;

      var res = clearAudioV2PcmBuffers({
        maxDecoded: limits.maxDecoded,
        maxPcmBytes: limits.maxPcmMb * 1024 * 1024,
        keepRecentCount: limits.keepRecent
      });

      var afterDecoded = res && res.afterDecoded != null ? res.afterDecoded : NaN;
      var afterMb = res && res.afterBytes != null ? (Math.round(res.afterBytes / 1024 / 1024 * 100) / 100) : NaN;
      var freedMb = res && res.freedBytes != null ? (Math.round(res.freedBytes / 1024 / 1024 * 100) / 100) : NaN;

      try {
        console.info(
          LOG_PREFIX,
          "cleanup triggered",
          "| decoded:", beforeDecoded, "→", afterDecoded,
          "| pcmMB:", beforeMb, "→", afterMb,
          "| freedMB:", freedMb,
          "| limits:", "decoded<=" + limits.maxDecoded + ", pcmMB<=" + limits.maxPcmMb + ", keepRecent=" + limits.keepRecent
        );
      } catch (eLog) {}
    } catch (e) {
      // тихо игнорируем, чтобы не ломать игру
    } finally {
      _running = false;
    }
  }

  function start() {
    try {
      tick();
      setInterval(tick, REFRESH_MS);
    } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

