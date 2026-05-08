// Управление декодированными AudioBuffer из audioEngine (PCM float32) — см. audio_v2.js.
// Если переданы лимиты, оставляет часть буферов (самые "лёгкие"), укладываясь в ограничения.
// Без лимитов очищает всё.

function _getAudioV2BufferBytes(buf) {
  if (!buf || !buf.length) return 0;
  return (buf.length || 0) * (buf.numberOfChannels || 1) * 4;
}

function clearAudioV2PcmBuffers(opts) {
  var out = {
    beforeDecoded: 0,
    afterDecoded: 0,
    beforeBytes: 0,
    afterBytes: 0,
    freedDecoded: 0,
    freedBytes: 0,
    stoppedSources: 0
  };

  var ae = (typeof audioEngine !== "undefined" && audioEngine) ? audioEngine : null;
  if (!ae || !ae.buffers) return out;

  var entries = [];
  try {
    Object.keys(ae.buffers || {}).forEach(function (src) {
      var buf = ae.buffers[src];
      var bytes = _getAudioV2BufferBytes(buf);
      entries.push({ src: src, bytes: bytes });
      out.beforeBytes += bytes;
    });
    out.beforeDecoded = entries.length;
  } catch (e) {}

  var hasLimits = !!(opts && (opts.maxDecoded != null || opts.maxPcmBytes != null));
  var maxDecoded = hasLimits ? Number(opts.maxDecoded) : NaN;
  var maxPcmBytes = hasLimits ? Number(opts.maxPcmBytes) : NaN;
  if (!isFinite(maxDecoded) || maxDecoded < 0) maxDecoded = Infinity;
  if (!isFinite(maxPcmBytes) || maxPcmBytes < 0) maxPcmBytes = Infinity;

  if (!hasLimits || (maxDecoded === Infinity && maxPcmBytes === Infinity)) {
    try {
      if (ae.activeSources && ae.activeSources.forEach) {
        ae.activeSources.forEach(function (srcNode) {
          try { srcNode.stop(0); } catch (e2) {}
          try { srcNode.disconnect(); } catch (e3) {}
          out.stoppedSources++;
        });
        ae.activeSources.clear();
      }
    } catch (e4) {}
    ae.buffers = {};
    out.afterDecoded = 0;
    out.afterBytes = 0;
  } else {
    // Сохраняем меньшие буферы первыми, чтобы вместить максимум полезных звуков в лимит.
    entries.sort(function (a, b) { return a.bytes - b.bytes; });
    var keep = {};
    var keptCount = 0;
    var keptBytes = 0;
    for (var i = 0; i < entries.length; i++) {
      var it = entries[i];
      if (keptCount + 1 > maxDecoded) continue;
      if (keptBytes + it.bytes > maxPcmBytes) continue;
      keep[it.src] = true;
      keptCount++;
      keptBytes += it.bytes;
    }

    var nextBuffers = {};
    Object.keys(ae.buffers || {}).forEach(function (src2) {
      if (keep[src2]) nextBuffers[src2] = ae.buffers[src2];
    });
    ae.buffers = nextBuffers;
    out.afterDecoded = keptCount;
    out.afterBytes = keptBytes;
  }

  try {
    ae.inflight = {};
  } catch (e5) {}

  try {
    if (typeof audioState !== "undefined" && audioState) {
      audioState.queue = [];
      audioState.queuePlaying = false;
    }
  } catch (e6) {}

  out.freedDecoded = Math.max(0, out.beforeDecoded - out.afterDecoded);
  out.freedBytes = Math.max(0, out.beforeBytes - out.afterBytes);
  return out;
}
