// ── ОБРАБОТЧИК GET-ЗАПРОСОВ ─────────────────────────────────
function doGet(e) {
  // При ручном «Выполнить» в редакторе e не передаётся — только у реального HTTP GET.
  e = e || {};
  e.parameter = e.parameter || {};
  var action = e.parameter.action || "";
  var roomTimeoutMs = resolveRoomTimeoutMs(e.parameter.roomTimeoutMs);
  var startTime = new Date();
  var response;
  try {
    if (action === "state")    response = getState(e.parameter.playerId, e.parameter.roomId, roomTimeoutMs);
    else if (action === "getRooms") response = getRooms(roomTimeoutMs);
    else if (action === "stats") response = getStats(e);
    else response = { ok: false, error: "Неизвестное действие" };
  } catch (err) {
    response = { ok: false, error: err.message };
  }
  _writeDetailLog("GET", action, e.parameter, response, startTime);
  return jsonResponse(response);
}

// ── ОБРАБОТЧИК POST-ЗАПРОСОВ ────────────────────────────────
function doPost(e) {
  var data = {};
  var startTime = new Date();
  try {
    if (!e || !e.postData || e.postData.contents == null) {
      var errResp = { ok: false, error: "Нет тела запроса (ожидается POST из клиента)" };
      _writeDetailLog("POST", "unknown", {}, errResp, startTime);
      return jsonResponse(errResp);
    }
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    var errResp = { ok: false, error: "Неверный JSON" };
    _writeDetailLog("POST", "unknown", {}, errResp, startTime);
    return jsonResponse(errResp);
  }

  var action = data.action || "";
  var roomTimeoutMs = resolveRoomTimeoutMs(data.roomTimeoutMs);
  var response;
  try {
    if      (action === "createRoom")      response = createRoom(data, roomTimeoutMs);
    else if (action === "checkRoomAccess") response = checkRoomAccess(data, roomTimeoutMs);
    else if (action === "joinRoom")        response = joinRoom(data, roomTimeoutMs);
    else if (action === "move")            response = makeMove(data);
    else if (action === "restart")         response = restartGame(data);
    else if (action === "listRoomsAdmin")  response = listRoomsAdmin(data, roomTimeoutMs);
    else if (action === "leave")           response = leaveGame(data, roomTimeoutMs);
    else response = { ok: false, error: "Неизвестное действие: " + action };
  } catch (err) {
    response = { ok: false, error: err.message };
  }
  _writeDetailLog("POST", action, data, response, startTime);
  return jsonResponse(response);
}

// ── ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: JSON-ответ ────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

