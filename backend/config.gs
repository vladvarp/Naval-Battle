// ============================================================
// МОРСКОЙ БОЙ — Google Apps Script Backend
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
var FORMAT_VERSION           = "v3.8"; // Увеличить при изменении структуры

function resolveRoomTimeoutMs(rawValue) {
  var ms = parseInt(rawValue, 10);
  if (isNaN(ms)) return ROOM_TIMEOUT_MS;
  // Защита от слишком маленьких/больших значений с клиента.
  if (ms < 60 * 1000) ms = 60 * 1000;
  if (ms > 30 * 60 * 1000) ms = 30 * 60 * 1000;
  return ms;
}

function resolveRoomCreatedAt(roomId, createdAtRaw, fallbackRaw) {
  if (createdAtRaw) return createdAtRaw;
  // Для старых строк без колонки createdAt восстанавливаем время из roomId: id_<timestamp>_<rnd>.
  var m = /^id_(\d+)_/.exec(String(roomId || ""));
  if (m && m[1]) {
    var ts = parseInt(m[1], 10);
    if (!isNaN(ts) && ts > 0) return new Date(ts).toISOString();
  }
  return fallbackRaw || "";
}

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