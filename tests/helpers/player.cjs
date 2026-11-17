const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(`${__dirname}/../../queue-sessions.js`, 'utf8') + '\n' + fs.readFileSync(`${__dirname}/../../position-store.js`, 'utf8') + '\n' + fs.readFileSync(`${__dirname}/../../app.js`, 'utf8');
function tab(storage, options = {}) {
  const listeners = new Map();
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      children: [], open: false,
      set innerHTML(value) { this.children = []; this.html = value; },
      get innerHTML() { return this.html || ''; },
      appendChild(child) { this.children.push(child); },
      pause() { this.paused = true; }, play() { return Promise.resolve(); }, load() {}, removeAttribute() {}, focus() {},
      handlers: {}, playbackRate: 1, dataset: {}, hidden: id === 'audioPlayer', currentTime: 0, duration: 3600, paused: false,
      classList: { toggle() {}, add() {}, remove() {} },
      getContext: () => ({ clearRect() {}, fillRect() {} }),
      getBoundingClientRect: () => ({ width: 800, height: 100 }),
      addEventListener(name, fn) { this.handlers[name] = fn; }, setAttribute() {},
    });
    return elements.get(id);
  }
  const box = {
    console: { warn() {}, log() {} },
    document: { getElementById: element, createElement: tag => element(Symbol(tag)), addEventListener() {}, activeElement: { tagName: 'BODY' } },
    window: { addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    } },
    crypto: require('node:crypto'),
    sessionStorage: options.tabStorage || { getItem: () => null, setItem() {} },
    indexedDB: options.indexedDB,
    navigator: { locks: options.locks }, location: { pathname: '/' }, localStorage: storage,
    requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
    AbortController, URL: class extends URL {
      static createObjectURL(file) { return `blob:${file.name}`; }
      static revokeObjectURL() {}
    }, Float32Array,
  };
  vm.createContext(box);
  vm.runInContext(script, box);
  vm.runInContext('currentMediaName = "recording.mp3";', box);
  return { box, element, ready: (async () => {
    for (let i = 0; i < 100 && !vm.runInContext('queueReady', box); i++) await Promise.resolve();
  })(), player: element('videoPlayer'), emitKey(key) {
    for (const handler of listeners.get('keydown') || []) handler({ key, preventDefault() {} });
  }, emitStorage(event) {
    for (const handler of listeners.get('storage') || []) handler(event);
  } };
}

module.exports = { tab };
