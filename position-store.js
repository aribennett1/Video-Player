// Pure storage migration rules, shared by the player and Node tests.
const PlaybackPositionStore = (() => {
  function prune(store, now, ttl) {
    const cutoff = now - ttl;
    const pruned = Object.create(null);
    for (const [filename, value] of Object.entries(store)) {
      const entry = typeof value === "number" ? { time: value } : value;
      if (!entry || typeof entry !== "object" || !Number.isFinite(entry.time) || entry.time < 0) continue;
      // Historical entries have no reliable age. Give them one grace period,
      // persisting this timestamp on first read so later reads cannot renew it.
      const updatedAt = entry.updatedAt == null ? now : entry.updatedAt;
      if (!Number.isFinite(updatedAt) || updatedAt < cutoff) continue;
      pruned[filename] = { ...entry, updatedAt };
    }
    return pruned;
  }
  return { prune };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PlaybackPositionStore;
