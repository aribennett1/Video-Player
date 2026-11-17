const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const QueueSessions = require('../queue-sessions.js');
const { tab } = require('./helpers/player.cjs');
function memoryStorage(initial = []) {
  const map = new Map(initial);
  return { get length() { return map.size; }, key: i => Array.from(map.keys())[i] || null,
    getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
}
function locks() {
  const held = new Set();
  return { async request(key, options, callback) {
    if (held.has(key)) return callback(null);
    held.add(key);
    try { return await callback({ name: key }); } finally { held.delete(key); }
  } };
}
const item = name => ({ id: name, name, size: 100, lastModified: 2, position: { time: 120, updatedAt: Date.now() } });
function environment() {
  const storage = memoryStorage(), manager = locks(); let n = 0;
  const make = (tabStorage = memoryStorage()) => new QueueSessions({ storage, tabStorage, locks: manager, prefix: 'queue', uuid: () => `id-${++n}` });
  return { storage, manager, make };
}
test('fresh tabs save separate queues without overwriting either batch', async () => {
  const { make } = environment(); const a = make(), b = make();
  const first = await a.activate(); a.save({ ...first, items: [item('a')], speed: 2, updatedAt: 1 });
  assert.equal(b.tabSession(), null);
  const second = await b.activate(); b.save({ ...second, items: [item('b')], speed: 3, updatedAt: 2 });
  assert.notEqual(first.id, second.id); assert.equal(a.list().length, 2);
  assert.equal(a.read(first.id).items[0].name, 'a'); assert.equal(a.read(second.id).speed, 3);
  a.release(); b.release();
});
test('reload reclaims the same queue with selection, speed and position; duplicate tab gets a copy', async () => {
  const { make } = environment(), tabStorage = memoryStorage();
  const original = make(tabStorage); const record = await original.activate();
  original.save({ ...record, items: [item('a')], speed: 2.7, resumeItemId: 'a', updatedAt: 1 });
  const duplicate = make(memoryStorage([['queue:active-session', record.id]]));
  const copy = await duplicate.activate(duplicate.tabSession());
  assert(copy.copied); assert.notEqual(copy.id, record.id); assert.equal(copy.items[0].position.time, 120);
  original.release(); await Promise.resolve();
  const reload = make(tabStorage); const restored = await reload.activate(reload.tabSession());
  assert.equal(restored.id, record.id); assert.equal(restored.copied, false);
  assert.equal(restored.speed, 2.7); assert.equal(restored.resumeItemId, 'a');
  reload.release(); duplicate.release();
});
test('a dormant queue continues in place and an open queue cannot be deleted', async () => {
  const { make } = environment(); const first = make(), other = make();
  const record = await first.activate(); first.save({ ...record, items: [item('a')], updatedAt: 1 });
  assert.equal(await other.remove(record.id), false);
  first.release(); await Promise.resolve();
  const resumed = await other.activate(other.read(record.id)); assert.equal(resumed.id, record.id);
  other.release(); await Promise.resolve();
  assert.equal(await first.remove(record.id), false); // Never delete the caller's current queue.
  const cleaner = make(); assert.equal(await cleaner.remove(record.id), true); assert.equal(cleaner.list().length, 0);
});
test('migration happens once and deleting the imported queue does not resurrect it', async () => {
  const { make } = environment(); const store = make();
  const migrated = store.migrate({ items: [item('legacy.mp3')], resumeItemId: 'legacy.mp3' });
  assert.equal(migrated.id, 'legacy'); assert.equal(store.list().length, 1);
  assert.equal(await store.remove('legacy'), true);
  assert.equal(store.migrate({ items: [item('legacy.mp3')] }), null); assert.equal(store.list().length, 0);
});
test('metadata excludes media contents and handles; unavailable locks copy saved queues safely', async () => {
  const storage = memoryStorage(); let n = 0;
  const store = new QueueSessions({ storage, tabStorage: memoryStorage(), prefix: 'queue', uuid: () => `id-${++n}` });
  const record = await store.activate({ id: 'old', items: [{ ...item('a'), file: {}, handle: {}, url: 'blob:a' }], speed: 1.5 });
  assert(record.copied); store.save(record);
  const saved = store.read(record.id); assert(!('file' in saved.items[0])); assert(!('handle' in saved.items[0])); assert(!('url' in saved.items[0]));
});
test('blocked storage keeps a session usable in memory and reports persistence failure', async () => {
  const blocked = { get length() { throw Error(); }, getItem() { throw Error(); }, setItem() { throw Error(); } };
  const store = new QueueSessions({ storage: blocked, tabStorage: blocked, prefix: 'q', uuid: () => 'new' });
  const record = await store.activate(); store.save({ ...record, items: [item('a')] });
  assert.equal(store.read('new').items.length, 1); assert.equal(store.list().length, 1); assert(store.storageError);
});
test('application starts fresh tabs empty, preserves the previous queue, and reloads per-tab state', async () => {
  const storage = memoryStorage(), manager = locks(), aStorage = memoryStorage(), bStorage = memoryStorage();
  const a = tab(storage, { tabStorage: aStorage, locks: manager }); await a.ready;
  a.box.entries = [item('first.mp3')];
  vm.runInContext('mediaQueue = entries; currentPlaybackSpeed = 2.7; resumeItemId = entries[0].id; saveQueue()', a.box);
  const aId = vm.runInContext('activeSession.id', a.box);
  const b = tab(storage, { tabStorage: bStorage, locks: manager }); await b.ready;
  assert.equal(vm.runInContext('mediaQueue.length', b.box), 0);
  assert.equal(b.element('savedQueuesList').children.length, 1);
  b.box.entries = [item('second.mp3')]; vm.runInContext('mediaQueue = entries; currentPlaybackSpeed = 1.5; saveQueue()', b.box);
  vm.runInContext('sessionStore.release()', a.box); await Promise.resolve();
  const reload = tab(storage, { tabStorage: aStorage, locks: manager }); await reload.ready;
  assert.equal(vm.runInContext('activeSession.id', reload.box), aId);
  assert.equal(vm.runInContext('mediaQueue[0].name', reload.box), 'first.mp3');
  assert.equal(reload.element('speedControl').value, '2.7');
  assert.equal(vm.runInContext('getSavedPosition("first.mp3")', reload.box), 0); // No selected media yet.
  vm.runInContext('currentQueueIndex = 0', reload.box);
  assert.equal(vm.runInContext('getSavedPosition("first.mp3")', reload.box), 120);
  assert.equal(vm.runInContext('sessionStore.list().length', reload.box), 2);
  vm.runInContext('sessionStore.release()', b.box); vm.runInContext('sessionStore.release()', reload.box);
});
function database(initial = []) {
  const records = new Map(initial);
  return { records, open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction: () => ({ objectStore: () => ({
        getAll() { const result = {}; queueMicrotask(() => { result.result = [...records.values()]; result.onsuccess(); }); return result; },
        put: (record, key) => records.set(key, record), delete: key => records.delete(key),
      }) }) };
      request.onsuccess();
    });
    return request;
  } };
}
test('legacy handles migrate; restoring an active session copies handles, position and speed', async () => {
  const storage = memoryStorage(), manager = locks();
  const permissionCalls = [];
  const handle = { requestPermission() { permissionCalls.push('request'); return Promise.resolve('granted'); },
    async getFile() { return { name: 'lecture.mp3', size: 100, lastModified: 2, type: 'audio/mp3' }; } };
  const legacy = { items: [{ ...item('lecture.mp3'), isAudio: true }], resumeItemId: 'lecture.mp3', speed: 2.7 };
  storage.setItem('mediaQueue:undefined', JSON.stringify(legacy)); // Unused path must not be imported.
  storage.setItem('mediaQueue:/', JSON.stringify(legacy));
  const db = database([['current', { ...legacy, items: [{ ...legacy.items[0], handle }] }]]);
  const a = tab(storage, { locks: manager, indexedDB: db }); await a.ready;
  assert.equal(vm.runInContext('mediaQueue.length', a.box), 0);
  assert.equal(a.element('savedQueuesList').children.length, 1);
  // Do not start playback/decoding in this storage integration test.
  vm.runInContext('playQueueItem = index => { currentQueueIndex = index; }', a.box);
  const opening = vm.runInContext('openSavedSession("legacy")', a.box);
  assert.deepEqual(permissionCalls, ['request']); // Requests started synchronously with the click.
  await opening;
  assert.equal(vm.runInContext('activeSession.id', a.box), 'legacy');
  assert.equal(vm.runInContext('mediaQueue[0].url !== null', a.box), true);
  assert.equal(a.element('speedControl').value, '2.7');
  const b = tab(storage, { locks: manager, indexedDB: db }); await b.ready;
  vm.runInContext('playQueueItem = index => { currentQueueIndex = index; }', b.box);
  await vm.runInContext('openSavedSession("legacy")', b.box);
  const bId = vm.runInContext('activeSession.id', b.box);
  assert.notEqual(bId, 'legacy');
  assert.equal(vm.runInContext('mediaQueue[0].handle === null', b.box), false);
  assert.equal(vm.runInContext('getSavedPosition("lecture.mp3")', b.box), 120);
  assert.equal(db.records.get(bId).items[0].handle, handle);
  vm.runInContext('mediaQueue[0].position.time = 300; currentPlaybackSpeed = 1.5; saveQueue()', b.box);
  assert.equal(JSON.parse(storage.getItem('mediaQueue:/:session:legacy')).items[0].position.time, 120);
  assert.equal(JSON.parse(storage.getItem(`mediaQueue:/:session:${bId}`)).items[0].position.time, 300);
  vm.runInContext('sessionStore.release()', a.box); vm.runInContext('sessionStore.release()', b.box);
});
test('adding a new batch to an unrestored reload preserves the earlier session separately', async () => {
  const storage = memoryStorage(), manager = locks(), tabStorage = memoryStorage();
  const first = tab(storage, { locks: manager, tabStorage }); await first.ready;
  first.box.entries = [item('old.mp3')];
  vm.runInContext('mediaQueue = entries; saveQueue(); sessionStore.release()', first.box);
  await Promise.resolve();
  const reload = tab(storage, { locks: manager, tabStorage }); await reload.ready;
  assert.equal(vm.runInContext('mediaQueue[0].url', reload.box), null);
  const oldId = vm.runInContext('activeSession.id', reload.box);
  reload.box.batch = [{ name: 'new.mp3', type: 'audio/mp3', size: 200, lastModified: 4 }];
  vm.runInContext('probeMediaDuration = async () => 100; playQueueItem = () => {}', reload.box);
  await vm.runInContext('addFilesToQueue(batch, "test")', reload.box);
  assert.notEqual(vm.runInContext('activeSession.id', reload.box), oldId);
  assert.equal(vm.runInContext('mediaQueue.length', reload.box), 1);
  assert.equal(vm.runInContext('mediaQueue[0].name', reload.box), 'new.mp3');
  assert.equal(vm.runInContext('sessionStore.list().length', reload.box), 2);
  assert.equal(JSON.parse(storage.getItem(`mediaQueue:/:session:${oldId}`)).items[0].name, 'old.mp3');
  vm.runInContext('sessionStore.release()', reload.box);
});
