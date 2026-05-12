// ── ПОЛУЧЕНИЕ ТУРНИРНОЙ ТАБЛИЦЫ (лист «Статистика») ──────────
function getStats(e) {
  try {
    var sheet = getSheet(SHEET_NAME_STATS);
    var DATA_START = 4; // 1=баннер, 2=подзаголовок, 3=шапка
    var lastRow = sheet.getLastRow();
    if (lastRow < DATA_START) return { ok: true, rows: [] };

    var values = sheet.getRange(DATA_START, 1, lastRow - DATA_START + 1, 7).getValues();
    var rows = [];
    for (var i = 0; i < values.length; i++) {
      var r = values[i];
      var nick = r[1];
      if (!nick) continue;
      rows.push({
        place: r[0],
        nick: nick,
        games: r[2] || 0,
        wins: r[3] || 0,
        losses: r[4] || 0,
        winPct: r[5],
        avgShots: r[6] || 0
      });
    }

    return {
      ok: true,
      updatedAt: new Date().toISOString(),
      rows: rows
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
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
  rebuildStatsFromHistory();
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
      "🏆 Победитель ID", "🔄 Чей ход (ID)",
      "🔐 Тип комнаты", "🔑 Хэш пароля", "🆕 Время создания"
    ]);
  }
  // Для уже существующих таблиц добавляем заголовок новой колонки.
  if (!sheet.getRange(1, 14).getValue()) sheet.getRange(1, 14).setValue("🆕 Время создания");

  // Ширины столбцов
  var widths = [100, 150, 120, 150, 120, 100, 170, 250, 250, 150, 150, 120, 220, 170];
  for (var i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }

  // Заголовок
  var hdr = sheet.getRange(1, 1, 1, 14);
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
  _applyDataRowStyles(sheet, 14);

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
