// Таблица лидеров (читает backend?action=stats)
(function () {
  function $(id) { return document.getElementById(id); }

  var lastActiveElement = null;
  var lastExpandedNick = null;

  function ensureOverlay() {
    var existing = $("leaderboardOverlay");
    if (existing) return existing;

    var overlay = document.createElement("div");
    overlay.className = "leaderboard-overlay";
    overlay.id = "leaderboardOverlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("inert", "");

    overlay.innerHTML =
      "<div class=\"leaderboard-card\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"leaderboardTitle\">" +
        "<button class=\"leaderboard-close\" type=\"button\" aria-label=\"Закрыть\">✕</button>" +
        "<div class=\"leaderboard-title\" id=\"leaderboardTitle\">🏆 ТАБЛИЦА ЛИДЕРОВ</div>" +
        "<div class=\"leaderboard-subtitle\" id=\"leaderboardSubtitle\">загрузка...</div>" +
        "<div class=\"leaderboard-table-wrap\">" +
          "<table class=\"leaderboard-table\">" +
            "<thead>" +
              "<tr>" +
                "<th>МЕСТО</th>" +
                "<th>НИК</th>" +
                "<th>ПОБЕД</th>" +
              "</tr>" +
            "</thead>" +
            "<tbody id=\"leaderboardBody\"></tbody>" +
          "</table>" +
        "</div>" +
        "<div class=\"leaderboard-actions\">" +
          "<button class=\"btn btn-ghost btn-sm\" type=\"button\" data-action=\"refresh\">🔄 Обновить</button>" +
        "</div>" +
      "</div>";

    document.body.appendChild(overlay);

    // Кнопки внутри оверлея
    overlay.querySelector(".leaderboard-close").addEventListener("click", function () {
      window.closeLeaderboard();
    });
    overlay.querySelector("[data-action=\"refresh\"]").addEventListener("click", function () {
      window.refreshLeaderboard();
    });

    // Раскрытие строки по клику на игрока
    overlay.addEventListener("click", function (e) {
      var tr = e.target && e.target.closest ? e.target.closest("tr[data-nick]") : null;
      if (!tr) return;
      var nick = tr.getAttribute("data-nick");
      if (!nick) return;
      toggleDetailsRow(nick);
    });

    return overlay;
  }

  function setOverlayVisible(visible) {
    var overlay = ensureOverlay();
    if (!overlay) return;
    var isVisible = !!visible;

    if (isVisible) {
      lastActiveElement = document.activeElement;
      overlay.classList.add("show");
      overlay.setAttribute("aria-hidden", "false");
      overlay.removeAttribute("inert");

      // Переносим фокус внутрь диалога (чтобы избежать aria-hidden warning)
      var closeBtn = overlay.querySelector(".leaderboard-close");
      if (closeBtn && typeof closeBtn.focus === "function") {
        setTimeout(function () { closeBtn.focus(); }, 0);
      }
    } else {
      // Сначала уводим фокус из оверлея, потом прячем
      var active = document.activeElement;
      if (active && overlay.contains(active)) {
        var fallback = $("btnLeaderboard") || lastActiveElement;
        if (fallback && typeof fallback.focus === "function") {
          fallback.focus();
        } else if (typeof document.body.focus === "function") {
          document.body.focus();
        }
      }

      overlay.classList.remove("show");
      overlay.setAttribute("aria-hidden", "true");
      overlay.setAttribute("inert", "");
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function fetchStats() {
    if (typeof API_URL !== "string" || !API_URL) {
      throw new Error("API_URL не задан");
    }
    var url = API_URL + (API_URL.indexOf("?") >= 0 ? "&" : "?") + "action=stats";
    var res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  }

  function normalizeNumber(v, fallback) {
    var n = Number(v);
    return Number.isFinite(n) ? n : (fallback || 0);
  }

  function computeWinRatePct(games, wins) {
    games = normalizeNumber(games, 0);
    wins = normalizeNumber(wins, 0);
    if (games <= 0) return 0;
    return Math.round((wins / games) * 100);
  }

  function clearExpanded() {
    var overlay = $("leaderboardOverlay");
    if (!overlay) return;
    var expanded = overlay.querySelector("tr.lb-details");
    if (expanded) expanded.remove();
    var active = overlay.querySelector("tr.is-expanded");
    if (active) active.classList.remove("is-expanded");
    lastExpandedNick = null;
  }

  function toggleDetailsRow(nick) {
    var overlay = $("leaderboardOverlay");
    if (!overlay) return;
    var body = $("leaderboardBody");
    if (!body) return;

    // Если кликнули повторно по тому же — свернуть
    if (lastExpandedNick === nick) {
      clearExpanded();
      return;
    }

    clearExpanded();

    var tr = body.querySelector("tr[data-nick=\"" + CSS.escape(nick) + "\"]");
    if (!tr) return;
    tr.classList.add("is-expanded");

    var dataJson = tr.getAttribute("data-row");
    var row = {};
    try { row = JSON.parse(dataJson || "{}"); } catch (e) { row = {}; }

    var games = normalizeNumber(row.games, 0);
    var wins = normalizeNumber(row.wins, 0);
    var losses = normalizeNumber(row.losses, 0);
    var avgShots = normalizeNumber(row.avgShots, 0);
    var winRate = computeWinRatePct(games, wins);

    var details = document.createElement("tr");
    details.className = "lb-details";
    details.innerHTML =
      "<td colspan=\"3\">" +
        "<div class=\"lb-details-grid\">" +
          "<div class=\"lb-metric\"><div class=\"lb-k\">Игры</div><div class=\"lb-v\">" + escapeHtml(games) + "</div></div>" +
          "<div class=\"lb-metric\"><div class=\"lb-k\">Победы</div><div class=\"lb-v\">" + escapeHtml(wins) + "</div></div>" +
          "<div class=\"lb-metric\"><div class=\"lb-k\">Поражения</div><div class=\"lb-v\">" + escapeHtml(losses) + "</div></div>" +
          "<div class=\"lb-metric\"><div class=\"lb-k\">Процент побед</div><div class=\"lb-v\">" + escapeHtml(winRate) + "%</div></div>" +
          "<div class=\"lb-metric\"><div class=\"lb-k\">Ср. выстрелов</div><div class=\"lb-v\">" + escapeHtml(avgShots) + "</div></div>" +
        "</div>" +
      "</td>";

    tr.insertAdjacentElement("afterend", details);
    lastExpandedNick = nick;
  }

  function renderStats(payload) {
    var body = $("leaderboardBody");
    var subtitle = $("leaderboardSubtitle");
    if (!body || !subtitle) return;

    var rows = (payload && payload.rows) ? payload.rows : [];
    var updatedAt = payload && payload.updatedAt ? payload.updatedAt : "";

    clearExpanded();
    subtitle.textContent = rows.length
      ? ("обновлено: " + (updatedAt ? new Date(updatedAt).toLocaleString("ru-RU") : "—") + " · игроков: " + rows.length)
      : "пока нет данных";

    body.innerHTML = rows.map(function (r, idx) {
      var cls = idx === 0 ? " is-top" : "";
      if (idx % 2 === 1) cls += " lb-alt";
      var nick = r && r.nick ? String(r.nick) : "";
      var wins = normalizeNumber(r && r.wins, 0);
      var place = (r && typeof r.place !== "undefined") ? r.place : (idx + 1);
      var safeRow = {
        place: place,
        nick: nick,
        games: normalizeNumber(r && r.games, 0),
        wins: wins,
        losses: normalizeNumber(r && r.losses, 0),
        avgShots: normalizeNumber(r && r.avgShots, 0)
      };
      return "<tr class=\"lb-row" + cls + "\" data-nick=\"" + escapeHtml(nick) + "\" data-row=\"" + escapeHtml(JSON.stringify(safeRow)) + "\" tabindex=\"0\">"
        + "<td>" + escapeHtml(place) + "</td>"
        + "<td class=\"lb-nick\" title=\"Нажмите, чтобы посмотреть детали\">" + escapeHtml(nick) + "</td>"
        + "<td class=\"lb-wins\">" + escapeHtml(wins) + "</td>"
        + "</tr>";
    }).join("");
  }

  async function loadAndRender() {
    var subtitle = $("leaderboardSubtitle");
    var body = $("leaderboardBody");
    if (subtitle) subtitle.textContent = "загрузка...";
    if (body) body.innerHTML = "";

    try {
      var payload = await fetchStats();
      if (!payload || payload.ok !== true) {
        throw new Error((payload && payload.error) ? payload.error : "Ошибка ответа stats");
      }
      renderStats(payload);
    } catch (err) {
      if (subtitle) subtitle.textContent = "ошибка загрузки: " + (err && err.message ? err.message : String(err));
    }
  }

  // Глобальные функции для onclick
  window.openLeaderboard = function () {
    ensureOverlay();
    setOverlayVisible(true);
    loadAndRender();
  };

  window.closeLeaderboard = function () {
    setOverlayVisible(false);
  };

  window.refreshLeaderboard = function () {
    loadAndRender();
  };

  // Закрытие по клику на фон
  document.addEventListener("click", function (e) {
    var overlay = $("leaderboardOverlay");
    if (!overlay || !overlay.classList.contains("show")) return;
    if (e.target === overlay) window.closeLeaderboard();
  });

  // Закрытие по Escape
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var overlay = $("leaderboardOverlay");
      if (overlay && overlay.classList.contains("show")) window.closeLeaderboard();
    }
  });

  // Горячие клавиши/доступность: Enter/Space по строке = раскрыть
  document.addEventListener("keydown", function (e) {
    var overlay = $("leaderboardOverlay");
    if (!overlay || !overlay.classList.contains("show")) return;
    var active = document.activeElement;
    if (!active || !active.matches || !active.matches("tr[data-nick]")) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      var nick = active.getAttribute("data-nick");
      if (nick) toggleDetailsRow(nick);
    }
  });
})();

