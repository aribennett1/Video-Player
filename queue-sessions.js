// Each session has its own storage key: saving one tab never replaces another.
class QueueSessions {
  constructor({ storage, tabStorage, locks, prefix, uuid = () => crypto.randomUUID(), now = () => Date.now() }) {
    Object.assign(this, { storage, tabStorage, locks, prefix, uuid, now });
    this.volatile = new Map();
    this.release = null;
    this.activeId = null;
    this.storageError = false;
  }
  key(id) { return `${this.prefix}:session:${id}`; }
  read(id) {
    try { return JSON.parse(this.storage.getItem(this.key(id))) || this.volatile.get(id) || null; }
    catch (_) { return this.volatile.get(id) || null; }
  }
  list() {
    const records = new Map(this.volatile);
    try {
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (!key?.startsWith(`${this.prefix}:session:`)) continue;
        const record = JSON.parse(this.storage.getItem(key));
        if (record && typeof record.id === 'string' && Array.isArray(record.items)) records.set(record.id, record);
      }
    } catch (_) { this.storageError = true; }
    return Array.from(records.values()).filter(record => record.items.length).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  save(record) {
    const metadata = { ...record, items: record.items.map(({ handle, file, url, ...item }) => item) };
    try { this.storage.setItem(this.key(record.id), JSON.stringify(metadata)); this.volatile.delete(record.id); }
    catch (_) { this.storageError = true; this.volatile.set(record.id, metadata); }
    return metadata;
  }
  migrate(legacy) {
    try { if (this.storage.getItem(`${this.prefix}:sessions-migrated`)) return null; } catch (_) {}
    const id = 'legacy';
    let migrated = null;
    if (legacy?.items?.length && !this.read(id)) {
      migrated = { ...legacy, id, updatedAt: this.now(), name: '', speed: legacy.speed || 1 };
      this.save(migrated);
    }
    try { this.storage.setItem(`${this.prefix}:sessions-migrated`, '1'); } catch (_) {}
    return migrated;
  }
  async acquire(id) {
    if (!this.locks) return false; // Copy instead of risking a shared writer.
    return new Promise(resolve => {
      this.locks.request(this.key(id), { ifAvailable: true }, lock => {
        if (!lock) { resolve(false); return; }
        return new Promise(release => { this.release = release; resolve(true); });
      }).catch(() => resolve(false));
    });
  }
  async activate(record = null) {
    this.release?.();
    this.release = null;
    this.activeId = null;
    let copied = false;
    let id = record?.id || this.uuid();
    if (!await this.acquire(id)) {
      copied = !!record;
      id = this.uuid();
      await this.acquire(id);
    }
    this.activeId = id;
    try { this.tabStorage.setItem(`${this.prefix}:active-session`, id); } catch (_) {}
    return { ...(record || {}), id, copied };
  }
  tabSession() {
    try { const id = this.tabStorage.getItem(`${this.prefix}:active-session`); return id ? this.read(id) : null; }
    catch (_) { return null; }
  }
  async remove(id) {
    if (id === this.activeId) return false;
    if (!this.locks) return false; // An open tab could recreate a deleted record.
    return this.locks.request(this.key(id), { ifAvailable: true }, lock => {
      if (!lock) return false;
      this.storage.removeItem(this.key(id)); this.volatile.delete(id);
      return true;
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = QueueSessions;
