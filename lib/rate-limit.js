/** First forwarded client address, or 'unknown'. */
export function clientIp(req) {
  return String(req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim() || 'unknown';
}

/**
 * Sliding-window attempt counter (per server instance). Keys look like `<kind>:<value>`, and
 * limits maps each kind to the attempts allowed within windowMs.
 * Over trackedMax keys, the oldest keys still under their limit go first; blocked keys are only
 * dropped (oldest first) past blockedMax, so a flood of fresh keys cannot lift a live block.
 */
export function createLimiter({ windowMs, limits, trackedMax = 5000, blockedMax = 20000 }) {
  const hits = new Map();
  const limitOf = (key) => limits[key.slice(0, key.indexOf(':'))] ?? Infinity;

  function recent(key, now) {
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length) hits.set(key, list);
    else hits.delete(key);
    return list;
  }

  function evict(now) {
    [...hits.keys()].forEach((key) => recent(key, now));
    if (hits.size <= trackedMax) return;
    const last = (list) => list[list.length - 1];
    const byAge = [...hits].sort((a, b) => last(a[1]) - last(b[1]));
    const target = Math.floor(trackedMax * 0.8);
    for (const [key, list] of byAge) {
      if (hits.size <= target) break;
      if (list.length < limitOf(key)) hits.delete(key);
    }
    for (const [key] of byAge) {
      if (hits.size <= blockedMax) break;
      hits.delete(key);
    }
  }

  return {
    blocked(keys, now = Date.now()) {
      return keys.some((key) => recent(key, now).length >= limitOf(key));
    },
    note(keys, now = Date.now()) {
      if (hits.size > trackedMax) evict(now);
      keys.forEach((key) => hits.set(key, [...recent(key, now), now].slice(-limitOf(key))));
    },
    clear(keys) {
      keys.forEach((key) => hits.delete(key));
    }
  };
}
