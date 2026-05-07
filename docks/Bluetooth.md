# 🔍 ПОЛНЫЙ ОБЗОР ПРОЕКТА NAVAL BATTLE

## Архитектура системы

```
[Браузер: HTML/CSS/JS]
         ↓ HTTP/HTTPS (polling 800 мс)
[Google Apps Script Web App]
         ↓
[Google Sheets: Комнаты, Игроки, Журнал]
```


## Ключевые модули:

| `backend/Code.js`                   | сервер на Google Apps Script `(v3.0, 1437 строк)`   |
| ----------------------------------- | --------------------------------------------------- |
| `scripts/engine.js`                 | клиентская логика `(1257+ строк)`                   |
| `scripts/placement_setup.js`        | drag-and-drop расстановка кораблей `(568 строк)`    |
| `scripts/audio_engine/audio_v2.js`  | Web Audio API движок `(952 строк)`                  |
| `scripts/system/network_tracker.js` | перехват fetch, детальный трекер сети `(827 строк)` |


## Существующие режимы:

### Онлайн PvP — через *Google Apps Script* + *Sheets (`polling 800 мс`)*
### Соло (vs AI) — локальный, без сервера

# 📱 BLUETOOTH РЕЖИМ: ПОДВОДНЫЕ КАМНИ И ОГРАНИЧЕНИЯ (Android ↔ iPhone)

## 1. ФУНДАМЕНТАЛЬНОЕ ОГРАНИЧЕНИЕ iOS Safari

| Способ                 | Android Chrome     |	iOS Safari | Комментарий                                                                                   |
| ---------------------- | ------------------ | --------   | --------------------------------------------------------------------------------------------- |
| Web Bluetooth API      | ✅ Да (Chrome 56+) | ❌ НЕТ    | Apple отказалась от поддержки в Safari. Есть только в WebView (WKWebView) нативных приложений |
| WebRTC (P2P через LAN) | ✅ Да              | ✅ Да     | Через mDNS/STUN/TURN, но нужен signalling-сервер (или QR-код)                                 |
| LocalHost / LAN socket | ❌ Нет             | ❌ Нет    | Браузеры блокируют raw sockets                                                                |

``Вывод: Прямой Bluetooth из браузера невозможен на iPhone. Решение только через нативную обёртку (Cordova/Capacitor/React Native) или пере hack через WebRTC.``

## 2. АРХИТЕКТУРНЫЕ ПРОБЛЕМЫ ДЛЯ BLUETOOTH P2P

**БАЛАНС ИГРЫ:** синхронизация в реальном времени

`Текущий HTTP-механизм: клиент polling каждые 800 мс. Для Bluetooth P2P нужно:`

| Проблема                    | Ограничение                               | Риск                                                     |
| --------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| **Синхронизация состояния** |	Нет центрального сервера                  | Десинхрон при рассинхронных кликтах                      |
| **Очерёдность ходов**       | Кто первый? (player1 всегда ходит первым) | "`Double submission`" — оба игрока стреляют одновременно |
| **Валидация выстрела**      | Кто проверяет правила?                    | Чит: клиент может подменить `myBoard`                    |
| **А巨头治理**                | Никто не может "кикнуть" игрока           | Зависший соперник блокирует игру                         |
| **Отсоединение**            | Связь рвётся — что делать?                | Проигрыш/ничья/переподключение?                          |

Латентность **Bluetooth Classic vs BLE**

|Технология                      | Задержка (RTT)                                  | Пропускная способность        | Поддержка iPhone                 |
| ------------------------------ | ----------------------------------------------- | ----------------------------- | -------------------------------- |
| **Bluetooth Classic (SPP)**    | `~50-150 мс`                                    | `~1-2 Mbps`                   | ❌ НЕТ (*закрытый профиль*)      |
| **Bluetooth Low Energy (BLE)** | `~30-100 мс` (но 7.5 мс *advertising interval*) | `~0.5-1 Mbps` (*20 B пакеты*) | ✅ Да (*Central+Peripheral*)     |
| **WiFi Direct**                | `~20-50 мс`                                     | `~50+ Mbps`                   | ✅ Да (*Multipeer Connectivity*) |

**BLE** ограничения:

- **MTU** ≤ 20-512 байт (зависит от версии iOS/Android)
- **Advertising interval** ≥ 20-100 мс (economy mode)
- **Connection interval** 7.5-4000 мс (iOS минимум 30 мс для стабильности)
- Нужно **serialize JSON**-состояния (комнаты ~200-500 байт)

## 3. ПРОТОКОЛ ОБМЕНА ДАННЫМИ (предлагаемый)

```
// Сообщение в JSON (подходит для BLE, размер ~200 байт)
// Оптимизация: вместо полного board передавать только changes

// Ход игрока → {type:'move', x:3, y:7, turnId:123, room:'AB12C'}
// Ответ → {type:'result', hit:true, sunk:false, nextTurn:'id_...', turnId:124}

// Heartbeat каждые 5 сек → {type:'ping', ts:1234567890}
```

Критические данные для синхронизации:

```js
1. При joinRoom:
  - playerId (генерация на стороне клиента — IDEMPOTENT!)
  - roomId (5-символьный код)
  - shipBoard (10×10 = 100 байт в бинарном виде → JSON ~200-300 байт)
2. Во время игры:
  - move: {x, y, turnCounter}
  - state: {shotsP1[], shotsP2[], turn:playerId, phase:'playing'|'finished'}
3. При выигрыше:
  - winner.playerId
  - timestamp (локальное время)
```

## 4. ИДЕНТИФИКАЦИЯ ИГРОКОВ И КОМНАТ


Текущая система:

```js
playerId = "id_" + Date.now() + "_" + Math.floor(Math.random()*9999);
roomId   = 5-символьный код из алфавита (без O,I,0) → ~14^5 = 537 824 комбинаций
```

Проблема для **Bluetooth P2P:**

- Нет центрального сервера → `playerId` генерируется на каждом устройстве независимо
- Риск коллизии: два iPhone одновременно создают комнату с одинаковым `playerId` (~1/10000)
- **Решение:** `UUID v4 (16 байт)` + `MAC-адрес (BLE advertising)` → `collision-free`


## 5. ПОПЫТКА РЕАЛИЗАЦИИ ЧЕРЕЗ WEB BLUETOOTH (ТОЛЬKO **Android**)

```
// navigator.bluetooth.requestDevice({filters:[{services:['0000ffe0-0000-1000-8000-00805f9b34fb']}]})
// .then(device => device.gatt.connect())
// .then(server => server.getPrimaryService('...'))
```

Проблемы:

1. **На iOS Safari:** `navigator.bluetooth === undefined` — падение кода
2. **Пользовательский опыт:** каждый раз запрос "разрешить Bluetooth" при входе в игру
3. **Фоновый режим:** iOS приостанавливает BLE приложения при сворачивании (если не background-mode)
4. **Android 13+ требования:** `BLUETOOTH_CONNECT` permission в манифесте (не в вебе)


## 6. АЛЬТЕРНАТИВНЫЙ ПОДХОД: **WebRTC P2P** БЕЗ СЕРВЕРА
```
// signaling через QR-код или "звуковой handshake"
// RTCPeerConnection с dataChannel (SCTP)
// Нужен STUN/TURN? Для локальной сети можно avoid
```

**Плюсы:**

- ✅ Работает в **Safari** на **iOS** (`WebRTC` есть)
- ✅ Нет серверных затрат (после `handshake`)

**Минусы:**

- ❌ Сложность реализации (`ICE candidates, SDP`)
- ❌ **NAT traversal** для интернета всё равно нужен **TURN**
- ❌ Поддержка **dataChannel** в **Safari iOS 14+** (но OK)

## 7. ПРАКТИЧЕСКИЕ РЕКОМЕНДАЦИИ

**Вариант A: Нативное приложение на Capacitor/Cordova**

```cs
npm init capacitor-app naval-bluetooth
npx cap add android
npx cap add ios
```

Плюсы:

- Полный доступ к **Bluetooth** (B`lueprint/Android Bluetooth API`)
- Один код-база (`WebView` + нативные плагины)
- Возможность **background-mode**

Минусы:

- Переписывание UI под нативную обёртку
- Процесс публикации в App Store / Google Play

Вариант B: WebRTC через LAN (самый реалистичный для веба)

```
// Алгоритм:
// 1. Игрок A создаёт комнату → генерируетOffer(SDP) + fingerprint
// 2. Игрок B сканирует QR-код или вводит 6-символьный код (short SDP hash)
// 3. Устанавливается P2P-канал через localNetwork (multipeer connectivity на iOS)
```

Требуемые разрешения в `manifest.json` **(PWA):**

```json
{
  "name": "Naval Bluetooth",
  "short_name": "NavalBT",
  "display": "standalone",
  "icons": [...],
  "prefer_related_applications": false,
  "protocol_handlers": [...],
  // НЕТ Bluetooth permissions в Web — только native
}
```

## 8. ОГРАНИЧЕНИЯ БЛЮТУСА MEЖДУ ANDROID & IOS

| Категория                 | Ограничение                                           | Влияние на игру                         |
| ------------------------- | ----------------------------------------------------- | --------------------------------------- |
| **BLE advertising**       | iOS: max 10 advertisings/sec (спам-защита)            | Реклама комнаты частота ≤ 1 Гц          |
| **BLE MTU**               | iOS 185 байт, Android 517 байт                        | Разделение пакетов (fragmentation)      |
| **Connection interval**   | iOS: 30-100 мс минимум                                | Задержки выше, чем у Wi-Fi Direct       |
| **Background mode**       | iOS: при сворачивании — пауза коннекта                | Игра должна работать на переднем плане  |
| Паролинг                  | iOS: "Just Works" или passkey (6 цифр)                | Пользователь должен подтвердить pairing |
| **Duplicate advertising** | iOS запрещает одинаковые service UUIDs с другими apps | Уникальный UUID для Naval Battle        |
| **Privacy**               | iOS 13+: MAC randomizes (per-app)                     | Нельзя использовать MAC как ID          |

## 9. БЕЗОПАСНОСТЬ И ЧИТЫ
Текущая уязвимость (онлайн-режим):

```
// Клиент может подменить:
// - shipBoard (расставить корабли как угодно)
// - shots (фальшивые попадания)
// Но сервер валидирует по opponent.shipBoard — сравнивает с сохранённым
```

В **Bluetooth P2P** (без сервера):

- ❌ Каждый клиент — источник истины
- ❌ Можно модифицировать `JSON.parse` в console и добавить себе 100 попаданий
- Решение: Обязательная криптография (**HMAC**) для каждого хода:

  ```
  // signature = HMAC-SHA256(secretRoomKey, move+turnCounter)
  ```

## 10. ВРЕМЯ РАЗРАБОТКИ (оценка)

| Этап                                                    | Затраты (чел/часы) | Комментарий                  |
| ------------------------------------------------------- | ------------------ | ---------------------------- |
| Прототип **Web Bluetooth (Android-only)**               | 8-12 ч             | Отказ на iOS                 |
| Нативное приложение **Capacitor + Bluetooth LE plugin** | 40-60 ч            | + русификация, тесты         |
| **WebRTC dataChannel P2P (cross-platform)**             | 30-45 ч            | Signaling server минимальный |
| Безопасность **(anti-cheat HMAC)**                      | 8-12 ч             | Обязательно для P2P          |
| Тестирование на девайсах                                | 12-20 ч            | 5 Android + 3 iPhone         |

Итого: Для кросс-платформенного **Bluetooth P2P** — **минимум 60-90 часов** `Senior dev`.

# ⚠️ КЛЮЧЕВЫЕ ПРЕДУПРЕЖДЕНИЯ

### 1. **Apple App Store Review Guidelines — 4.5**

  ```
  Apps using Bluetooth must disclose purpose and may be rejected if used for non-essential features
  ```

  `→ Если делать нативное приложение, нужно обосновать "Bluetooth для игры с другом без интернета". Вероятность reject — 30-40%.`

### 2. **Android 12+ — Bluetooth permission**s в `manifest`

```json
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
```

**Runtime-запрос** у пользователя (не в браузере).

### 3. Проблема времени — Google Apps Script:
  - **GAS execution time limit:** 30 сек (free), 6 мин (`workspace`)
  - При 800 мс `polling`: 45 запросов/мин → 500 запросов/день бесплатно
  - **Bluetooth P2P** снизит нагрузку на **GAS**, но добавит сложность клиента

### 4. **iOS Safari** — нет Service Worker для audio в `file://`

Если открыть `index.html` локально, `sw.js` не работает → звуки только если кэш в памяти. Но для **Bluetooth** нужна локальная сеть — не `file://`.

# 🎯 МИНИМАЛЬНЫЙ ПРАГМАТИЧНЫЙ ПУТЬ

**Рекомендую не Bluetooth, а "LAN-режим" через HTTP на локальном сервере:**

```
// 1. Игрок A: "Создать LAN-комнату" → стартует локальный HTTP-сервер (Node.js / Python)
// 2. Игрок B: "Присоединиться по LAN" → сканирует mDNS (_http._tcp) или вводит IP:port
// 3. Обмен через WebSocket или polling (как сейчас, но LAN)
```

**Преимущества:**

- ✅ Работает на всех устройствах (браузерный)
- ✅ Нет ограничений BLE MTU
- ✅ Нет permission-диалогов
- ✅ Можно использовать текущий код (`fetch` просто на local IP)

**Минус:** Требуется, чтобы хост имел Python/Node.js запущенным — но это уже complication.

# 📋 ЧТО ДЕЛАТЬ ДАЛЕЕ
Если хотите реализовать Bluetooth-режим, вот дорожная карта:

**Этап 1: Proof of Concept (Android-only)**

```py
// scripts/bluetooth_poc.js
if (navigator.bluetooth) {
  // Сканирование устройств с именем "NavalBattle"
  // Запрос разрешения
  // Подключение к GATT серверу
}
```

**Этап 2: Протокол обмена (BLE GATT)**

```
Service UUID: 0000feed-0000-1000-8000-00805f9b34fb
Characteristic (notify): 0000beef-0000-1000-8000-00805f9b34fb

Format: [roomId:5][msgType:1][payload:var]
msgType: 0x01=move, 0x02=state, 0x03=join, 0x04=leave
```

**Этап 3: Нативная обёртка**

- Создать Capacitor plugin `capacitor-bluetooth-serial` или `@capacitor-community/bluetooth-le`
- Обернуть в `window.NavalBluetooth = { connect, send, onMessage }`
- В `engine.js` добавить `BluetoothTransport` alongside `HttpTransport`


**Этап 4: Cross-platform fallback**

- Если `window.cordova && window.bluetoothSerial` → использовать **Bluetooth**
- Иначе если `navigator.bluetooth` (Chrome Android) → Web **Bluetooth API**
- Иначе → показать "только **Android/iOS** нативное приложение"

### **❗ САМЫЙ БОЛЬШОЙ ПОДВОДНЫЙ КАМЕНЬ**

**Safari iOS не поддерживает Web Bluetooth — значит, без нативного приложения режим невозможен на iPhone. Это принципиальное ограничение, а не баг.**

Если задача "играть по **Bluetooth** между **Android** и **iPhone**", варианты:

1. **React Native** / Flutter приложение — пишете с нуля (уже не ваш веб-код)
2. **WebRTC** через локальный сервер signalling — обходной путь, но требует интернет для первоначального handshake
3. **Cancel iOS support** — режим "только Android", но тогда 50% аудитории теряется

# 📊 СРАВНИТЕЛЬНАЯ ТАБЛИЦА ВОЗМОЖНОСТЕЙ

| Режим                    | Платформы                   | Сервер                     | Задержка    | Разработка          |
| ------------------------ | --------------------------- | -------------------------- | ----------- | ------------------- |
| **Онлайн (GAS)**         | Все браузеры                | Google Apps Script         | 200-2000 мс | ✅ Есть             |
| **Соло (AI)**            | Все браузеры                | ❌ Нет                     | мгновенная  | ✅ Есть            |
| **Web Bluetooth**        | Только Android Chrome       | ❌ Нет                     | 30-100 мс   | ❌ iOS не работает |
| **BLE Native**           | Android + iOS (приложение)  | ❌ Нет                     | 30-150 мс   | 🔴 Переделка       |
| **WebRTC P2P**           | Все браузеры (iOS 14+)      | Signaling-сервер (minimal) | 50-200 мс   | 🟡 Сложный          |
| **LAN** (`Node.js` host) | Все (если есть Python/Node) | Локальный сервер           | 10-50 мс    | 🟡 Нишевый          |

# 🔚 ВЫВОД

**Bluetooth-режим** между **Android** и **iPhone** в текущем веб-приложении технически невозможен. Причины:

1. **iOS Safari** не поддерживает **Web Bluetooth API** — фундаментальное ограничение **Apple**
2. **Bluetooth Classic (SPP)** — недоступен в браузерах вообще
3. **BLE GATT** — доступен только в нативных обёртках (Cordova/Capacitor) или в **Safari 15+** через **Web Bluetooth** для **M1 Mac (не iOS)**

Реалистичные альтернативы:

1. Сделать нативное приложение (React Native/Flutter) с Bluetooth модулем
2. Использовать **WebRTC dataChannel** — работает на iOS через Safari, но нужен signalling
3. Оставить как есть — онлайн (через сервер) + соло режим, что уже покрывает 95% случаев.