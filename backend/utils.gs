// ── ЗАПИСЬ В ДЕТАЛЬНЫЙ ЛОГ ──────────────────────────────────
function _writeDetailLog(method, action, inputData, response, startTime) {
  try {
    var sheet = getSheet(SHEET_NAME_DETAIL_LOG);
    var endTime = new Date();
    var elapsed = endTime - startTime;
    var status = (response && response.ok === true) ? "OK" : "ERROR";

    // Безопасное извлечение никнейма и roomId из входных данных
    var nick   = (inputData && inputData.nickname) ? inputData.nickname
                 : (inputData && inputData.playerId) ? String(inputData.playerId).substring(0, 10) + "…"
                 : "—";
    var roomId = (inputData && inputData.roomId) ? inputData.roomId : "—";
    var pid    = (inputData && inputData.playerId) ? inputData.playerId : "—";

    // Краткое описание запроса (без shipBoard — слишком длинный)
    var reqCopy = {};
    if (inputData) {
      for (var k in inputData) {
        if (inputData.hasOwnProperty(k) && k !== "shipBoard" && k !== "password") {
          reqCopy[k] = inputData[k];
        }
      }
    }
    var reqStr = JSON.stringify(reqCopy);
    if (reqStr.length > 250) reqStr = reqStr.substring(0, 247) + "…";

    // Краткое описание ответа
    var respCopy = {};
    if (response) {
      for (var rk in response) {
        if (response.hasOwnProperty(rk) && rk !== "myBoard") {
          respCopy[rk] = response[rk];
        }
      }
    }
    var respStr = JSON.stringify(respCopy);
    if (respStr.length > 250) respStr = respStr.substring(0, 247) + "…";

    // Обрезаем лог: не более 2000 строк данных (без шапки)
    var MAX_LOG_ROWS = 2000;
    var dataRows = (sheet.getLastRow() || 1) - 1; // строк без заголовка
    if (dataRows >= MAX_LOG_ROWS) {
      var excess = dataRows - MAX_LOG_ROWS + 1; // удаляем столько, чтобы после вставки было ровно 2000
      sheet.deleteRows(2, excess);              // удаляем самые старые (сразу после шапки)
    }

    var rowNum = (sheet.getLastRow() || 1) + 1;
    sheet.appendRow([
      endTime.toLocaleString("ru-RU"),
      method,
      action,
      roomId,
      pid === "—" ? "—" : pid,
      nick,
      reqStr,
      respStr,
      status,
      elapsed
    ]);
    _styleNewRow(sheet, rowNum, 10);
  } catch(e) {
    // Не прерываем основную логику если лог упал
  }
}

// ── ГЕНЕРАЦИЯ УНИКАЛЬНОГО ID ────────────────────────────────
function generateId() {
  return "id_" + Date.now() + "_" + Math.floor(Math.random() * 9999);
}

function generateRoomId() {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var id = "";
  for (var i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function _hashPassword(pwd) {
  pwd = String(pwd || "");
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pwd, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = b;
    if (v < 0) v = 256 + v;
    var s = v.toString(16);
    return s.length === 1 ? "0" + s : s;
  }).join("");
}

function _safeEquals(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length) return false;
  var out = 0;
  for (var i = 0; i < a.length; i++) out |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return out === 0;
}

// ── Подписи клеток для листа «Журнал выстрелов» (как на доске: X — А…К, Y — 1…10) ──
var GRID_COLUMN_LABELS = "АБВГДЕЖЗИК";

function formatShotColumnForLog(x) {
  var xi = parseInt(x, 10);
  if (isNaN(xi) || xi < 0 || xi > 9) return String(x);
  return GRID_COLUMN_LABELS.charAt(xi);
}

function formatShotRowForLog(y) {
  var yi = parseInt(y, 10);
  if (isNaN(yi) || yi < 0 || yi > 9) return String(y);
  return yi + 1;
}