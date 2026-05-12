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
