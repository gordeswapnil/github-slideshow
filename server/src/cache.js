// Minimal in-memory TTL cache. Sufficient for a single-process education app;
// swap for Redis/etc. if this ever needs to scale horizontally.
function createCache(ttlMs) {
  const store = new Map();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expires) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      store.set(key, { value, expires: Date.now() + ttlMs });
    },
    has(key) {
      return this.get(key) !== undefined;
    },
    clear() {
      store.clear();
    },
    get size() {
      return store.size;
    },
  };
}

module.exports = { createCache };
