// engine/shared/bootstrap_init.js

// ── ИНИЦИАЛИЗАЦИЯ ─────────────────────────────────────────────
(async function init() {
  window.addEventListener("resize", function() {
    var canvas = document.getElementById("projectileCanvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });

  updateSoundButton();
  updateFullscreenButton();

  // UI: запоминаем свёрнутость/развёрнутость панелей
  (function initDetailsPersistence() {
    function restoreDetails(selector, key, fallbackOpen) {
      var els = document.querySelectorAll(selector);
      if (!els || !els.length) return;

      var raw = null;
      try { raw = localStorage.getItem(key); } catch (e) {}

      els.forEach(function (el) {
        if (raw === "1") el.open = true;
        else if (raw === "0") el.open = false;
        else el.open = !!fallbackOpen;

        var save = function () {
          try { localStorage.setItem(key, el.open ? "1" : "0"); } catch (e) {}
        };

        // Основной путь
        el.addEventListener("toggle", save);

        // Фолбэк: если toggle не прилетает (редко, но бывает) — сохраняем после клика по summary
        var summary = el.querySelector("summary");
        if (summary) {
          summary.addEventListener("click", function () { setTimeout(save, 0); });
          summary.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") setTimeout(save, 0);
          });
        }
      });
    }
    restoreDetails("details.log-panel", "mb_ui_log_open", false);
    restoreDetails("details.admin-panel", "mb_ui_admin_open", false);
  })();

  // Регистрируем SW, чтобы аудио читалось из Cache Storage (переживает F5)
  registerAudioServiceWorker();

  // Устанавливаем перехватчик сети (для Network Tracker)
  installNetworkInterceptor();

  // Иконка кэша на кнопке (🟥/🟨/🟩)
  updateCacheButtons();

  // Докачиваем недостающее в Cache Storage (без перезаписи)
  preloadAllAudioToCache({ overwrite: false, onlyMissing: true });

  // Админ: не onclick (SES/lockdown), и до любого return в init
  var btnAdminRoomsLoad = document.getElementById("btnAdminRoomsLoad");
  if (btnAdminRoomsLoad) btnAdminRoomsLoad.addEventListener("click", loadAdminRoomsList);

  var adminConfirmOv = document.getElementById("adminConfirmOverlay");
  var btnAdminConfCancel = document.getElementById("btnAdminConfirmCancel");
  var btnAdminConfOk = document.getElementById("btnAdminConfirmOk");
  if (btnAdminConfCancel) btnAdminConfCancel.addEventListener("click", function () { closeAdminConfirm(false); });
  if (btnAdminConfOk) btnAdminConfOk.addEventListener("click", function () { closeAdminConfirm(true); });
  if (adminConfirmOv) {
    adminConfirmOv.addEventListener("click", function (e) {
      if (e.target === adminConfirmOv) closeAdminConfirm(false);
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var ov = document.getElementById("adminConfirmOverlay");
    if (ov && ov.classList.contains("show")) closeAdminConfirm(false);
  });

  // Подставляем сохранённый никнейм
  var savedNick = loadSavedNickname();
  if (savedNick) document.getElementById("inNickname").value = savedNick;

  // Пробуем восстановить сессию
  if (await restoreSoloSession()) return;
  if (loadSession()) {
    await enterGameScreen();
    return;
  }

  showScreen("loginScreen");

  document.getElementById("inNickname").addEventListener("keydown", function(e) {
    if (e.key === "Enter") goToLobby();
  });
})();

