const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(`${__dirname}/../position-store.js`, 'utf8') + '\n' + fs.readFileSync(`${__dirname}/../app.js`, 'utf8');
function source(name) {
  const start = script.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert(start >= 0, name);
  return script.slice(start, script.indexOf('\n}', start) + 2);
}
function setup(names, overrides = {}) {
  const stored = new Map();
  const box = {
    console: { log() {}, warn() {} }, URL: { createObjectURL: file => `blob:${file.name}` },
    mediaQueue: [], currentQueueIndex: -1, resumeItemId: null, queueDB: null,
    queueReady: true, restoringQueue: false, changingSession: false, QUEUE_STORAGE_KEY: 'test-queue',
    queueRestore: {}, queueRestoreStatus: {}, fileInput: {},
    localStorage: { setItem: (key, value) => stored.set(key, value), getItem: key => stored.get(key) || null },
    updateQueueDisplay() {}, playQueueItem(index) { box.played = index; },
    ...overrides,
  };
  vm.createContext(box);
  vm.runInContext(names.map(source).join('\n'), box);
  return { box, stored };
}
const file = name => ({ name, size: 123, lastModified: 456, type: 'audio/mp3' });
const item = name => ({ ...file(name), id: name, isAudio: true, duration: 10, file: null, url: null });
test('application JavaScript parses', () => new vm.Script(script));
test('restore requests all permissions before yielding and retains denied or missing files', async () => {
  const calls = [];
  const { box } = setup(['sameQueueFile', 'attachQueueFile', 'resumeRestoredQueue', 'restoreSavedQueue']);
  box.mediaQueue = ['a', 'b', 'c'].map(name => ({ ...item(name), handle: {
    requestPermission() { calls.push(name); return Promise.resolve(name === 'b' ? 'denied' : 'granted'); },
    async getFile() { if (name === 'c') throw Error('deleted'); return file(name); },
  } }));
  box.resumeItemId = 'a';
  const restore = box.restoreSavedQueue();
  assert.deepEqual(calls, ['a', 'b', 'c']);
  await restore;
  assert.equal(box.mediaQueue[0].url, 'blob:a'); assert.equal(box.mediaQueue[1].url, null); assert.equal(box.mediaQueue[2].url, null);
  assert.equal(box.played, 0); assert.equal(box.restoringQueue, false);
});
test('reselection preserves queue order and rejects files with different identity', () => {
  const { box } = setup(['sameQueueFile', 'attachQueueFile', 'resumeRestoredQueue', 'addFilesToQueue'], {
    isSupportedMediaFile: () => true, ts: () => '',
  });
  box.mediaQueue = [item('a'), item('b')]; box.resumeItemId = 'b';
  box.addFilesToQueue([{ ...file('a'), size: 999 }, file('b')], 'test', [], true);
  assert.equal(box.mediaQueue[0].url, null); assert.equal(box.mediaQueue[1].url, 'blob:b');
  box.addFilesToQueue([file('a')], 'test', [], true);
  assert.deepEqual(Array.from(box.mediaQueue, i => i.name), ['a', 'b']);
  assert.equal(box.played, 1);
});
test('an item removed while file access is pending stays removed', async () => {
  let complete;
  const { box } = setup(['sameQueueFile', 'attachQueueFile', 'resumeRestoredQueue', 'restoreSavedQueue']);
  box.mediaQueue = [{ ...item('a'), handle: { requestPermission: async () => 'granted', getFile: () => new Promise(resolve => { complete = resolve; }) } }];
  const pending = box.restoreSavedQueue();
  while (!complete) await Promise.resolve();
  box.mediaQueue = []; complete(file('a')); await pending;
  assert.equal(box.mediaQueue.length, 0); assert.equal(box.played, undefined);
});
test('next, previous, and playlist repeat skip files still requiring access', () => {
  const { box } = setup(['playNext', 'playPrevious'], { repeatMode: 'none' });
  box.mediaQueue = [item('a'), { ...item('b'), url: 'blob:b' }, item('c'), { ...item('d'), url: 'blob:d' }];
  box.currentQueueIndex = 1; box.playNext(); assert.equal(box.played, 3);
  box.currentQueueIndex = 3; box.playPrevious(); assert.equal(box.played, 1);
  box.repeatMode = 'playlist'; box.playNext(); assert.equal(box.played, 1);
});
