// engine/online/api_transport.js

// ── API ───────────────────────────────────────────────────────
function apiPost(data) {
  return fetch(API_URL, {
    method:  "POST",
    body:    JSON.stringify(data),
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    redirect: "follow"
  }).then(function(r){ return r.json(); });
}

function apiGet(params) {
  var url = API_URL + "?action=state";
  if (params.playerId) url += "&playerId=" + encodeURIComponent(params.playerId);
  if (params.roomId)   url += "&roomId="   + encodeURIComponent(params.roomId);
  return fetch(url, { redirect: "follow" }).then(function(r){ return r.json(); });
}

function apiGetRooms() {
  return fetch(API_URL + "?action=getRooms", { redirect: "follow" }).then(function(r){ return r.json(); });
}
