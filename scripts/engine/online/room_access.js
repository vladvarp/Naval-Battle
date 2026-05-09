// engine/online/room_access.js
//
// Вспомогательные элементы пользовательского интерфейса для доступа к онлайн-комнатам:
// - выбор типа комнаты (open/closed) при создании
// - запрос пароля при входе в закрытую комнату
//
// Предоставляет:
//   window.openOnlineRoomCreatePrompt(): Promise<{ type: "open"|"closed", password: string|null }|null>
//   window.openOnlineRoomPasswordPrompt(roomId, opts?): Promise<string|null>
//     opts.checkFn?: (password: string) => Promise<{ ok: boolean, error?: string }>

(function () {
  var _createRoot = null;
  var _createResolver = null;

  var _pwdRoot = null;
  var _pwdResolver = null;
  var _pwdCheckFn = null;
  var _pwdSubmitting = false;

  function _closeCreate(result) {
    if (!_createRoot) return;
    _createRoot.classList.remove("show");
    document.body.classList.remove("online-room-access-open");
    var r = _createResolver;
    _createResolver = null;
    if (r) r(result || null);
  }

  function _closePwd(result) {
    if (!_pwdRoot) return;
    _pwdRoot.classList.remove("show");
    document.body.classList.remove("online-room-access-open");
    var r = _pwdResolver;
    _pwdResolver = null;
    if (r) r(result || null);
  }

  function _ensureCreateRoot() {
    if (_createRoot) return;
    _createRoot = document.createElement("div");
    _createRoot.id = "onlineRoomCreateOverlay";
    _createRoot.className = "online-room-access-overlay";
    _createRoot.innerHTML = [
      '<div class="online-room-access-card" role="dialog" aria-modal="true">',
      '  <div class="online-room-access-title">ОНЛАЙН: ТИП КОМНАТЫ</div>',
      '  <div class="online-room-access-subtitle">Выберите тип комнаты перед расстановкой кораблей</div>',
      '  <div class="online-room-access-type-row">',
      '    <label class="online-room-access-type">',
      '      <input type="radio" name="onlineRoomType" value="open" checked>',
      '      <span class="online-room-access-type-label">🌐 ОТКРЫТАЯ</span>',
      '    </label>',
      '    <label class="online-room-access-type">',
      '      <input type="radio" name="onlineRoomType" value="closed">',
      '      <span class="online-room-access-type-label">🔒 ЗАКРЫТАЯ</span>',
      '    </label>',
      '  </div>',
      '  <div class="field-group" id="onlineRoomPasswordGroup" style="display:none;margin-bottom:10px;">',
      '    <label>ПАРОЛЬ КОМНАТЫ (минимум 4 символа)</label>',
      '    <input type="password" id="onlineRoomCreatePassword" placeholder="Введите пароль" minlength="4" autocomplete="off">',
      '    <div class="hint" id="onlineRoomCreatePasswordHint">Пароль потребуется при входе второго игрока</div>',
      '  </div>',
      '  <div class="online-room-access-actions">',
      '    <button type="button" class="btn btn-ghost" id="onlineRoomCreateCancel">ОТМЕНА</button>',
      '    <button type="button" class="btn btn-primary" id="onlineRoomCreateContinue">ПРОДОЛЖИТЬ</button>',
      '  </div>',
      '  <div class="online-room-access-error" id="onlineRoomCreateError"></div>',
      "</div>"
    ].join("");
    document.body.appendChild(_createRoot);

    function _selectedType() {
      var sel = _createRoot.querySelector('input[name="onlineRoomType"]:checked');
      return sel ? sel.value : "open";
    }

    function _syncPasswordVisibility() {
      var t = _selectedType();
      var group = _createRoot.querySelector("#onlineRoomPasswordGroup");
      if (!group) return;
      group.style.display = (t === "closed") ? "" : "none";
      var err = _createRoot.querySelector("#onlineRoomCreateError");
      if (err) err.textContent = "";
      if (t === "closed") {
        var inPwd = _createRoot.querySelector("#onlineRoomCreatePassword");
        if (inPwd) setTimeout(function () { inPwd.focus(); }, 0);
      }
    }

    _createRoot.addEventListener("click", function (e) {
      if (e.target === _createRoot) _closeCreate(null);
    });

    _createRoot.querySelectorAll('input[name="onlineRoomType"]').forEach(function (el) {
      el.addEventListener("change", _syncPasswordVisibility);
    });

    _createRoot.querySelector("#onlineRoomCreateCancel").addEventListener("click", function () {
      _closeCreate(null);
    });

    _createRoot.querySelector("#onlineRoomCreateContinue").addEventListener("click", function () {
      var t = _selectedType();
      var pwd = null;
      if (t === "closed") {
        var inPwd = _createRoot.querySelector("#onlineRoomCreatePassword");
        pwd = inPwd ? String(inPwd.value || "") : "";
        if (pwd.trim().length < 4) {
          var err = _createRoot.querySelector("#onlineRoomCreateError");
          if (err) err.textContent = "Пароль должен быть не короче 4 символов";
          if (inPwd) inPwd.focus();
          return;
        }
      }
      _closeCreate({ type: t, password: pwd ? pwd : null });
    });

    _createRoot.addEventListener("keydown", function (e) {
      if (e.key === "Escape") _closeCreate(null);
      if (e.key === "Enter") {
        var btn = _createRoot.querySelector("#onlineRoomCreateContinue");
        if (btn) btn.click();
      }
    });

    _syncPasswordVisibility();
  }

  function _ensurePwdRoot() {
    if (_pwdRoot) return;
    _pwdRoot = document.createElement("div");
    _pwdRoot.id = "onlineRoomPasswordOverlay";
    _pwdRoot.className = "online-room-access-overlay";
    _pwdRoot.innerHTML = [
      '<div class="online-room-access-card" role="dialog" aria-modal="true">',
      '  <div class="online-room-access-title">ЗАКРЫТАЯ КОМНАТА</div>',
      '  <div class="online-room-access-subtitle">Введите пароль для входа в комнату</div>',
      '  <div class="field-group" style="margin-bottom:10px;">',
      '    <label>ПАРОЛЬ</label>',
      '    <input type="password" id="onlineRoomJoinPassword" placeholder="Пароль комнаты" minlength="4" autocomplete="off">',
      "  </div>",
      '  <div class="online-room-access-actions">',
      '    <button type="button" class="btn btn-ghost" id="onlineRoomJoinCancel">ОТМЕНА</button>',
      '    <button type="button" class="btn btn-primary" id="onlineRoomJoinContinue">ВОЙТИ</button>',
      "  </div>",
      '  <div class="online-room-access-error" id="onlineRoomJoinError"></div>',
      "</div>"
    ].join("");
    document.body.appendChild(_pwdRoot);

    function _setPwdSubmitting(submitting) {
      _pwdSubmitting = !!submitting;
      var inPwd = _pwdRoot.querySelector("#onlineRoomJoinPassword");
      var btnOk = _pwdRoot.querySelector("#onlineRoomJoinContinue");
      var btnCancel = _pwdRoot.querySelector("#onlineRoomJoinCancel");
      if (inPwd) inPwd.disabled = _pwdSubmitting;
      if (btnOk) btnOk.disabled = _pwdSubmitting;
      if (btnCancel) btnCancel.disabled = _pwdSubmitting;
      var err = _pwdRoot.querySelector("#onlineRoomJoinError");
      if (err) err.textContent = _pwdSubmitting ? "Проверка пароля..." : (err.textContent || "");
    }

    _pwdRoot.addEventListener("click", function (e) {
      if (e.target === _pwdRoot && !_pwdSubmitting) _closePwd(null);
    });

    _pwdRoot.querySelector("#onlineRoomJoinCancel").addEventListener("click", function () {
      if (_pwdSubmitting) return;
      _closePwd(null);
    });

    async function _submitPwd() {
      if (_pwdSubmitting) return;
      var inPwd = _pwdRoot.querySelector("#onlineRoomJoinPassword");
      var pwd = inPwd ? String(inPwd.value || "") : "";
      if (pwd.trim().length < 4) {
        var err = _pwdRoot.querySelector("#onlineRoomJoinError");
        if (err) err.textContent = "Пароль должен быть не короче 4 символов";
        if (inPwd) inPwd.focus();
        return;
      }
      // Если есть серверная проверка — делаем её тут и НЕ закрываем окно при ошибке.
      if (typeof _pwdCheckFn === "function") {
        _setPwdSubmitting(true);
        try {
          var res = await _pwdCheckFn(pwd);
          if (!res || !res.ok) {
            var msg = (res && res.error) ? String(res.error) : "Неверный пароль";
            var err2 = _pwdRoot.querySelector("#onlineRoomJoinError");
            if (err2) err2.textContent = msg;
            _setPwdSubmitting(false);
            if (inPwd) {
              inPwd.disabled = false;
              setTimeout(function () { inPwd.focus(); }, 0);
            }
            return;
          }
          _setPwdSubmitting(false);
          _closePwd(pwd);
          return;
        } catch (e) {
          var err3 = _pwdRoot.querySelector("#onlineRoomJoinError");
          if (err3) err3.textContent = "Ошибка подключения";
          _setPwdSubmitting(false);
          if (inPwd) setTimeout(function () { inPwd.focus(); }, 0);
          return;
        }
      }
      _closePwd(pwd);
    }

    _pwdRoot.querySelector("#onlineRoomJoinContinue").addEventListener("click", function () {
      _submitPwd();
    });

    _pwdRoot.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (_pwdSubmitting) return;
        _closePwd(null);
      }
      if (e.key === "Enter") {
        var btn = _pwdRoot.querySelector("#onlineRoomJoinContinue");
        if (btn) btn.click();
      }
    });
  }

  function openOnlineRoomCreatePrompt() {
    _ensureCreateRoot();
    // reset state
    var err = _createRoot.querySelector("#onlineRoomCreateError");
    if (err) err.textContent = "";
    var pwd = _createRoot.querySelector("#onlineRoomCreatePassword");
    if (pwd) pwd.value = "";
    var openRadio = _createRoot.querySelector('input[name="onlineRoomType"][value="open"]');
    if (openRadio) openRadio.checked = true;
    // sync UI
    var group = _createRoot.querySelector("#onlineRoomPasswordGroup");
    if (group) group.style.display = "none";

    document.body.classList.add("online-room-access-open");
    _createRoot.classList.add("show");
    var btn = _createRoot.querySelector("#onlineRoomCreateContinue");
    if (btn) btn.focus();

    return new Promise(function (resolve) {
      if (_createResolver) {
        var prev = _createResolver;
        _createResolver = null;
        prev(null);
      }
      _createResolver = resolve;
    });
  }

  function openOnlineRoomPasswordPrompt(roomId, opts) {
    _ensurePwdRoot();
    opts = opts || {};
    _pwdCheckFn = typeof opts.checkFn === "function" ? opts.checkFn : null;
    _pwdSubmitting = false;
    var err = _pwdRoot.querySelector("#onlineRoomJoinError");
    if (err) err.textContent = "";
    var inPwd = _pwdRoot.querySelector("#onlineRoomJoinPassword");
    if (inPwd) inPwd.value = "";
    if (inPwd) inPwd.disabled = false;
    var btnOk = _pwdRoot.querySelector("#onlineRoomJoinContinue");
    var btnCancel = _pwdRoot.querySelector("#onlineRoomJoinCancel");
    if (btnOk) btnOk.disabled = false;
    if (btnCancel) btnCancel.disabled = false;

    var subtitle = _pwdRoot.querySelector(".online-room-access-subtitle");
    if (subtitle) subtitle.textContent = "Введите пароль для входа в комнату " + String(roomId || "");

    document.body.classList.add("online-room-access-open");
    _pwdRoot.classList.add("show");
    setTimeout(function () { if (inPwd) inPwd.focus(); }, 0);

    return new Promise(function (resolve) {
      if (_pwdResolver) {
        var prev = _pwdResolver;
        _pwdResolver = null;
        prev(null);
      }
      _pwdResolver = resolve;
    });
  }

  window.openOnlineRoomCreatePrompt = openOnlineRoomCreatePrompt;
  window.openOnlineRoomPasswordPrompt = openOnlineRoomPasswordPrompt;
})();

