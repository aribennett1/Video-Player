const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { tab } = require('./helpers/player.cjs');
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
test('controller and keyboard speed changes survive reload and apply when loading media', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const first = tab(storage);
  const control = first.element('speedControl');
  control.value = '1.75'; control.handlers.input.call(control);
  assert.equal(first.player.playbackRate, 1.75);
  const reloaded = tab(storage);
  assert.equal(reloaded.element('speedControl').value, '1.75');
  reloaded.player.load = () => {};
  reloaded.player.play = () => Promise.resolve();
  reloaded.player.focus = () => {};
  reloaded.element('audioPlayer').pause = () => {};
  reloaded.element('audioPlayer').removeAttribute = () => {};
  reloaded.element('audioPlayer').load = () => {};
  const loading = vm.runInContext('loadMedia("blob:test", false, "test.mp3")', reloaded.box);
  reloaded.player.onloadedmetadata(); await loading;
  assert.equal(reloaded.player.playbackRate, 1.75);
  reloaded.emitKey('d');
  const afterShortcut = tab(storage);
  assert.equal(afterShortcut.element('speedControl').value, '1.85');
  afterShortcut.player.playbackRate = 1.85;
  afterShortcut.emitKey('s');
  assert.equal(tab(storage).element('speedControl').value, '1.75');
  await Promise.resolve();
});
test('invalid or unavailable speed storage falls back to 1x; unavailable writes do not break controls', async () => {
  for (const value of [null, '', 'nope', 'Infinity', '0', '-1', '101']) {
    const session = tab({ getItem: key => key.startsWith('mediaPlaybackSpeed:') ? value : null, setItem() {} });
    assert.equal(session.element('speedControl').value, '1');
  }
  const session = tab({ getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } });
  assert.equal(session.element('speedControl').value, '1');
  const control = session.element('speedControl');
  control.value = '2'; control.handlers.input.call(control);
  assert.equal(session.player.playbackRate, 2);
  control.value = '200'; control.handlers.input.call(control);
  assert.equal(session.player.playbackRate, 2);
  await Promise.resolve();
});
test('unrestored files collapse separately while playable files stay visible and queue order is preserved', async () => {
  const session = tab({ getItem: () => null, setItem() {} });
  await session.ready;
  session.box.entries = [
    { id: 'a', name: 'saved a.mp3', url: null },
    { id: 'b', name: 'playing.mp3', url: 'blob:b' },
    { id: 'c', name: 'saved c.mp3', url: null },
  ];
  vm.runInContext('mediaQueue = entries; currentQueueIndex = 1; updateQueueDisplay();', session.box);
  const details = session.element('queueRestore');
  const missing = session.element('queueRestoreList');
  const available = session.element('queueList');
  assert.equal(details.hidden, false); assert.equal(details.open, false);
  assert.equal(session.element('queueRestoreSummary').textContent, 'Saved files to restore (2)');
  assert.deepEqual(missing.children.map(li => li.dataset.index), [0, 2]);
  assert.deepEqual(available.children.map(li => li.dataset.index), [1]);
  assert(available.children[0].className.includes('playing'));
  details.open = true;
  vm.runInContext('updateQueueDisplay()', session.box);
  assert.equal(details.open, true); // Metadata updates do not collapse an expanded list.
  vm.runInContext('mediaQueue[0].url = "blob:a"; updateQueueDisplay()', session.box);
  assert.equal(missing.children.length, 1); assert.equal(available.children.length, 2);
  vm.runInContext('mediaQueue[2].url = "blob:c"; updateQueueDisplay()', session.box);
  assert.equal(details.hidden, true); assert.equal(available.children.length, 3);
  assert.deepEqual(Array.from(vm.runInContext('mediaQueue.map(item => item.id)', session.box)), ['a', 'b', 'c']);
});
test('Space on the restore chevron is left to the browser rather than toggling playback', async () => {
  const session = tab({ getItem: () => null, setItem() {} });
  session.box.document.activeElement = { tagName: 'SUMMARY' };
  session.player.play = () => assert.fail('summary activation must not start media');
  session.player.pause = () => assert.fail('summary activation must not pause media');
  session.emitKey(' ');
  await Promise.resolve();
});
