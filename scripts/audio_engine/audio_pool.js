// Пул рандомайзера: случайное число 0..(RANDOM_POOL_SIZE-1), затем % n → индекс файла.
// makeFiles(10),  число 304 → 304%10=4  → 5.mp3
// makeFiles(40),  число 304 → 304%40=24 → 25.mp3
var RANDOM_POOL_SIZE = 100;

function makeFiles(n) {
  var arr = [];
  for (var i = 1; i <= n; i++) arr.push(i + ".mp3");
  return arr;
}
function makeFiles10() { return makeFiles(10); }

var AUDIO_EVENTS = [
  { id: "gameStart", label: "🎮 - 1️⃣",                    folder: "audio/gameStart", files: makeFiles(23) }, // "🎮 Начало игры"
  { id: "gameWin",   label: "🏆 - 1️⃣",                    folder: "audio/gameWin",   files: makeFiles(10) }, // "🏆 Победа"
  { id: "gameLose",  label: "💀 - 1️⃣",                    folder: "audio/gameLose",  files: makeFiles(10) }, // "💀 Поражение"
  { id: "shoot",     label: "💥 - 1️⃣",                    folder: "audio/shoot",     files: makeFiles(47) }, // "💥 Выстрел наш"
  { id: "hitEnemy",  label: "🎯 - 1️⃣",                    folder: "audio/hitEnemy",  files: makeFiles(30) }, // "🎯 Попадение по противнику"
  { id: "hitMe",     label: "🎯 - 2️⃣",                    folder: "audio/hitMe",     files: makeFiles(30) }, // "🎯 Попадение по нам"
  { id: "sunkMe",    label: "⚓ - 1️⃣",                    folder: "audio/sunkMe",    files: makeFiles(31) }, // "⚓ Корабль потоплен наш"
  { id: "sunkEnemy", label: "⚓ - 2️⃣",                    folder: "audio/sunkEnemy", files: makeFiles(30) }, // "⚓ Корабль потоплен противника"
  { id: "miss",      label: "🌊 - 1️⃣",                    folder: "audio/miss",      files: makeFiles(46) }, // "🌊 Промах наш"
  { id: "enemyMiss", label: "🌊 - 2️⃣",                    folder: "audio/enemyMiss", files: makeFiles(32) }, // "🌊 Промах противника"
  { id: "turnMine",  label: "⏳ - 1️⃣",                    folder: "audio/turnMine",  files: makeFiles(31) }, // "⏳ Ход наш"
  { id: "turnEnemy", label: "⏳ - 2️⃣",                    folder: "audio/turnEnemy", files: makeFiles(29) }, // "⏳ Ход противника"
];

var audioState = {
  enabled: (localStorage.getItem("mb_sound_enabled") !== "0"),
  volume: 0.75,
  unlocked: false,
  cache: {},
  // Очередь: звуки не глушат друг друга, а играют по очереди до конца
  queue: [],
  queuePlaying: false,
  lastPlayerShotAt: 0,
  preload: { started: false, done: false, total: 0, finished: 0, promise: null, currentSrc: null, phase: "" },
  // Вероятности в рамках сессии/игры: на каждую категорию — 100 значений пула с весами.
  // Изначально все веса = 1, после выпадения значения вес делится на 2 (1 → 0.5 → 0.25 ...).
  rand: { poolSize: RANDOM_POOL_SIZE, byEvent: {} },
};