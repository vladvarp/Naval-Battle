// ============================================================
// МОРСКОЙ БОЙ — Google Apps Script Backend
// Версия: 3.0 — Система комнат + Красивое оформление таблиц
// Все комментарии на русском языке
// ============================================================

// ── НАСТРОЙКИ ──────────────────────────────────────────────
var ADMIN_PASSWORD           = "admin";
var SHEET_NAME_ROOMS         = "Комнаты";
var SHEET_NAME_PLAYERS       = "Игроки";
var SHEET_NAME_STATE         = "Состояние";
var SHEET_NAME_LOG           = "Журнал выстрелов";
var SHEET_NAME_DETAIL_LOG    = "Детальный лог";
var SHEET_NAME_HISTORY       = "История игр";
var SHEET_NAME_STATS         = "Статистика";
var ROOM_TIMEOUT_MS          = 10 * 60 * 1000; // 10 минут бездействия
var FORMAT_VERSION           = "v3.0"; // Увеличить при изменении структуры

// ── ЦВЕТОВАЯ ПАЛИТРА (тема «Морской бой») ──────────────────
var CLR = {
  NAVY:        "#1a3a5c",   // Тёмно-синий — шапки
  OCEAN:       "#1e6091",   // Средне-синий — подзаголовки
  WAVE:        "#2e86ab",   // Голубой — акцент
  SEAFOAM:     "#d4eaf7",   // Светло-голубой — чётные строки
  WHITE:       "#ffffff",   // Белый — нечётные строки
  GOLD:        "#f4a261",   // Золотой — победитель / особые ячейки
  GREEN:       "#2a9d8f",   // Зелёный — hit / активные
  RED:         "#e63946",   // Красный — miss / ошибки
  GRAY:        "#6c757d",   // Серый — неактивные
  LIGHT_GRAY:  "#f8f9fa",   // Светло-серый — фон Stats
  HEADER_TEXT: "#ffffff",   // Белый текст заголовков
  DARK_TEXT:   "#212529",   // Тёмный текст данных
};

// ── ОБРАБОТЧИК GET-ЗАПРОСОВ ─────────────────────────────────
function doGet(e) {
  var action = e.parameter.action || "";
  var startTime = new Date();
  var response;
  try {
    if (action === "state")    response = getState(e.parameter.playerId, e.parameter.roomId);
    else if (action === "getRooms") response = getRooms();
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
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    var errResp = { ok: false, error: "Неверный JSON" };
    _writeDetailLog("POST", "unknown", {}, errResp, startTime);
    return jsonResponse(errResp);
  }

  var action = data.action || "";
  var response;
  try {
    if      (action === "createRoom")      response = createRoom(data);
    else if (action === "joinRoom")        response = joinRoom(data);
    else if (action === "move")            response = makeMove(data);
    else if (action === "restart")         response = restartGame(data);
    else if (action === "listRoomsAdmin")  response = listRoomsAdmin(data);
    else if (action === "leave")           response = leaveGame(data);
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

// ── ПОЛУЧЕНИЕ ЛИСТА (создаёт если нет) ─────────────────────
function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

// ── ИНИЦИАЛИЗАЦИЯ И ФОРМАТИРОВАНИЕ ТАБЛИЦЫ ─────────────────
function initSheets() {
  var props = PropertiesService.getScriptProperties();
  var formatted = props.getProperty("formatVersion");
  if (formatted === FORMAT_VERSION) return; // уже настроено

  _setupRoomsSheet();
  _setupPlayersSheet();
  _setupLogSheet();
  _setupDetailLogSheet();
  _setupHistorySheet();
  _setupStatsSheet();
  _setupStateSheet();
  _reorderSheets();

  props.setProperty("formatVersion", FORMAT_VERSION);
}

// Принудительно переформатировать (вызывать вручную при необходимости)
function forceReinitSheets() {
  PropertiesService.getScriptProperties().deleteProperty("formatVersion");
  initSheets();
}

// ── УПОРЯДОЧИТЬ ЛИСТЫ ───────────────────────────────────────
function _reorderSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var order = [
    SHEET_NAME_ROOMS,
    SHEET_NAME_PLAYERS,
    SHEET_NAME_HISTORY,
    SHEET_NAME_STATS,
    SHEET_NAME_LOG,
    SHEET_NAME_DETAIL_LOG,
    SHEET_NAME_STATE
  ];
  for (var i = 0; i < order.length; i++) {
    var s = ss.getSheetByName(order[i]);
    if (s) ss.setActiveSheet(s), ss.moveActiveSheet(i + 1);
  }
}

// ── НАСТРОЙКА ЛИСТА «КОМНАТЫ» ───────────────────────────────
function _setupRoomsSheet() {
  var sheet = getSheet(SHEET_NAME_ROOMS);
  sheet.setTabColor(CLR.NAVY);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "🏠 ID Комнаты", "👤 ID Игрока 1", "🎮 Никнейм 1",
      "👤 ID Игрока 2", "🎮 Никнейм 2",
      "📊 Статус", "🕐 Последняя активность",
      "🎯 Выстрелы П1 (JSON)", "🎯 Выстрелы П2 (JSON)",
      "🏆 Победитель ID", "🔄 Чей ход (ID)"
    ]);
  }

  // Ширины столбцов
  var widths = [100, 150, 120, 150, 120, 100, 170, 250, 250, 150, 150];
  for (var i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }

  // Заголовок
  var hdr = sheet.getRange(1, 1, 1, 11);
  hdr.setBackground(CLR.NAVY)
     .setFontColor(CLR.HEADER_TEXT)
     .setFontWeight("bold")
     .setFontSize(10)
     .setHorizontalAlignment("center")
     .setVerticalAlignment("middle")
     .setWrap(true);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);

  // Чередующиеся строки данных (если есть)
  _applyDataRowStyles(sheet, 11);

  // Условное форматирование статуса
  _applyStatusConditional(sheet, 6);

  SpreadsheetApp.flush();
}

// ── НАСТРОЙКА ЛИСТА «ИГРОКИ» ────────────────────────────────
function _setupPlayersSheet() {
  var sheet = getSheet(SHEET_NAME_PLAYERS);
  sheet.setTabColor(CLR.WAVE);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "👤 ID Игрока", "🎮 Никнейм", "🏠 ID Комнаты",
      "🔢 Слот", "🚢 Расстановка кораблей (JSON)", "🕐 Последнее обращение"
    ]);
  }

  var widths = [150, 120, 100, 60, 400, 170];
  for (var i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }

  var hdr = sheet.getRange(1, 1, 1, 6);
  hdr.setBackground(CLR.WAVE)
     .setFontColor(CLR.HEADER_TEXT)
     .setFontWeight("bold")
     .setFontSize(10)
     .setHorizontalAlignment("center")
     .setVerticalAlignment("middle")
     .setWrap(true);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);

  _applyDataRowStyles(sheet, 6);
  SpreadsheetApp.flush();
}

// ── НАСТРОЙКА ЛИСТА «ЖУРНАЛ ВЫСТРЕЛОВ» ─────────────────────
function _setupLogSheet() {
  // Переименовываем старый лист если нужно
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var oldLog = ss.getSheetByName("Журнал");
  if (oldLog) oldLog.setName(SHEET_NAME_LOG);

  var sheet = getSheet(SHEET_NAME_LOG);
  sheet.setTabColor(CLR.GREEN);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "🕐 Время", "🏠 ID Комнаты", "👤 ID Игрока",
      "🎮 Никнейм", "📍 X", "📍 Y", "💥 Результат"
    ]);
  }

  var widths = [170, 110, 150, 120, 50, 50, 90];
  for (var i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }

  var hdr = sheet.getRange(1, 1, 1, 7);
  hdr.setBackground(CLR.GREEN)
     .setFontColor(CLR.HEADER_TEXT)
     .setFontWeight("bold")
     .setFontSize(10)
     .setHorizontalAlignment("center")
     .setVerticalAlignment("middle")
     .setWrap(true);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);

  _applyDataRowStyles(sheet, 7);

  // Условное форматирование: hit/miss/sunk
  _applyShotResultConditional(sheet, 7);

  SpreadsheetApp.flush();
}

// ── НАСТРОЙКА ЛИСТА «ДЕТАЛЬНЫЙ ЛОГ» ────────────────────────
function _setupDetailLogSheet() {
  var sheet = getSheet(SHEET_NAME_DETAIL_LOG);
  sheet.setTabColor(CLR.OCEAN);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "🕐 Время", "⚡ Метод", "🎬 Action", "🏠 RoomId",
      "👤 PlayerId", "🎮 Никнейм", "📥 Запрос (кратко)",
      "📤 Ответ (кратко)", "✅ Статус", "⏱ Время (мс)"
    ]);
  }

  var widths = [170, 60, 130, 110, 150, 120, 300, 300, 70, 80];
  for (var i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }

  var hdr = sheet.getRange(1, 1, 1, 10);
  hdr.setBackground(CLR.OCEAN)
     .setFontColor(CLR.HEADER_TEXT)
     .setFontWeight("bold")
     .setFontSize(10)
     .setHorizontalAlignment("center")
     .setVerticalAlignment("middle")
     .setWrap(true);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);

  _applyDataRowStyles(sheet, 10);

  // Условное форматирование статуса OK/ERROR
  _applyOkErrorConditional(sheet, 9);

  SpreadsheetApp.flush();
}

// ── НАСТРОЙКА ЛИСТА «ИСТОРИЯ ИГР» ───────────────────────────
function _setupHistorySheet() {
  var sheet = getSheet(SHEET_NAME_HISTORY);
  sheet.setTabColor(CLR.GOLD);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "🕐 Время окончания", "🏠 ID Комнаты",
      "🏆 Победитель (ник)", "💀 Проигравший (ник)",
      "🎯 Выстрелов победителя", "🎯 Выстрелов проигравшего",
      "⏱ Длительность (мин)", "📊 Причина завершения"
    ]);
  }

  var widths = [170, 110, 140, 140, 110, 120, 110, 150];
  for (var i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }

  var hdr = sheet.getRange(1, 1, 1, 8);
  hdr.setBackground(CLR.GOLD)
     .setFontColor(CLR.DARK_TEXT)
     .setFontWeight("bold")
     .setFontSize(10)
     .setHorizontalAlignment("center")
     .setVerticalAlignment("middle")
     .setWrap(true);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);

  _applyDataRowStyles(sheet, 8);
  SpreadsheetApp.flush();
}

// ── НАСТРОЙКА ЛИСТА «СТАТИСТИКА» ────────────────────────────
function _setupStatsSheet() {
  var sheet = getSheet(SHEET_NAME_STATS);
  sheet.setTabColor(CLR.GOLD);

  // Очищаем и строим заново
  sheet.clearContents();
  sheet.clearFormats();

  // Заголовок-баннер
  sheet.getRange(1, 1, 1, 7).merge()
       .setValue("🏆  ТУРНИРНАЯ ТАБЛИЦА  🏆")
       .setBackground(CLR.NAVY)
       .setFontColor(CLR.GOLD)
       .setFontWeight("bold")
       .setFontSize(14)
       .setHorizontalAlignment("center")
       .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 50);

  // Подзаголовок
  sheet.getRange(2, 1, 1, 7).merge()
       .setValue("Автоматически обновляется после каждой завершённой игры")
       .setBackground(CLR.OCEAN)
       .setFontColor(CLR.HEADER_TEXT)
       .setFontSize(9)
       .setHorizontalAlignment("center")
       .setFontStyle("italic");
  sheet.setRowHeight(2, 22);

  // Заголовки столбцов
  sheet.getRange(3, 1, 1, 7).setValues([[
    "🥇 Место", "🎮 Никнейм", "🎲 Игр", "🏆 Побед", "💀 Поражений",
    "📈 Win%", "🎯 Ср. выстрелов на победу"
  ]]).setBackground(CLR.NAVY)
     .setFontColor(CLR.HEADER_TEXT)
     .setFontWeight("bold")
     .setFontSize(10)
     .setHorizontalAlignment("center")
     .setVerticalAlignment("middle");
  sheet.setRowHeight(3, 36);

  var widths2 = [70, 150, 70, 80, 100, 80, 140];
  for (var i = 0; i < widths2.length; i++) {
    sheet.setColumnWidth(i + 1, widths2[i]);
  }

  sheet.setFrozenRows(3);
  SpreadsheetApp.flush();
}

// ── НАСТРОЙКА ЛИСТА «СОСТОЯНИЕ» (служебный) ─────────────────
function _setupStateSheet() {
  var sheet = getSheet(SHEET_NAME_STATE);
  sheet.setTabColor(CLR.GRAY);

  sheet.clearContents();
  sheet.clearFormats();

  sheet.getRange(1, 1, 1, 3).merge()
       .setValue("Служебный лист — не редактировать вручную")
       .setBackground(CLR.GRAY)
       .setFontColor(CLR.WHITE)
       .setFontWeight("bold")
       .setHorizontalAlignment("center");
  sheet.setRowHeight(1, 30);

  sheet.getRange(3, 1).setValue("Параметр");
  sheet.getRange(3, 2).setValue("Значение");
  sheet.getRange(3, 1, 1, 2)
       .setBackground(CLR.NAVY)
       .setFontColor(CLR.WHITE)
       .setFontWeight("bold");

  sheet.getRange(4, 1).setValue("Версия форматирования");
  sheet.getRange(4, 2).setValue(FORMAT_VERSION);
  sheet.getRange(5, 1).setValue("Таймаут комнаты (мин)");
  sheet.getRange(5, 2).setValue(ROOM_TIMEOUT_MS / 60000);
  sheet.getRange(6, 1).setValue("Последняя инициализация");
  sheet.getRange(6, 2).setValue(new Date().toLocaleString("ru-RU"));

  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 200);
  SpreadsheetApp.flush();
}

// ── ПРИМЕНЕНИЕ СТИЛЕЙ К СТРОКАМ ДАННЫХ ──────────────────────
function _applyDataRowStyles(sheet, numCols) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var dataRows = lastRow - 1;

  // Чётные строки — светло-голубые, нечётные — белые
  for (var r = 2; r <= lastRow; r++) {
    var rng = sheet.getRange(r, 1, 1, numCols);
    var bg = (r % 2 === 0) ? CLR.SEAFOAM : CLR.WHITE;
    rng.setBackground(bg)
       .setFontColor(CLR.DARK_TEXT)
       .setFontSize(9)
       .setVerticalAlignment("middle");
    sheet.setRowHeight(r, 24);
  }
}

// ── УСЛОВНЫЙ ФОРМАТ: Статус комнаты (playing/waiting/finished) ─
function _applyStatusConditional(sheet, col) {
  try {
    var rules = sheet.getConditionalFormatRules();
    var colLetter = _colLetter(col);
    var range = sheet.getRange(colLetter + "2:" + colLetter + "1000");

    var rPlaying = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("playing")
      .setBackground(CLR.GREEN)
      .setFontColor(CLR.WHITE)
      .setRanges([range])
      .build();

    var rWaiting = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("waiting")
      .setBackground(CLR.GOLD)
      .setFontColor(CLR.DARK_TEXT)
      .setRanges([range])
      .build();

    var rFinished = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("finished")
      .setBackground(CLR.GRAY)
      .setFontColor(CLR.WHITE)
      .setRanges([range])
      .build();

    rules.push(rPlaying, rWaiting, rFinished);
    sheet.setConditionalFormatRules(rules);
  } catch(e) { /* игнорируем если условный формат не поддерживается */ }
}

// ── УСЛОВНЫЙ ФОРМАТ: Результат выстрела ─────────────────────
function _applyShotResultConditional(sheet, col) {
  try {
    var rules = sheet.getConditionalFormatRules();
    var colLetter = _colLetter(col);
    var range = sheet.getRange(colLetter + "2:" + colLetter + "1000");

    var rHit = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("hit")
      .setBackground("#ff6b35")
      .setFontColor(CLR.WHITE)
      .setRanges([range])
      .build();

    var rMiss = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("miss")
      .setBackground(CLR.SEAFOAM)
      .setFontColor(CLR.DARK_TEXT)
      .setRanges([range])
      .build();

    var rSunk = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("sunk")
      .setBackground(CLR.RED)
      .setFontColor(CLR.WHITE)
      .setBold(true)
      .setRanges([range])
      .build();

    rules.push(rHit, rMiss, rSunk);
    sheet.setConditionalFormatRules(rules);
  } catch(e) {}
}

// ── УСЛОВНЫЙ ФОРМАТ: OK / ERROR ─────────────────────────────
function _applyOkErrorConditional(sheet, col) {
  try {
    var rules = sheet.getConditionalFormatRules();
    var colLetter = _colLetter(col);
    var range = sheet.getRange(colLetter + "2:" + colLetter + "1000");

    var rOk = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("OK")
      .setBackground(CLR.GREEN)
      .setFontColor(CLR.WHITE)
      .setRanges([range])
      .build();

    var rErr = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("ERROR")
      .setBackground(CLR.RED)
      .setFontColor(CLR.WHITE)
      .setRanges([range])
      .build();

    rules.push(rOk, rErr);
    sheet.setConditionalFormatRules(rules);
  } catch(e) {}
}

// ── ВСПОМОГАТЕЛЬНАЯ: буква столбца по номеру ────────────────
function _colLetter(n) {
  var s = "";
  while (n > 0) {
    var rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ── СТИЛИЗОВАТЬ НОВУЮ СТРОКУ ДАННЫХ ─────────────────────────
function _styleNewRow(sheet, rowNum, numCols) {
  try {
    var bg = (rowNum % 2 === 0) ? CLR.SEAFOAM : CLR.WHITE;
    sheet.getRange(rowNum, 1, 1, numCols)
         .setBackground(bg)
         .setFontColor(CLR.DARK_TEXT)
         .setFontSize(9)
         .setVerticalAlignment("middle");
    sheet.setRowHeight(rowNum, 24);
  } catch(e) {}
}

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

// ── ГЕНЕРАЦИЯ РАССТАНОВКИ КОРАБЛЕЙ ──────────────────────────
function generateShips() {
  var grid = [];
  for (var r = 0; r < 10; r++) grid.push([0,0,0,0,0,0,0,0,0,0]);

  var ships = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

  for (var s = 0; s < ships.length; s++) {
    var size = ships[s];
    var placed = false;
    var attempts = 0;
    while (!placed && attempts < 1000) {
      attempts++;
      var horiz = Math.random() > 0.5;
      var row = Math.floor(Math.random() * 10);
      var col = Math.floor(Math.random() * 10);

      if (horiz) { if (col + size > 10) continue; }
      else       { if (row + size > 10) continue; }

      var canPlace = true;
      for (var d = 0; d < size && canPlace; d++) {
        var cr = horiz ? row     : row + d;
        var cc = horiz ? col + d : col;
        for (var dr = -1; dr <= 1; dr++) {
          for (var dc = -1; dc <= 1; dc++) {
            var nr = cr + dr, nc = cc + dc;
            if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10 && grid[nr][nc] === 1) canPlace = false;
          }
        }
      }

      if (canPlace) {
        for (var d2 = 0; d2 < size; d2++) {
          var pr = horiz ? row     : row + d2;
          var pc = horiz ? col + d2 : col;
          grid[pr][pc] = 1;
        }
        placed = true;
      }
    }
    if (!placed) return generateShips();
  }
  return grid;
}

function normalizeManualBoard(rawBoard) {
  if (!rawBoard || !Array.isArray(rawBoard) || rawBoard.length !== 10) return null;
  var board = [];
  for (var y = 0; y < 10; y++) {
    if (!Array.isArray(rawBoard[y]) || rawBoard[y].length !== 10) return null;
    board.push([]);
    for (var x = 0; x < 10; x++) {
      board[y].push(rawBoard[y][x] ? 1 : 0);
    }
  }
  return board;
}

function validateFleetBoard(board) {
  if (!board) return false;
  var visited = {};
  var lengths = [];

  function inRange(x, y) {
    return x >= 0 && x < 10 && y >= 0 && y < 10;
  }

  for (var y = 0; y < 10; y++) {
    for (var x = 0; x < 10; x++) {
      if (board[y][x] !== 1 || visited[y + "_" + x]) continue;

      var queue = [{ x: x, y: y }];
      var cells = [];
      visited[y + "_" + x] = true;

      while (queue.length) {
        var cur = queue.pop();
        cells.push(cur);
        var dirs = [[1,0],[-1,0],[0,1],[0,-1]];
        for (var d = 0; d < dirs.length; d++) {
          var nx = cur.x + dirs[d][0];
          var ny = cur.y + dirs[d][1];
          var k = ny + "_" + nx;
          if (!inRange(nx, ny) || visited[k]) continue;
          if (board[ny][nx] === 1) {
            visited[k] = true;
            queue.push({ x: nx, y: ny });
          }
        }
      }

      var sameX = true, sameY = true;
      for (var i = 1; i < cells.length; i++) {
        if (cells[i].x !== cells[0].x) sameX = false;
        if (cells[i].y !== cells[0].y) sameY = false;
      }
      if (!sameX && !sameY) return false;

      for (var c = 0; c < cells.length; c++) {
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            var tx = cells[c].x + dx;
            var ty = cells[c].y + dy;
            if (!inRange(tx, ty) || board[ty][tx] !== 1) continue;
            var belongs = false;
            for (var j = 0; j < cells.length; j++) {
              if (cells[j].x === tx && cells[j].y === ty) {
                belongs = true;
                break;
              }
            }
            if (!belongs) return false;
          }
        }
      }

      lengths.push(cells.length);
    }
  }

  lengths.sort(function(a, b){ return a - b; });
  var expected = [1,1,1,1,2,2,2,3,3,4];
  if (lengths.length !== expected.length) return false;
  for (var k = 0; k < expected.length; k++) {
    if (lengths[k] !== expected[k]) return false;
  }
  return true;
}

function resolvePlayerShips(data) {
  var board = normalizeManualBoard(data && data.shipBoard);
  if (board && validateFleetBoard(board)) return board;
  return generateShips();
}

// ── РАБОТА С КОМНАТАМИ ──────────────────────────────────────
function readRooms() {
  var sheet = getSheet(SHEET_NAME_ROOMS);
  var data  = sheet.getDataRange().getValues();
  var rooms = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    var room = {
      row:          i + 1,
      roomId:       data[i][0],
      player1Id:    data[i][1],
      player1Nick:  data[i][2],
      player2Id:    data[i][3],
      player2Nick:  data[i][4],
      phase:        data[i][5],
      lastActivity: data[i][6],
      winner:       data[i][9] || ""
    };
    try { room.shotsP1 = JSON.parse(data[i][7] || "[]"); } catch(e) { room.shotsP1 = []; }
    try { room.shotsP2 = JSON.parse(data[i][8] || "[]"); } catch(e) { room.shotsP2 = []; }
    rooms.push(room);
  }
  return rooms;
}

function findRoom(roomId) {
  var rooms = readRooms();
  for (var i = 0; i < rooms.length; i++) {
    if (rooms[i].roomId === roomId) return rooms[i];
  }
  return null;
}

function writeRoomField(row, colIndex, value) {
  var sheet = getSheet(SHEET_NAME_ROOMS);
  sheet.getRange(row, colIndex).setValue(
    typeof value === "object" ? JSON.stringify(value) : value
  );
}

function deleteRoomRow(row) {
  var sheet = getSheet(SHEET_NAME_ROOMS);
  // Очищаем перед удалением чтобы не оставалось артефактов
  sheet.getRange(row, 1, 1, sheet.getLastColumn()).clearContent();
  sheet.deleteRow(row);
}

function updateRoomActivity(row) {
  writeRoomField(row, 7, new Date().toISOString());
}

// ── УДАЛЕНИЕ УСТАРЕВШИХ КОМНАТ (LAZY CLEANUP) ───────────────
function cleanupOldRooms() {
  var sheet = getSheet(SHEET_NAME_ROOMS);
  var data  = sheet.getDataRange().getValues();
  var now   = Date.now();
  // Удаляем снизу вверх чтобы не сбивать индексы строк
  for (var i = data.length - 1; i >= 1; i--) {
    if (!data[i][0]) continue;
    var lastActivity = data[i][6];
    if (!lastActivity) continue;
    var lastMs = new Date(lastActivity).getTime();
    if (now - lastMs > ROOM_TIMEOUT_MS) {
      var roomId = data[i][0];
      deletePlayersOfRoom(roomId);
      // Очищаем перед удалением
      sheet.getRange(i + 1, 1, 1, sheet.getLastColumn()).clearContent();
      sheet.deleteRow(i + 1);
    }
  }
}

// ── РАБОТА С ИГРОКАМИ ───────────────────────────────────────
function readPlayers() {
  var sheet = getSheet(SHEET_NAME_PLAYERS);
  var data  = sheet.getDataRange().getValues();
  var players = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    players.push({
      row:       i + 1,
      playerId:  data[i][0],
      nickname:  data[i][1],
      roomId:    data[i][2],
      slot:      data[i][3],
      shipBoard: data[i][4] || "",
      lastSeen:  data[i][5]
    });
  }
  return players;
}

function readPlayersOfRoom(roomId) {
  var all = readPlayers();
  return all.filter(function(p){ return p.roomId === roomId; });
}

function findPlayerById(playerId) {
  var players = readPlayers();
  for (var i = 0; i < players.length; i++) {
    if (players[i].playerId === playerId) return players[i];
  }
  return null;
}

function deletePlayersOfRoom(roomId) {
  var sheet = getSheet(SHEET_NAME_PLAYERS);
  var data  = sheet.getDataRange().getValues();
  var totalCols = sheet.getLastColumn();
  // Удаляем снизу вверх; очищаем перед удалением — исправление бага с lastSeen
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][2] === roomId) {
      sheet.getRange(i + 1, 1, 1, totalCols).clearContent();
      sheet.deleteRow(i + 1);
    }
  }
}

function removePlayerRow(row) {
  var sheet = getSheet(SHEET_NAME_PLAYERS);
  // Очищаем содержимое строки перед удалением — исправление бага с зависшей ячейкой lastSeen
  var totalCols = sheet.getLastColumn();
  sheet.getRange(row, 1, 1, totalCols).clearContent();
  sheet.deleteRow(row);
}

function updatePlayerLastSeen(row) {
  getSheet(SHEET_NAME_PLAYERS).getRange(row, 6).setValue(new Date().toISOString());
}

// ── СПИСОК КОМНАТ (ЛОББИ) ────────────────────────────────────
function getRooms() {
  initSheets();
  cleanupOldRooms();
  var rooms = readRooms();
  var now   = Date.now();
  var result = [];
  for (var i = 0; i < rooms.length; i++) {
    var r = rooms[i];
    if (r.phase !== "waiting") continue;
    var lastMs = r.lastActivity ? new Date(r.lastActivity).getTime() : 0;
    var idleSec = Math.floor((now - lastMs) / 1000);
    result.push({
      roomId:       r.roomId,
      player1Nick:  r.player1Nick,
      idleSec:      idleSec,
      lastActivity: r.lastActivity
    });
  }
  return { ok: true, rooms: result };
}

// ── СОЗДАТЬ КОМНАТУ ──────────────────────────────────────────
function createRoom(data) {
  initSheets();
  cleanupOldRooms();

  var nickname = (data.nickname || "").trim();
  if (!nickname) return { ok: false, error: "Введите никнейм" };

  var roomId   = generateRoomId();
  var playerId = generateId();
  var ships    = resolvePlayerShips(data);
  var now      = new Date().toISOString();

  // Создаём комнату
  var roomSheet = getSheet(SHEET_NAME_ROOMS);
  var newRoomRow = (roomSheet.getLastRow() || 1) + 1;
  roomSheet.appendRow([roomId, playerId, nickname, "", "", "waiting", now, "[]", "[]", "", ""]);
  _styleNewRow(roomSheet, newRoomRow, 11);

  // Добавляем игрока
  var playerSheet = getSheet(SHEET_NAME_PLAYERS);
  var newPlayerRow = (playerSheet.getLastRow() || 1) + 1;
  playerSheet.appendRow([playerId, nickname, roomId, 1, JSON.stringify(ships), now]);
  _styleNewRow(playerSheet, newPlayerRow, 6);

  return { ok: true, playerId: playerId, roomId: roomId, slot: 1 };
}

// ── ВОЙТИ В КОМНАТУ ──────────────────────────────────────────
function joinRoom(data) {
  initSheets();
  cleanupOldRooms();

  var nickname = (data.nickname || "").trim();
  var roomId   = (data.roomId   || "").trim();

  if (!nickname) return { ok: false, error: "Введите никнейм" };
  if (!roomId)   return { ok: false, error: "Укажите ID комнаты" };

  var room = findRoom(roomId);
  if (!room) return { ok: false, error: "Комната не найдена или устарела" };
  if (room.phase !== "waiting") return { ok: false, error: "Комната уже занята или игра началась" };
  if (room.player2Id) return { ok: false, error: "Комната уже заполнена" };

  // Переподключение (тот же никнейм — игрок 1 переподключается)
  if (room.player1Nick === nickname) {
    var existingPlayer = findPlayerById(room.player1Id);
    if (existingPlayer) {
      updatePlayerLastSeen(existingPlayer.row);
      return { ok: true, playerId: existingPlayer.playerId, roomId: roomId, slot: 1, reconnected: true, phase: room.phase };
    }
  }

  var playerId = generateId();
  var ships    = resolvePlayerShips(data);
  var now      = new Date().toISOString();

  // Добавляем второго игрока
  var playerSheet = getSheet(SHEET_NAME_PLAYERS);
  var newPlayerRow = (playerSheet.getLastRow() || 1) + 1;
  playerSheet.appendRow([playerId, nickname, roomId, 2, JSON.stringify(ships), now]);
  _styleNewRow(playerSheet, newPlayerRow, 6);

  // Обновляем комнату
  var roomSheet = getSheet(SHEET_NAME_ROOMS);
  var roomData  = roomSheet.getDataRange().getValues();
  for (var i = 1; i < roomData.length; i++) {
    if (roomData[i][0] === roomId) {
      var targetRow = i + 1;
      roomSheet.getRange(targetRow, 4).setValue(playerId);
      roomSheet.getRange(targetRow, 5).setValue(nickname);
      roomSheet.getRange(targetRow, 6).setValue("playing");
      roomSheet.getRange(targetRow, 7).setValue(now);
      setTurn(targetRow, room.player1Id);
      break;
    }
  }

  return { ok: true, playerId: playerId, roomId: roomId, slot: 2, phase: "playing" };
}

// ── ПОЛУЧЕНИЕ СОСТОЯНИЯ ИГРЫ ────────────────────────────────
function getState(playerId, roomId) {
  initSheets();
  cleanupOldRooms();

  if (!roomId) return { ok: false, error: "Не указан roomId" };

  var room = findRoom(roomId);
  if (!room) return { ok: false, error: "Комната не найдена" };

  if (playerId) {
    var me = findPlayerById(playerId);
    if (me) {
      updatePlayerLastSeen(me.row);
      updateRoomActivity(room.row);
    }
  }

  var players = readPlayersOfRoom(roomId);
  var playersPublic = players.map(function(p) {
    return { playerId: p.playerId, nickname: p.nickname, slot: p.slot };
  });

  var turn = determineTurn(room);

  var result = {
    ok:      true,
    roomId:  roomId,
    phase:   room.phase,
    turn:    turn,
    winner:  room.winner,
    players: playersPublic,
    shotsP1: room.shotsP1,
    shotsP2: room.shotsP2
  };

  if (playerId) {
    var myPlayer = players.filter(function(p){ return p.playerId === playerId; })[0];
    if (myPlayer) {
      try { result.myBoard = JSON.parse(myPlayer.shipBoard); } catch(e) { result.myBoard = null; }
      result.mySlot = myPlayer.slot;
    }
  }

  return result;
}

// ── ОПРЕДЕЛЕНИЕ ЧЬЕГО ХОДА ──────────────────────────────────
function determineTurn(room) {
  var sheet = getSheet(SHEET_NAME_ROOMS);
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === room.roomId) {
      return data[i][10] || "";
    }
  }
  return "";
}

function setTurn(roomRow, playerId) {
  var sheet = getSheet(SHEET_NAME_ROOMS);
  sheet.getRange(roomRow, 11).setValue(playerId);
}

// ── ХОД ИГРОКА ──────────────────────────────────────────────
function makeMove(data) {
  var playerId = data.playerId;
  var roomId   = data.roomId;
  var x        = parseInt(data.x);
  var y        = parseInt(data.y);

  if (!playerId)              return { ok: false, error: "Нет playerId" };
  if (!roomId)                return { ok: false, error: "Нет roomId" };
  if (isNaN(x) || isNaN(y))  return { ok: false, error: "Неверные координаты" };
  if (x < 0 || x > 9 || y < 0 || y > 9) return { ok: false, error: "Координаты вне поля" };

  var room = findRoom(roomId);
  if (!room) return { ok: false, error: "Комната не найдена" };
  if (room.phase !== "playing") return { ok: false, error: "Игра не идёт" };

  var turn = determineTurn(room);
  if (turn !== playerId) return { ok: false, error: "Сейчас не ваш ход" };

  var players = readPlayersOfRoom(roomId);
  var shooter  = players.filter(function(p){ return p.playerId === playerId; })[0];
  if (!shooter) return { ok: false, error: "Игрок не найден" };

  var opponent = players.filter(function(p){ return p.playerId !== playerId; })[0];
  if (!opponent) return { ok: false, error: "Противник не найден" };

  var shotsKey = shooter.slot === 1 ? "shotsP1" : "shotsP2";
  var shots    = room[shotsKey];

  // Проверяем: уже стреляли в эту клетку?
  for (var i = 0; i < shots.length; i++) {
    if (shots[i].x === x && shots[i].y === y) {
      return { ok: false, error: "В эту клетку уже стреляли" };
    }
  }

  // Читаем корабли противника
  var opponentBoard;
  try { opponentBoard = JSON.parse(opponent.shipBoard); }
  catch(e) { return { ok: false, error: "Ошибка данных противника" }; }

  var cellValue = opponentBoard[y][x];
  var hit = cellValue === 1;
  var result = hit ? "hit" : "miss";

  var sunkCells = [];
  var sunkPerimeter = [];
  var sunk = false;

  if (hit) {
    opponentBoard[y][x] = 2;
    var opSheet = getSheet(SHEET_NAME_PLAYERS);
    var opData  = opSheet.getDataRange().getValues();
    for (var r = 1; r < opData.length; r++) {
      if (opData[r][0] === opponent.playerId) {
        opSheet.getRange(r + 1, 5).setValue(JSON.stringify(opponentBoard));
        break;
      }
    }

    var sunkResult = checkShipSunk(opponentBoard, x, y);
    sunk = sunkResult.sunk;
    if (sunk) {
      result = "sunk";
      sunkCells     = sunkResult.cells;
      sunkPerimeter = sunkResult.perimeter;
    }
  }

  var shotObj = { x: x, y: y, result: result };
  if (sunk) {
    shotObj.sunkCells     = sunkCells;
    shotObj.sunkPerimeter = sunkPerimeter;
  }
  shots.push(shotObj);

  // Обновляем выстрелы в таблице комнат
  var roomSheet = getSheet(SHEET_NAME_ROOMS);
  var roomData  = roomSheet.getDataRange().getValues();
  for (var ri = 1; ri < roomData.length; ri++) {
    if (roomData[ri][0] === roomId) {
      var shotsColIdx = shooter.slot === 1 ? 8 : 9;
      roomSheet.getRange(ri + 1, shotsColIdx).setValue(JSON.stringify(shots));
      roomSheet.getRange(ri + 1, 7).setValue(new Date().toISOString());
      break;
    }
  }

  // Записываем в журнал выстрелов
  var logSheet = getSheet(SHEET_NAME_LOG);
  var newLogRow = (logSheet.getLastRow() || 1) + 1;
  logSheet.appendRow([
    new Date().toLocaleString("ru-RU"),
    roomId,
    playerId,
    shooter.nickname,
    x, y,
    result
  ]);
  _styleNewRow(logSheet, newLogRow, 7);

  // Проверяем победу
  var won = isGameOver(opponentBoard);
  if (won) {
    var roomSheetW = getSheet(SHEET_NAME_ROOMS);
    var roomDataW  = roomSheetW.getDataRange().getValues();
    for (var wi = 1; wi < roomDataW.length; wi++) {
      if (roomDataW[wi][0] === roomId) {
        roomSheetW.getRange(wi + 1, 6).setValue("finished");
        roomSheetW.getRange(wi + 1, 10).setValue(playerId);
        break;
      }
    }
    // Записываем в историю игр
    _logGameHistory(room, shooter, opponent, shots);

    return { ok: true, result: result, sunk: sunk, sunkCells: sunkCells, sunkPerimeter: sunkPerimeter, gameOver: true, winner: playerId };
  }

  // Управление очерёдью
  var roomRow = null;
  var roomDataT = getSheet(SHEET_NAME_ROOMS).getDataRange().getValues();
  for (var ti = 1; ti < roomDataT.length; ti++) {
    if (roomDataT[ti][0] === roomId) { roomRow = ti + 1; break; }
  }
  if (roomRow) {
    var nextTurn = hit ? playerId : opponent.playerId;
    setTurn(roomRow, nextTurn);
  }

  return {
    ok: true,
    result: result,
    sunk: sunk,
    sunkCells: sunkCells,
    sunkPerimeter: sunkPerimeter,
    gameOver: false,
    nextTurn: hit ? playerId : opponent.playerId
  };
}

// ── ЗАПИСЬ В ИСТОРИЮ ИГР ────────────────────────────────────
function _logGameHistory(room, winner, loser, winnerShots) {
  try {
    var sheet = getSheet(SHEET_NAME_HISTORY);
    var now   = new Date();

    // Длительность: от lastActivity комнаты (примерно)
    var startMs = room.lastActivity ? new Date(room.lastActivity).getTime() : now.getTime();
    var durationMin = Math.round((now.getTime() - startMs) / 60000);

    // Кол-во выстрелов
    var loserShotsKey = loser.slot === 1 ? "shotsP1" : "shotsP2";
    var loserShots = room[loserShotsKey] ? room[loserShotsKey].length : 0;

    var newRow = (sheet.getLastRow() || 1) + 1;
    sheet.appendRow([
      now.toLocaleString("ru-RU"),
      room.roomId,
      winner.nickname,
      loser.nickname,
      winnerShots.length,
      loserShots,
      durationMin,
      "Потоплены все корабли"
    ]);

    // Стиль новой строки — золотая для победителя
    var rng = sheet.getRange(newRow, 1, 1, 8);
    var bg = (newRow % 2 === 0) ? CLR.SEAFOAM : CLR.WHITE;
    rng.setBackground(bg)
       .setFontColor(CLR.DARK_TEXT)
       .setFontSize(9)
       .setVerticalAlignment("middle");
    // Выделяем ник победителя золотым
    sheet.getRange(newRow, 3)
         .setBackground(CLR.GOLD)
         .setFontWeight("bold")
         .setFontColor(CLR.DARK_TEXT);
    sheet.setRowHeight(newRow, 24);

    // Обновляем статистику
    _updateStats(winner.nickname, loser.nickname, winnerShots.length);
  } catch(e) {}
}

// ── ОБНОВЛЕНИЕ СТАТИСТИКИ ────────────────────────────────────
function _updateStats(winnerNick, loserNick, winnerShotCount) {
  try {
    var sheet = getSheet(SHEET_NAME_STATS);
    // Данные начинаются с 4-й строки (1=баннер, 2=подзаголовок, 3=шапка)
    var DATA_START = 4;
    var lastRow = sheet.getLastRow();

    // Читаем текущие данные
    var statsMap = {};
    if (lastRow >= DATA_START) {
      var existing = sheet.getRange(DATA_START, 1, lastRow - DATA_START + 1, 7).getValues();
      for (var i = 0; i < existing.length; i++) {
        var nick = existing[i][1];
        if (!nick) continue;
        statsMap[nick] = {
          games:   existing[i][2] || 0,
          wins:    existing[i][3] || 0,
          losses:  existing[i][4] || 0,
          totalWinShots: (existing[i][6] || 0) * (existing[i][3] || 1) // восстанавливаем сумму
        };
      }
    }

    // Обновляем победителя
    if (!statsMap[winnerNick]) statsMap[winnerNick] = { games: 0, wins: 0, losses: 0, totalWinShots: 0 };
    statsMap[winnerNick].games++;
    statsMap[winnerNick].wins++;
    statsMap[winnerNick].totalWinShots += winnerShotCount;

    // Обновляем проигравшего
    if (!statsMap[loserNick]) statsMap[loserNick] = { games: 0, wins: 0, losses: 0, totalWinShots: 0 };
    statsMap[loserNick].games++;
    statsMap[loserNick].losses++;

    // Сортируем по победам desc, потом по win% desc
    var sorted = [];
    for (var n in statsMap) {
      if (statsMap.hasOwnProperty(n)) {
        var s = statsMap[n];
        sorted.push({
          nick: n,
          games: s.games,
          wins: s.wins,
          losses: s.losses,
          winPct: s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0,
          avgShots: s.wins > 0 ? Math.round(s.totalWinShots / s.wins) : 0
        });
      }
    }
    sorted.sort(function(a, b) {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.winPct - a.winPct;
    });

    // Очищаем и записываем данные
    if (lastRow >= DATA_START) {
      sheet.getRange(DATA_START, 1, lastRow - DATA_START + 1, 7).clearContent();
      sheet.getRange(DATA_START, 1, lastRow - DATA_START + 1, 7).clearFormat();
    }

    for (var j = 0; j < sorted.length; j++) {
      var rowNum = DATA_START + j;
      var entry = sorted[j];
      var medal = j === 0 ? "🥇" : j === 1 ? "🥈" : j === 2 ? "🥉" : String(j + 1);
      sheet.getRange(rowNum, 1, 1, 7).setValues([[
        medal,
        entry.nick,
        entry.games,
        entry.wins,
        entry.losses,
        entry.winPct + "%",
        entry.avgShots
      ]]);

      // Стили строки
      var rowBg = j === 0 ? CLR.GOLD : (j % 2 === 0 ? CLR.SEAFOAM : CLR.WHITE);
      var rowBold = j === 0;
      sheet.getRange(rowNum, 1, 1, 7)
           .setBackground(rowBg)
           .setFontColor(CLR.DARK_TEXT)
           .setFontSize(9)
           .setFontWeight(rowBold ? "bold" : "normal")
           .setHorizontalAlignment("center")
           .setVerticalAlignment("middle");
      sheet.setRowHeight(rowNum, 26);
    }
  } catch(e) {}
}

// ── ПРОВЕРКА: УНИЧТОЖЕН ЛИ КОРАБЛЬ ──────────────────────────
function checkShipSunk(board, hitX, hitY) {
  var visited = [];
  for (var r = 0; r < 10; r++) visited.push([false,false,false,false,false,false,false,false,false,false]);

  var queue = [{x: hitX, y: hitY}];
  var cells = [];
  visited[hitY][hitX] = true;

  while (queue.length > 0) {
    var cur = queue.shift();
    cells.push(cur);
    var dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    for (var d = 0; d < dirs.length; d++) {
      var nx = cur.x + dirs[d].dx;
      var ny = cur.y + dirs[d].dy;
      if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10 && !visited[ny][nx] &&
          (board[ny][nx] === 1 || board[ny][nx] === 2)) {
        visited[ny][nx] = true;
        queue.push({x: nx, y: ny});
      }
    }
  }

  for (var i = 0; i < cells.length; i++) {
    if (board[cells[i].y][cells[i].x] === 1) return { sunk: false, cells: [], perimeter: [] };
  }

  var cellSet = {};
  cells.forEach(function(c){ cellSet[c.y + "_" + c.x] = true; });

  var perimeter = [];
  var perimSet  = {};
  cells.forEach(function(c) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dy === 0 && dx === 0) continue;
        var nx = c.x + dx, ny = c.y + dy;
        if (nx < 0 || nx > 9 || ny < 0 || ny > 9) continue;
        var key = ny + "_" + nx;
        if (!cellSet[key] && !perimSet[key]) {
          perimSet[key] = true;
          perimeter.push({x: nx, y: ny});
        }
      }
    }
  });

  return { sunk: true, cells: cells, perimeter: perimeter };
}

// ── ПРОВЕРКА: ИГРА ЗАВЕРШЕНА? ────────────────────────────────
function isGameOver(board) {
  for (var r = 0; r < 10; r++)
    for (var c = 0; c < 10; c++)
      if (board[r][c] === 1) return false;
  return true;
}

// ── ЯВНЫЙ ВЫХОД ИГРОКА ──────────────────────────────────────
function leaveGame(data) {
  var playerId = data.playerId;
  var roomId   = data.roomId;
  if (!playerId) return { ok: false, error: "Нет playerId" };

  var me = findPlayerById(playerId);
  if (me) removePlayerRow(me.row);

  if (roomId) {
    var room = findRoom(roomId);
    if (room && room.phase === "playing") {
      var sheet = getSheet(SHEET_NAME_ROOMS);
      var data2 = sheet.getDataRange().getValues();
      for (var i = 1; i < data2.length; i++) {
        if (data2[i][0] === roomId) {
          sheet.getRange(i + 1, 6).setValue("waiting");
          if (room.player2Id === playerId) {
            sheet.getRange(i + 1, 4).setValue("");
            sheet.getRange(i + 1, 5).setValue("");
          }
          sheet.getRange(i + 1, 8).setValue("[]");
          sheet.getRange(i + 1, 9).setValue("[]");
          sheet.getRange(i + 1, 10).setValue("");
          sheet.getRange(i + 1, 11).setValue("");
          sheet.getRange(i + 1, 7).setValue(new Date().toISOString());
          break;
        }
      }
    } else if (room && room.phase === "waiting") {
      deletePlayersOfRoom(roomId);
      var sheet2 = getSheet(SHEET_NAME_ROOMS);
      var data3  = sheet2.getDataRange().getValues();
      for (var j = data3.length - 1; j >= 1; j--) {
        if (data3[j][0] === roomId) {
          // Очищаем перед удалением
          sheet2.getRange(j + 1, 1, 1, sheet2.getLastColumn()).clearContent();
          sheet2.deleteRow(j + 1);
          break;
        }
      }
    }
  }

  return { ok: true, message: "Вы вышли из игры" };
}

// ── СПИСОК КОМНАТ (ADMIN) ────────────────────────────────────
function listRoomsAdmin(data) {
  var password = (data.password || "").trim();
  if (password !== ADMIN_PASSWORD) return { ok: false, error: "Неверный пароль" };
  initSheets();
  cleanupOldRooms();
  var rooms = readRooms();
  var out = [];
  for (var i = 0; i < rooms.length; i++) {
    var r = rooms[i];
    var n = 0;
    if (r.player1Id) n++;
    if (r.player2Id) n++;
    out.push({
      roomId:        r.roomId,
      phase:         r.phase,
      playerCount:   n,
      player1Nick:   r.player1Nick || "",
      player2Nick:   r.player2Nick || "",
      lastActivity:  r.lastActivity
    });
  }
  return { ok: true, rooms: out };
}

// ── ПЕРЕЗАПУСК ИГРЫ (ADMIN) ──────────────────────────────────
function restartGame(data) {
  var password = (data.password || "").trim();
  var roomId   = data.roomId;
  if (password !== ADMIN_PASSWORD) return { ok: false, error: "Неверный пароль" };

  if (roomId) {
    deletePlayersOfRoom(roomId);
    var sheet = getSheet(SHEET_NAME_ROOMS);
    var data2 = sheet.getDataRange().getValues();
    for (var i = data2.length - 1; i >= 1; i--) {
      if (data2[i][0] === roomId) {
        sheet.getRange(i + 1, 1, 1, sheet.getLastColumn()).clearContent();
        sheet.deleteRow(i + 1);
        break;
      }
    }
    return { ok: true, message: "Комната удалена" };
  }

  // Без roomId — очистить активные данные (история сохраняется)
  var rs = getSheet(SHEET_NAME_ROOMS);
  var rLast = rs.getLastRow();
  if (rLast > 1) rs.deleteRows(2, rLast - 1);

  var ps = getSheet(SHEET_NAME_PLAYERS);
  var pLast = ps.getLastRow();
  if (pLast > 1) ps.deleteRows(2, pLast - 1);

  return { ok: true, message: "Все активные комнаты удалены" };
}