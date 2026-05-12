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
