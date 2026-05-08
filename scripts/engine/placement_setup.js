(function () {
  var FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

  var placementState = {
    mode: "random",
    ships: [],
    drag: null
  };

  var root = null;
  var resolver = null;
  var context = null;
  /** Ожидание движения перед стартом drag с корабля на поле (чтобы работал двойной клик). */
  var pendingBoardDrag = null;

  function buildEmptyBoard() {
    var board = [];
    for (var y = 0; y < 10; y++) {
      var row = [];
      for (var x = 0; x < 10; x++) row.push(0);
      board.push(row);
    }
    return board;
  }

  function cloneShips(ships) {
    return ships.map(function (s) {
      return {
        id: s.id,
        len: s.len,
        x: s.x,
        y: s.y,
        horiz: !!s.horiz
      };
    });
  }

  function boardFromShips(ships) {
    var board = buildEmptyBoard();
    ships.forEach(function (s) {
      if (s.x == null || s.y == null) return;
      for (var i = 0; i < s.len; i++) {
        var x = s.x + (s.horiz ? i : 0);
        var y = s.y + (s.horiz ? 0 : i);
        if (x >= 0 && x <= 9 && y >= 0 && y <= 9) board[y][x] = 1;
      }
    });
    return board;
  }

  function canPlaceShip(ships, shipId, x, y, horiz) {
    var ship = ships.filter(function (s) { return s.id === shipId; })[0];
    if (!ship) return false;

    for (var i = 0; i < ship.len; i++) {
      var cx = x + (horiz ? i : 0);
      var cy = y + (horiz ? 0 : i);
      if (cx < 0 || cx > 9 || cy < 0 || cy > 9) return false;

      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var nx = cx + dx;
          var ny = cy + dy;
          if (nx < 0 || nx > 9 || ny < 0 || ny > 9) continue;
          for (var j = 0; j < ships.length; j++) {
            var other = ships[j];
            if (other.id === shipId) continue;
            if (other.x == null || other.y == null) continue;
            for (var k = 0; k < other.len; k++) {
              var ox = other.x + (other.horiz ? k : 0);
              var oy = other.y + (other.horiz ? 0 : k);
              if (ox === nx && oy === ny) return false;
            }
          }
        }
      }
    }
    return true;
  }

  /** Позиция якоря (левый/верхний край корабля) с учётом границ поля. */
  function clampShipAnchor(ship, horiz, hx, hy) {
    var x = hx;
    var y = hy;
    if (horiz) {
      x = Math.max(0, Math.min(hx, 10 - ship.len));
      y = Math.max(0, Math.min(hy, 9));
    } else {
      x = Math.max(0, Math.min(hx, 9));
      y = Math.max(0, Math.min(hy, 10 - ship.len));
    }
    return { x: x, y: y };
  }

  function isFleetPlacementValid(ships) {
    if (!ships.every(function (s) { return s.x != null && s.y != null; })) return false;
    for (var i = 0; i < ships.length; i++) {
      var s = ships[i];
      if (!canPlaceShip(ships, s.id, s.x, s.y, s.horiz)) return false;
    }
    return true;
  }

  function generateRandomShips() {
    var ships = FLEET.map(function (len, idx) {
      return { id: "ship_" + idx, len: len, x: null, y: null, horiz: true };
    });

    for (var i = 0; i < ships.length; i++) {
      var placed = false;
      var attempts = 0;
      while (!placed && attempts < 1000) {
        attempts++;
        var horiz = Math.random() < 0.5;
        var x = Math.floor(Math.random() * 10);
        var y = Math.floor(Math.random() * 10);
        if (canPlaceShip(ships, ships[i].id, x, y, horiz)) {
          ships[i].x = x;
          ships[i].y = y;
          ships[i].horiz = horiz;
          placed = true;
        }
      }
      if (!placed) return generateRandomShips();
    }
    return ships;
  }

  function areAllShipsPlaced() {
    return placementState.ships.every(function (s) { return s.x != null && s.y != null; });
  }

  function getShipById(shipId) {
    return placementState.ships.filter(function (s) { return s.id === shipId; })[0] || null;
  }

  function clearConflictHighlights() {
    if (!root) return;
    root.querySelectorAll(".placement-cell.placement-conflict").forEach(function (c) {
      c.classList.remove("placement-conflict");
    });
    root.querySelectorAll(".placement-ship.placement-ship-invalid").forEach(function (el) {
      el.classList.remove("placement-ship-invalid");
    });
  }

  function highlightInvalidFleet() {
    clearConflictHighlights();
    if (placementState.mode !== "manual") return;
    placementState.ships.forEach(function (ship) {
      if (ship.x == null || ship.y == null) return;
      var ok = canPlaceShip(placementState.ships, ship.id, ship.x, ship.y, ship.horiz);
      if (ok) return;
      var el = root.querySelector('.placement-ship[data-ship-id="' + ship.id + '"]');
      if (el) el.classList.add("placement-ship-invalid");
      for (var i = 0; i < ship.len; i++) {
        var cx = ship.x + (ship.horiz ? i : 0);
        var cy = ship.y + (ship.horiz ? 0 : i);
        var cell = root.querySelector('.placement-cell[data-x="' + cx + '"][data-y="' + cy + '"]');
        if (cell) cell.classList.add("placement-conflict");
      }
    });
  }

  function render() {
    if (!root) return;
    renderGrid();
    renderFleet();
    highlightInvalidFleet();
    updateReadyState();
  }

  function renderGrid() {
    var grid = root.querySelector("#placementGrid");
    if (!grid) return;
    grid.innerHTML = "";

    for (var y = 0; y < 10; y++) {
      for (var x = 0; x < 10; x++) {
        var cell = document.createElement("div");
        cell.className = "placement-cell";
        cell.dataset.x = String(x);
        cell.dataset.y = String(y);
        grid.appendChild(cell);
      }
    }

    placementState.ships.forEach(function (ship) {
      if (ship.x == null || ship.y == null) return;
      var el = document.createElement("div");
      el.className = "placement-ship";
      el.dataset.shipId = ship.id;
      el.dataset.len = String(ship.len);
      el.style.setProperty("--len", String(ship.len));
      el.style.left = "calc(" + ship.x + " * (var(--cell-size) + var(--gap)))";
      el.style.top = "calc(" + ship.y + " * (var(--cell-size) + var(--gap)))";
      if (ship.horiz) el.classList.add("horiz");
      else el.classList.add("vert");
      grid.appendChild(el);
    });
  }

  function renderFleet() {
    var fleet = root.querySelector("#placementFleet");
    if (!fleet) return;
    fleet.innerHTML = "";

    placementState.ships.forEach(function (ship) {
      if (ship.x != null && ship.y != null) return;
      var item = document.createElement("button");
      item.type = "button";
      item.className = "placement-fleet-item";
      item.dataset.shipId = ship.id;
      item.innerHTML = '<span style="--len:' + ship.len + '" class="placement-fleet-shape"></span>';
      fleet.appendChild(item);
    });
  }

  function updateReadyState() {
    var btn = root.querySelector("#placementReadyBtn");
    if (!btn) return;
    var allPlaced = areAllShipsPlaced();
    var valid = placementState.mode === "random" ? allPlaced : allPlaced && isFleetPlacementValid(placementState.ships);
    btn.disabled = !valid;
    if (!allPlaced) btn.textContent = "РАССТАВЬТЕ ВСЕ КОРАБЛИ";
    else if (placementState.mode === "manual" && !isFleetPlacementValid(placementState.ships))
      btn.textContent = "ИСПРАВЬТЕ СТОЛКНОВЕНИЯ";
    else btn.textContent = "ГОТОВО";
  }

  function beginBoardDrag(shipId, pointerEvent) {
    if (placementState.mode !== "manual") return;
    var ship = getShipById(shipId);
    if (!ship || ship.x == null || ship.y == null) return;

    var origin = { x: ship.x, y: ship.y, horiz: ship.horiz };
    ship.x = null;
    ship.y = null;

    placementState.drag = {
      shipId: shipId,
      pointerId: pointerEvent.pointerId,
      horiz: origin.horiz,
      hover: null,
      origin: origin
    };

    render();
    updateHover(pointerEvent);
  }

  function startDragFromFleet(shipId, pointerEvent) {
    if (placementState.mode !== "manual") return;
    var ship = getShipById(shipId);
    if (!ship) return;

    placementState.drag = {
      shipId: shipId,
      pointerId: pointerEvent.pointerId,
      horiz: true,
      hover: null,
      origin: { x: null, y: null, horiz: true }
    };

    render();
    updateHover(pointerEvent);
  }

  function endDrag(applyPlacement) {
    var drag = placementState.drag;
    if (!drag) return;
    var ship = getShipById(drag.shipId);
    if (!ship) {
      placementState.drag = null;
      return;
    }

    if (applyPlacement && drag.hover) {
      var clamped = clampShipAnchor(ship, drag.horiz, drag.hover.x, drag.hover.y);
      ship.x = clamped.x;
      ship.y = clamped.y;
      ship.horiz = drag.horiz;
    } else {
      ship.x = drag.origin.x;
      ship.y = drag.origin.y;
      ship.horiz = drag.origin.horiz;
    }

    placementState.drag = null;
    render();
  }

  function updateHover(pointerEvent) {
    var drag = placementState.drag;
    if (!drag) return;
    var grid = root.querySelector("#placementGrid");
    var rect = grid.getBoundingClientRect();
    var cellSize = parseFloat(getComputedStyle(grid).getPropertyValue("--cell-size")) || 32;
    var gap = parseFloat(getComputedStyle(grid).getPropertyValue("--gap")) || 2;
    var step = cellSize + gap;
    var rx = pointerEvent.clientX - rect.left;
    var ry = pointerEvent.clientY - rect.top;
    var x = Math.floor(rx / step);
    var y = Math.floor(ry / step);
    if (x < 0 || y < 0 || x > 9 || y > 9) {
      drag.hover = null;
    } else {
      drag.hover = { x: x, y: y };
    }
    drawDragPreview();
  }

  function drawDragPreview() {
    root.querySelectorAll(".placement-cell.preview-ok, .placement-cell.preview-bad").forEach(function (c) {
      c.classList.remove("preview-ok");
      c.classList.remove("preview-bad");
    });

    var drag = placementState.drag;
    if (!drag || !drag.hover) return;
    var ship = getShipById(drag.shipId);
    if (!ship) return;
    var clamped = clampShipAnchor(ship, drag.horiz, drag.hover.x, drag.hover.y);
    var ok = canPlaceShip(placementState.ships, ship.id, clamped.x, clamped.y, drag.horiz);
    for (var i = 0; i < ship.len; i++) {
      var x = clamped.x + (drag.horiz ? i : 0);
      var y = clamped.y + (drag.horiz ? 0 : i);
      var cell = root.querySelector('.placement-cell[data-x="' + x + '"][data-y="' + y + '"]');
      if (cell) cell.classList.add(ok ? "preview-ok" : "preview-bad");
    }
  }

  function rotatePlacedShip(shipId) {
    if (placementState.mode !== "manual") return;
    var ship = getShipById(shipId);
    if (!ship || ship.x == null || ship.y == null) return;
    var next = !ship.horiz;
    ship.horiz = next;
    var c = clampShipAnchor(ship, next, ship.x, ship.y);
    ship.x = c.x;
    ship.y = c.y;
    render();
  }

  function setMode(mode) {
    placementState.mode = mode;
    if (mode === "random") {
      placementState.ships = generateRandomShips();
    } else if (!areAllShipsPlaced()) {
      placementState.ships = placementState.ships.map(function (s) {
        return { id: s.id, len: s.len, x: null, y: null, horiz: true };
      });
    }
    render();
  }

  function close(result) {
    if (!root) return;
    root.classList.remove("show");
    document.body.classList.remove("placement-open");
    var r = resolver;
    resolver = null;
    context = null;
    if (r) r(result || null);
  }

  function ensureRoot() {
    if (root) return;
    root = document.createElement("div");
    root.id = "placementOverlay";
    root.className = "placement-overlay";
    root.innerHTML = [
      '<div class="placement-card">',
      '  <div class="placement-title" id="placementTitle">РАССТАНОВКА КОРАБЛЕЙ</div>',
      '  <div class="placement-subtitle" id="placementSubtitle">Расставьте корабли перед началом</div>',
      '  <div class="placement-controls">',
      '    <button type="button" class="btn btn-ghost btn-sm" id="placementRandomizeBtn">🎲 РАНДОМ</button>',
      '  </div>',
      '  <div class="placement-grid-wrap">',
      '    <div class="placement-grid" id="placementGrid"></div>',
      '  </div>',
      '  <div class="placement-help">Перетаскивайте корабли. Двойной клик / двойное касание — поворот.</div>',
      '  <div class="placement-fleet" id="placementFleet"></div>',
      '  <div class="placement-actions">',
      '    <button type="button" class="btn btn-ghost" id="placementCancelBtn">ОТМЕНА</button>',
      '    <button type="button" class="btn btn-primary" id="placementReadyBtn">ГОТОВО</button>',
      '  </div>',
      "</div>"
    ].join("");
    document.body.appendChild(root);

    root.addEventListener("click", function (e) {
      if (e.target === root) close(null);
    });

    root.querySelector("#placementCancelBtn").addEventListener("click", function () {
      close(null);
    });

    root.querySelector("#placementReadyBtn").addEventListener("click", function () {
      if (!areAllShipsPlaced()) return;
      if (placementState.mode === "manual" && !isFleetPlacementValid(placementState.ships)) return;
      close(boardFromShips(placementState.ships));
    });

    root.querySelector("#placementRandomizeBtn").addEventListener("click", function () {
      placementState.ships = generateRandomShips();
      render();
    });

    root.addEventListener("pointermove", function (e) {
      if (pendingBoardDrag && !placementState.drag) {
        var dx = e.clientX - pendingBoardDrag.clientX;
        var dy = e.clientY - pendingBoardDrag.clientY;
        if (dx * dx + dy * dy > 36) {
          beginBoardDrag(pendingBoardDrag.shipId, e);
          pendingBoardDrag = null;
        }
      }
      if (placementState.drag) updateHover(e);
    });

    root.addEventListener("pointerup", function () {
      if (pendingBoardDrag && !placementState.drag) pendingBoardDrag = null;
      if (placementState.drag) endDrag(true);
    });

    root.addEventListener("pointercancel", function () {
      pendingBoardDrag = null;
      if (placementState.drag) endDrag(false);
    });

    root.addEventListener("pointerdown", function (e) {
      if (placementState.mode !== "manual") return;
      var fleetItem = e.target.closest(".placement-fleet-item");
      if (fleetItem) {
        var fs = getShipById(fleetItem.dataset.shipId);
        if (!fs) return;
        pendingBoardDrag = null;
        startDragFromFleet(fs.id, e);
        return;
      }
      var shipEl = e.target.closest(".placement-ship");
      if (shipEl) {
        pendingBoardDrag = {
          shipId: shipEl.dataset.shipId,
          clientX: e.clientX,
          clientY: e.clientY
        };
      } else if (!e.target.closest(".placement-fleet-item")) {
        pendingBoardDrag = null;
      }
    });

    root.addEventListener("dblclick", function (e) {
      var shipEl = e.target.closest(".placement-ship");
      if (!shipEl) return;
      e.preventDefault();
      pendingBoardDrag = null;
      rotatePlacedShip(shipEl.dataset.shipId);
    });

    /* ---- Touch support for mobile ---- */
    var lastTap = { shipId: null, time: 0 };

    function touchToPointerLike(touch) {
      return { clientX: touch.clientX, clientY: touch.clientY, pointerId: touch.identifier };
    }

    root.addEventListener("touchstart", function (e) {
      if (placementState.mode !== "manual") return;
      var touch = e.touches[0];
      var fleetItem = e.target.closest(".placement-fleet-item");
      if (fleetItem) {
        e.preventDefault();
        var fs = getShipById(fleetItem.dataset.shipId);
        if (!fs) return;
        pendingBoardDrag = null;
        startDragFromFleet(fs.id, touchToPointerLike(touch));
        return;
      }
      var shipEl = e.target.closest(".placement-ship");
      if (shipEl) {
        e.preventDefault();
        var now = Date.now();
        var sid = shipEl.dataset.shipId;
        if (lastTap.shipId === sid && now - lastTap.time < 400) {
          lastTap = { shipId: null, time: 0 };
          pendingBoardDrag = null;
          rotatePlacedShip(sid);
        } else {
          lastTap = { shipId: sid, time: now };
          pendingBoardDrag = {
            shipId: sid,
            clientX: touch.clientX,
            clientY: touch.clientY
          };
        }
      }
    }, { passive: false });

    root.addEventListener("touchmove", function (e) {
      if (!placementState.drag && !pendingBoardDrag) return;
      e.preventDefault();
      var touch = e.touches[0];
      var pe = touchToPointerLike(touch);
      if (pendingBoardDrag && !placementState.drag) {
        var dx = touch.clientX - pendingBoardDrag.clientX;
        var dy = touch.clientY - pendingBoardDrag.clientY;
        if (dx * dx + dy * dy > 36) {
          beginBoardDrag(pendingBoardDrag.shipId, pe);
          pendingBoardDrag = null;
        }
      }
      if (placementState.drag) updateHover(pe);
    }, { passive: false });

    root.addEventListener("touchend", function (e) {
      if (pendingBoardDrag && !placementState.drag) {
        pendingBoardDrag = null;
        return;
      }
      if (placementState.drag) {
        e.preventDefault();
        endDrag(true);
      }
    }, { passive: false });

    root.addEventListener("touchcancel", function () {
      pendingBoardDrag = null;
      if (placementState.drag) endDrag(false);
    });
  }

  function openPlacementSetup(opts) {
    ensureRoot();
    opts = opts || {};
    context = opts.context || "solo";
    resolver = null;

    placementState.mode = "manual";
    placementState.drag = null;
    pendingBoardDrag = null;
    placementState.ships = FLEET.map(function (len, idx) {
      return { id: "ship_" + idx, len: len, x: null, y: null, horiz: true };
    });

    var title = root.querySelector("#placementTitle");
    var subtitle = root.querySelector("#placementSubtitle");
    if (context === "solo") {
      title.textContent = "СОЛО: РАССТАНОВКА КОРАБЛЕЙ";
      subtitle.textContent = "Расставьте корабли перед игрой с ИИ";
    } else {
      title.textContent = "ОНЛАЙН: РАССТАНОВКА КОРАБЛЕЙ";
      subtitle.textContent = "Расставьте корабли перед входом в бой";
    }

    render();
    root.classList.add("show");
    document.body.classList.add("placement-open");

    return new Promise(function (resolve) {
      resolver = resolve;
    });
  }

  window.openPlacementSetup = openPlacementSetup;
})();