// engine/online/api_transport.js

// ── API ───────────────────────────────────────────────────────
function apiPost(data) {
  data = data || {};
  if (typeof ROOM_TIMEOUT_MS !== "undefined") {
    data.roomTimeoutMs = ROOM_TIMEOUT_MS;
  }
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
  if (typeof ROOM_TIMEOUT_MS !== "undefined") {
    url += "&roomTimeoutMs=" + encodeURIComponent(ROOM_TIMEOUT_MS);
  }
  return fetch(url, { redirect: "follow" }).then(function(r){ return r.json(); });
}

function apiGetRooms() {
  var url = API_URL + "?action=getRooms";
  if (typeof ROOM_TIMEOUT_MS !== "undefined") {
    url += "&roomTimeoutMs=" + encodeURIComponent(ROOM_TIMEOUT_MS);
  }
  return fetch(url, { redirect: "follow" }).then(function(r){ return r.json(); });
}
