const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(`${__dirname}/../position-store.js`, 'utf8') + '\n' + fs.readFileSync(`${__dirname}/../app.js`, 'utf8');
function tab(storage) {
  const listeners = new Map();
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      dataset: {}, hidden: id === 'audioPlayer', currentTime: 0, duration: 3600, paused: false,
      classList: { toggle() {}, add() {}, remove() {} },
      getContext: () => ({ clearRect() {}, fillRect() {} }),
      getBoundingClientRect: () => ({ width: 800, height: 100 }),
      addEventListener() {}, setAttribute() {},
    });
    return elements.get(id);
  }
  const box = {
    console: { warn() {}, log() {} },
    document: { getElementById: element, addEventListener() {} },
    window: { addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    } },
    navigator: {}, location: { pathname: '/' }, localStorage: storage,
    requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
    AbortController, URL, Float32Array,
  };
  vm.createContext(box);
  vm.runInContext(script, box);
  vm.runInContext('currentMediaName = "recording.mp3";', box);
  return { box, player: element('videoPlayer'), emitStorage(event) {
    for (const handler of listeners.get('storage') || []) handler(event);
  } };
}
test('another tab saving progress never seeks playing or paused media; future loads use latest resume', async () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const a = tab(storage), b = tab(storage);
  a.player.currentTime = 120;
  b.player.currentTime = 1800;
  for (const paused of [false, true]) {
    b.player.paused = paused;
    vm.runInContext('saveCurrentPositionNow()', a.box);
    b.emitStorage({ key: 'mediaPlaybackPositions', newValue: values.get('mediaPlaybackPositions') });
    assert.equal(b.player.currentTime, 1800);
    assert.equal(vm.runInContext('getSavedPosition("recording.mp3")', b.box), 120);
  }
  vm.runInContext('saveCurrentPositionNow()', b.box);
  a.emitStorage({ key: 'mediaPlaybackPositions', newValue: values.get('mediaPlaybackPositions') });
  assert.equal(a.player.currentTime, 120);
  assert.equal(vm.runInContext('getSavedPosition("recording.mp3")', a.box), 1800);
  // Allow async startup to finish so errors cannot escape after the test.
  await Promise.resolve();
});
test('reading legacy positions persists migration once, then expires them without playback', async () => {
  let now = 2_000_000_000_000;
  let raw = JSON.stringify({ legacy: 42, object: { time: 60, duration: 100 } });
  let writes = 0;
  const storage = {
    getItem: key => key === 'mediaPlaybackPositions' ? raw : null,
    setItem: (key, value) => { if (key === 'mediaPlaybackPositions') { raw = value; writes++; } },
  };
  const { box } = tab(storage);
  box.Date = class extends Date { static now() { return now; } };
  vm.runInContext('readPositionStore()', box);
  assert.equal(writes, 1);
  assert.equal(JSON.parse(raw).legacy.updatedAt, now);
  now += 1000;
  vm.runInContext('readPositionStore()', box);
  assert.equal(writes, 1);
  now += 7 * 24 * 60 * 60 * 1000;
  vm.runInContext('readPositionStore()', box);
  assert.deepEqual(JSON.parse(raw), {});
  assert.equal(writes, 2);
  await Promise.resolve();
});
