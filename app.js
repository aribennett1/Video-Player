const fileInput = document.getElementById("fileInput");
const videoPlayer = document.getElementById("videoPlayer");
const audioPlayer = document.getElementById("audioPlayer");
const speedControl = document.getElementById("speedControl");
const repeatButton = document.getElementById("repeatButton");
const canvas = document.getElementById("waveform");
const ctx = canvas.getContext("2d");
const progressCanvas = document.getElementById("progressOverlay");
const progressCtx = progressCanvas.getContext("2d");
const queueContainer = document.getElementById("queueContainer");
const queueList = document.getElementById("queueList");
const queueCount = document.getElementById("queueCount");
const reverseQueueButton = document.getElementById("reverseQueueButton");


// Queue management
let mediaQueue = [];
let currentQueueIndex = -1;
let currentWaveform = null;
let currentPlaybackSpeed = 1.0;
let currentMediaName = null;
let savePositionTimer = null;
let repeatMode = "none";

const SPEED_STORAGE_KEY = `mediaPlaybackSpeed:${location.pathname}`;
try {
  const savedSpeed = Number(localStorage.getItem(SPEED_STORAGE_KEY));
  if (Number.isFinite(savedSpeed) && savedSpeed >= 0.1 && savedSpeed <= 100) {
    currentPlaybackSpeed = savedSpeed;
  }
} catch (err) {
  console.warn("Could not read playback speed:", err);
}
speedControl.value = String(currentPlaybackSpeed);

function savePlaybackSpeed() {
  try {
    localStorage.setItem(SPEED_STORAGE_KEY, String(currentPlaybackSpeed));
  } catch (err) {
    console.warn("Could not save playback speed:", err);
  }
  saveQueue();
}

const POSITION_STORAGE_KEY = "mediaPlaybackPositions";
const POSITION_SAVE_DELAY_MS = 5000;
const POSITION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REPEAT_MODES = ["none", "playlist", "track"];
const REPEAT_LABELS = {
  none: "Repeat is off",
  playlist: "Repeat playlist",
  track: "Repeat current track",
};
const REPEAT_TITLES = {
  none: "Repeat is off",
  playlist: "Repeating playlist",
  track: "Repeating current track",
};

const ts = () => `[${new Date().toISOString()}]`;

// Resolve self-hosted ffmpeg assets (same origin — no CDN / Worker CORS issues)
function ffmpegAsset(file) {
  return new URL(`vendor/ffmpeg/${file}`, document.baseURI || window.location.href).href;
}

// Each waveform job owns its temporary decoder and worker.
let waveformJob = null;

function cancelWaveformJob() {
  if (!waveformJob) return;
  waveformJob.controller.abort();
  waveformJob.ff?.terminate();
  if (waveformJob.audioCtx && waveformJob.audioCtx.state !== "closed") {
    waveformJob.audioCtx.close().catch(() => {});
  }
  waveformJob = null;
}

const queueRestore = document.getElementById("queueRestore");
const queueRestoreSummary = document.getElementById("queueRestoreSummary");
const queueRestoreList = document.getElementById("queueRestoreList");
const restoreQueueButton = document.getElementById("restoreQueueButton");
const relinkQueueButton = document.getElementById("relinkQueueButton");
const queueRestoreStatus = document.getElementById("queueRestoreStatus");
const QUEUE_STORAGE_KEY = `mediaQueue:${location.pathname}`;
let queueDB = null;
let queueReady = false;
let restoringQueue = false;
let resumeItemId = null;
let relinkingFiles = false;
let useNativePicker = false;

function queueRecord(item) {
  return {
    id: item.id, name: item.name, size: item.size,
    lastModified: item.lastModified, isAudio: item.isAudio,
    duration: item.duration, position: item.position || null, handle: item.handle || null,
  };
}

const savedQueues = document.getElementById("savedQueues");
const savedQueuesSummary = document.getElementById("savedQueuesSummary");
const savedQueuesList = document.getElementById("savedQueuesList");
const sessionStatus = document.getElementById("sessionStatus");
let sessionStore;
let activeSession = null;
let savedHandles = new Map();
let changingSession = false;

function writeSessionHandles(snapshot) {
  if (!queueDB) return;
  try {
    const tx = queueDB.transaction("queue", "readwrite");
    tx.objectStore("queue").put(snapshot, snapshot.id);
    tx.onerror = () => console.warn("Could not save file access; queue metadata is still saved.");
  } catch (err) { console.warn("Could not save file access:", err); }
}

function saveQueue() {
  if (!queueReady || !activeSession || sessionStore.activeId !== activeSession.id || (!mediaQueue.length && !activeSession.items?.length)) return;
  activeSession = {
    ...activeSession,
    name: sessionStore.read(activeSession.id)?.name ?? activeSession.name ?? "",
    items: mediaQueue.map(queueRecord),
    resumeItemId: mediaQueue[currentQueueIndex]?.id || resumeItemId,
    speed: currentPlaybackSpeed, updatedAt: Date.now(),
  };
  sessionStore.save(activeSession);
  savedHandles.set(activeSession.id, activeSession);
  writeSessionHandles(activeSession);
  if (sessionStore.storageError) sessionStatus.textContent = "Browser storage is unavailable; queues may not survive closing this tab.";
}

function renderSavedSessions() {
  if (!sessionStore) return;
  const records = sessionStore.list().filter(record => record.id !== activeSession?.id);
  savedQueues.hidden = !records.length;
  savedQueuesSummary.textContent = `Saved queues (${records.length})`;
  savedQueuesList.innerHTML = "";
  for (const record of records) {
    const row = document.createElement("li");
    row.className = "saved-session";
    const label = document.createElement("span");
    label.className = "saved-session-label";
    label.textContent = `${record.name || record.items[0]?.name || "Queue"} · ${record.items.length} files · ${new Date(record.updatedAt).toLocaleString()}`;
    row.appendChild(label);
    for (const [text, action] of [
      ["Restore", () => openSavedSession(record.id)],
      ["Rename", () => renameSavedSession(record.id)],
      ["Delete", () => deleteSavedSession(record.id)],
    ]) {
      const button = document.createElement("button");
      button.type = "button"; button.textContent = text;
      button.disabled = changingSession;
      button.onclick = action;
      row.appendChild(button);
    }
    savedQueuesList.appendChild(row);
  }
}

function resetCurrentQueue() {
  cancelWaveformJob();
  currentMediaName = null;
  currentQueueIndex = -1;
  for (const player of [videoPlayer, audioPlayer]) {
    player.pause(); player.removeAttribute("src"); player.load();
    player.classList.remove("loaded-video");
  }
  for (const item of mediaQueue) if (item.url) URL.revokeObjectURL(item.url);
  mediaQueue = [];
  currentWaveform = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  progressCtx.clearRect(0, 0, progressCanvas.width, progressCanvas.height);
}

function applyQueueSession(record) {
  const handles = new Map((savedHandles.get(record.id)?.items || record.items || []).map(item => [item.id, item.handle]));
  mediaQueue = (record.items || []).filter(item => item && typeof item.name === "string" && typeof item.id === "string").map(item => ({
    ...queueRecord(item), handle: handles.get(item.id) || null, file: null, url: null,
  }));
  resumeItemId = record.resumeItemId || null;
  const speed = Number(record.speed);
  if (Number.isFinite(speed) && speed >= 0.1 && speed <= 100) currentPlaybackSpeed = speed;
  speedControl.value = String(currentPlaybackSpeed);
  activeSession = record;
}

async function openSavedSession(id) {
  if (!queueReady || changingSession || restoringQueue) return;
  const metadata = sessionStore.read(id);
  if (!metadata) return;
  // Start file permission requests within this click, before claiming the session.
  const handleRecord = savedHandles.get(id);
  const handleMap = new Map((handleRecord?.items || []).map(item => [item.id, item.handle]));
  const requests = metadata.items.map(item => {
    const handle = handleMap.get(item.id);
    try { return handle ? Promise.resolve(handle.requestPermission({ mode: "read" })).catch(() => "denied") : Promise.resolve("denied"); }
    catch (_) { return Promise.resolve("denied"); }
  });
  changingSession = true;
  saveCurrentPositionNow(); saveQueue();
  renderSavedSessions();
  try {
    const claimed = await sessionStore.activate({ ...metadata, items: metadata.items.map(item => ({ ...item, handle: handleMap.get(item.id) || null })) });
    resetCurrentQueue();
    applyQueueSession(claimed);
    if (claimed.copied) sessionStatus.textContent = "Opened an independent copy of this queue.";
    else sessionStatus.textContent = "";
    const items = [...mediaQueue];
    await Promise.all(items.map(async (item, index) => {
      if (await requests[index] !== "granted" || !item.handle) return;
      try { const file = await item.handle.getFile(); if (mediaQueue.includes(item)) attachQueueFile(item, file, item.handle); }
      catch (_) {} // Retain unavailable files for retry or reselection.
    }));
  } finally {
    changingSession = false;
    updateQueueDisplay();
    resumeRestoredQueue();
  }
}

async function startNewSession() {
  if (!queueReady || changingSession || restoringQueue) return;
  changingSession = true;
  saveCurrentPositionNow(); saveQueue();
  try {
    const record = await sessionStore.activate();
    resetCurrentQueue(); applyQueueSession(record);
    sessionStatus.textContent = "New queue. Add files or restore a saved queue.";
  } finally { changingSession = false; updateQueueDisplay(); }
}

function renameSavedSession(id) {
  const record = sessionStore.read(id);
  if (!record) return;
  const name = window.prompt("Queue name", record.name || record.items[0]?.name || "Queue");
  if (name === null) return;
  sessionStore.save({ ...record, name: name.trim().slice(0, 200) });
  renderSavedSessions();
}

async function deleteSavedSession(id) {
  try {
    if (!await sessionStore.remove(id)) {
      sessionStatus.textContent = "This queue is open in another tab. Close it before deleting its saved queue.";
      return;
    }
    savedHandles.delete(id);
    if (queueDB) queueDB.transaction("queue", "readwrite").objectStore("queue").delete(id);
    renderSavedSessions();
  } catch (err) { sessionStatus.textContent = "Could not delete this saved queue."; }
}

async function refreshSavedHandles() {
  if (!queueDB) return;
  try {
    const records = await new Promise((resolve, reject) => {
      const request = queueDB.transaction("queue").objectStore("queue").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    for (const record of records) savedHandles.set(record.id || "legacy", record);
  } catch (err) { console.warn("Could not refresh saved file access:", err); }
}

async function loadSavedQueue() {
  let storage, tabStorage;
  const unavailable = { getItem: () => null, setItem() { throw new Error("Storage unavailable"); } };
  try { storage = localStorage; } catch (_) { storage = unavailable; }
  try { tabStorage = sessionStorage; } catch (_) { tabStorage = unavailable; }
  sessionStore = new QueueSessions({ storage, tabStorage, locks: navigator.locks, prefix: QUEUE_STORAGE_KEY });
  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY)); } catch (_) {}
  try {
    queueDB = await new Promise((resolve, reject) => {
      const request = indexedDB.open(QUEUE_STORAGE_KEY, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("queue");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Queue storage is busy"));
    });
    queueDB.onversionchange = () => { queueDB.close(); queueDB = null; };
    const stored = await new Promise((resolve, reject) => {
      const request = queueDB.transaction("queue").objectStore("queue").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    for (const record of stored) {
      if (record.id) savedHandles.set(record.id, record);
      else { savedHandles.set("legacy", record); legacy ||= record; }
    }
  } catch (err) { console.warn("Saved file access unavailable:", err); }
  const migrated = sessionStore.migrate(legacy);
  if (migrated) writeSessionHandles({ ...migrated, items: migrated.items.map(item => ({ ...item, handle: savedHandles.get("legacy")?.items?.find(saved => saved.id === item.id)?.handle || null })) });
  const previous = sessionStore.tabSession();
  const record = await sessionStore.activate(previous);
  if (record.copied && previous) record.items = previous.items.map(item => ({ ...item, handle: savedHandles.get(previous.id)?.items?.find(saved => saved.id === item.id)?.handle || null }));
  applyQueueSession(record);
  queueReady = true;
  fileInput.disabled = false;
  updateQueueDisplay();
}

document.getElementById("newQueueButton").addEventListener("click", startNewSession);
window.addEventListener("storage", async event => {
  if (!event.key?.startsWith(`${QUEUE_STORAGE_KEY}:session:`)) return;
  await refreshSavedHandles();
  renderSavedSessions();
});
window.addEventListener("pagehide", () => { saveCurrentPositionNow(); saveQueue(); sessionStore?.release?.(); });
window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload(); // Reclaim ownership after returning from the back/forward cache.
});

function sameQueueFile(item, file) {
  return item.name === file.name && item.size === file.size && item.lastModified === file.lastModified;
}

function attachQueueFile(item, file, handle) {
  item.file = file;
  item.url = URL.createObjectURL(file);
  item.handle = handle || item.handle || null;
}

function resumeRestoredQueue() {
  updateQueueDisplay();
  if (currentQueueIndex >= 0) return;
  const preferred = mediaQueue.findIndex((item) => item.id === resumeItemId && item.url);
  const index = preferred >= 0 ? preferred : mediaQueue.findIndex((item) => item.url);
  if (index >= 0) playQueueItem(index);
}

// Invoke permission requests directly in the click handler, before any I/O.
async function restoreSavedQueue() {
  if (!queueReady || restoringQueue || changingSession) return;
  const pending = mediaQueue.filter((item) => !item.url && item.handle);
  if (!pending.length) { chooseQueueFiles(true); return; }
  restoringQueue = true;
  const permissions = pending.map((item) => {
    try { return Promise.resolve(item.handle.requestPermission({ mode: "read" })); }
    catch (err) { return Promise.reject(err); }
  });
  updateQueueDisplay();
  try {
    const results = await Promise.allSettled(permissions);
    await Promise.all(pending.map(async (item, index) => {
      if (results[index].status !== "fulfilled" || results[index].value !== "granted") return;
      try {
        const file = await item.handle.getFile();
        if (!mediaQueue.includes(item) || item.url) return;
        if (!sameQueueFile(item, file)) {
          item.size = file.size;
          item.lastModified = file.lastModified;
          item.duration = null;
        }
        attachQueueFile(item, file, item.handle);
      } catch (err) { console.warn("File needs to be reselected:", item.name, err); }
    }));
  } finally {
    restoringQueue = false;
    resumeRestoredQueue();
  }
}

async function chooseQueueFiles(relink = false) {
  if (!queueReady || changingSession) return;
  relinkingFiles = relink;
  if (!window.showOpenFilePicker || useNativePicker) { fileInput.click(); return; }
  try {
    const handles = await window.showOpenFilePicker({ multiple: true });
    const results = await Promise.allSettled(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
    const entries = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    addFilesToQueue(entries.map((entry) => entry.file), "filePicker", entries.map((entry) => entry.handle), relink);
  } catch (err) {
    if (err.name !== "AbortError") {
      useNativePicker = true;
      queueRestore.hidden = false;
      queueRestore.open = true;
      queueRestoreStatus.textContent = "Click again to select files using the standard chooser.";
      console.warn("File picker failed:", err);
    }
  } finally { relinkingFiles = false; }
}

restoreQueueButton.addEventListener("click", restoreSavedQueue);
relinkQueueButton.addEventListener("click", () => chooseQueueFiles(true));
// Prefer persistent handles for the existing native file chooser as well.
fileInput.addEventListener("click", (event) => {
  if (window.showOpenFilePicker && !useNativePicker) {
    event.preventDefault();
    chooseQueueFiles(relinkingFiles);
  }
});

// Drag and drop state
let draggedIndex = null;

function readPositionStore() {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY) || "{}";
    const parsed = JSON.parse(raw);
    const store = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    const pruned = PlaybackPositionStore.prune(store, Date.now(), POSITION_TTL_MS);

    // Persist both expiry and one-time migration, even when the count is unchanged.
    if (JSON.stringify(pruned) !== JSON.stringify(store)) {
      localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pruned));
    }

    return pruned;
  } catch (err) {
    console.warn("Could not read playback positions:", err);
    return {};
  }
}

function writePositionStore(store) {
  localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(store));
}

// Saved positions are read when loading media only. Other tabs may save
// their own progress, but must never seek this tab's active player.
function saveCurrentPositionNow() {
  const player = videoPlayer.hidden ? audioPlayer : videoPlayer;
  if (!currentMediaName || !player.duration || isNaN(player.duration)) return;

  const store = readPositionStore();
  store[currentMediaName] = {
    time: Math.max(0, Math.min(player.currentTime || 0, player.duration || 0)),
    duration: player.duration,
    updatedAt: Date.now(),
  };
  writePositionStore(store);
  const item = mediaQueue[currentQueueIndex];
  if (item && item.name === currentMediaName) {
    item.position = store[currentMediaName];
    saveQueue();
  }
}

function schedulePositionSave() {
  if (savePositionTimer) return;
  savePositionTimer = setTimeout(() => {
    savePositionTimer = null;
    saveCurrentPositionNow();
  }, POSITION_SAVE_DELAY_MS);
}

function getSavedPosition(filename) {
  const item = mediaQueue[currentQueueIndex];
  const saved = item?.name === filename && item.position ? item.position : readPositionStore()[filename];
  const time = typeof saved === "number" ? saved : saved && saved.time;
  return Number.isFinite(time) && time > 0 ? time : 0;
}

function getStoredDuration(filename) {
  const saved = readPositionStore()[filename];
  const duration =
    typeof saved === "object" && saved ? saved.duration : null;
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "";
  const seconds = Math.floor(totalSeconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function getQueueItemPopoverText(item) {
  if (Number.isFinite(item.duration) && item.duration > 0) {
    return `${item.name} (${formatDuration(item.duration)})`;
  }
  return item.name;
}

function probeMediaDuration(url, isAudio) {
  return new Promise((resolve) => {
    const el = document.createElement(isAudio ? "audio" : "video");
    el.preload = "metadata";
    const cleanup = () => {
      el.onloadedmetadata = null;
      el.onerror = null;
      el.removeAttribute("src");
      el.load();
      el.remove();
    };
    el.onloadedmetadata = () => {
      const duration = el.duration;
      cleanup();
      resolve(Number.isFinite(duration) ? duration : null);
    };
    el.onerror = () => {
      cleanup();
      resolve(null);
    };
    el.src = url;
  });
}

// Ensure canvas drawing size matches its CSS size
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width || 1;
  canvas.height = rect.height || 1;
  progressCanvas.width = rect.width || 1;
  progressCanvas.height = rect.height || 1;

  // Redraw from compact amplitude data
  if (currentWaveform) {
    drawFullWaveform();
  }
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// Retain only 4096 amplitude bins (16 KiB), never the decoded track.
function summarizeWaveform(audioBuffer) {
  const channelData = audioBuffer.getChannelData(0);
  const waveform = new Float32Array(Math.min(4096, channelData.length));
  for (let i = 0; i < waveform.length; i++) {
    const start = Math.floor(i * channelData.length / waveform.length);
    const end = Math.floor((i + 1) * channelData.length / waveform.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += Math.abs(channelData[j]);
    waveform[i] = sum / (end - start || 1);
  }
  return waveform;
}

function drawFullWaveform() {
  if (!currentWaveform) return;
  const waveform = currentWaveform;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw waveform
  ctx.lineWidth = 1;
  ctx.fillStyle = "#4a9eff";

  const midY = canvas.height / 2;
  const halfHeight = canvas.height / 2;
  const amplification = 7; // Make waves taller

  for (let x = 0; x < canvas.width; x++) {
    const start = Math.floor(x * waveform.length / canvas.width);
    const end = Math.min(waveform.length, Math.max(start + 1, Math.floor((x + 1) * waveform.length / canvas.width)));
    let sum = 0;
    for (let i = start; i < end; i++) sum += waveform[i];
    const v = sum / (end - start || 1);
    const barHeight = Math.min(
      v * halfHeight * amplification,
      halfHeight
    );
    ctx.fillRect(x, midY - barHeight, 1, barHeight * 2);
  }
}

// Show a loading state on the waveform canvas while ffmpeg is working
function drawWaveformLoadingState(message) {
  currentWaveform = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(74, 158, 255, 0.3)";
  ctx.fillRect(0, canvas.height / 2 - 2, canvas.width, 4);
  ctx.font = "12px Arial";
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.fillText(message, 8, 18);
}

// Flat bar shown when waveform generation fails entirely
function drawFlatFallback() {
  currentWaveform = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#4a9eff";
  const midY = canvas.height / 2;
  const barHeight = canvas.height * 0.15;
  ctx.fillRect(0, midY - barHeight, canvas.width, barHeight * 2);
  ctx.font = "12px Arial";
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.fillText("Waveform unavailable", 8, 18);
}

async function decodeAndDrawWaveform(arrayBuffer, job) {
  if (waveformJob !== job) return;
  // Decode at 8 kHz to limit temporary PCM memory as well.
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 8000 });
  job.audioCtx = audioCtx;
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    if (waveformJob !== job) return;
    currentWaveform = summarizeWaveform(audioBuffer);
    drawFullWaveform();
  } finally {
    if (audioCtx.state !== "closed") await audioCtx.close();
    job.audioCtx = null;
  }
}

function safeFfmpegInputName(originalName) {
  const ext = originalName.includes(".")
    ? originalName.slice(originalName.lastIndexOf("."))
    : ".mp4";
  return "input" + ext.replace(/[^a-zA-Z0-9.]/g, "");
}

// Mount video via WORKERFS (reads File in chunks — no multi-GB MEMFS copy),
// extract a tiny audio track, then draw with the same path as audio files.
async function extractAudioWithFFmpeg(item, job) {
  console.log(ts(), "[ffmpeg] extractAudioWithFFmpeg called.",
    "file:", item.name, "size:", item.file.size, "type:", item.file.type);

  const ff = new FFmpegWASM.FFmpeg();
  job.ff = ff;
  try {
    await ff.load({ coreURL: ffmpegAsset("ffmpeg-core.js"), wasmURL: ffmpegAsset("ffmpeg-core.wasm") });
    console.log(ts(), "[ffmpeg] Got ffmpeg instance.");

    const mountDir = "/input";
    const inputName = safeFfmpegInputName(item.name);
    const inputPath = `${mountDir}/${inputName}`;
    const outputName = "audio.mp3";

    // WORKERFS reads the File via blob.slice() — never copies the whole video into RAM
    const inputFile = item.file.name === inputName
      ? item.file
      : new File([item.file], inputName, { type: item.file.type });

    console.log(ts(), "[ffmpeg] Mounting WORKERFS at", mountDir, "as", inputName);
    await ff.createDir(mountDir);
    await ff.mount("WORKERFS", { files: [inputFile] }, mountDir);

    try {
      console.log(ts(), "[ffmpeg] Running audio extraction (8kHz mono MP3)...");
      await ff.exec([
        "-i", inputPath,
        "-vn",
        "-ac", "1",
        "-ar", "8000",
        "-b:a", "8k",
        "-f", "mp3",
        outputName,
      ]);
      console.log(ts(), "[ffmpeg] ff.exec() complete.");

      const data = await ff.readFile(outputName);
      console.log(ts(), "[ffmpeg] Read", outputName, "Byte length:", data.byteLength);
      await ff.deleteFile(outputName);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    } catch (err) {
      console.error(ts(), "[ffmpeg] extraction FAILED:", err);
      throw err;
    }
  } finally {
    ff.terminate();
    job.ff = null;
  }
}

async function renderWaveformForItem(item, job) {
  if (waveformJob !== job) return;
  resizeCanvas();
  drawWaveformLoadingState("Generating waveform…");
  try {
    const data = item.isAudio
      ? await fetch(item.url, { signal: job.controller.signal }).then((r) => r.arrayBuffer())
      : await extractAudioWithFFmpeg(item, job);
    if (waveformJob !== job) return;
    await decodeAndDrawWaveform(data, job);
  } catch (err) {
    if (waveformJob !== job) return;
    console.warn(ts(), "[waveform] Generation failed:", err);
    drawFlatFallback();
  } finally {
    if (waveformJob === job) waveformJob = null;
  }
}

// Draw progress overlay on waveform
function drawProgressOverlay() {
  const player = videoPlayer.hidden ? audioPlayer : videoPlayer;
  if (!player.duration || isNaN(player.duration)) {
    requestAnimationFrame(drawProgressOverlay);
    return;
  }

  progressCtx.clearRect(
    0,
    0,
    progressCanvas.width,
    progressCanvas.height
  );

  const progress = player.currentTime / player.duration;
  const progressX = progress * progressCanvas.width;

  // Draw semi-transparent overlay for played portion
  progressCtx.fillStyle = "rgba(74, 158, 255, 0.3)";
  progressCtx.fillRect(0, 0, progressX, progressCanvas.height);

  // Draw progress line
  progressCtx.fillStyle = "rgba(255, 255, 255, 0.8)";
  progressCtx.fillRect(progressX - 1, 0, 2, progressCanvas.height);

  requestAnimationFrame(drawProgressOverlay);
}

// Start progress overlay animation
drawProgressOverlay();

// Update queue display
function updateQueueDisplay() {
  saveQueue();
  renderSavedSessions();
  queueCount.textContent = mediaQueue.length;
  queueCount.setAttribute("aria-label", `${mediaQueue.length} file${mediaQueue.length === 1 ? "" : "s"} in queue`);
  const missing = mediaQueue.filter((item) => !item.url).length;
  queueRestore.hidden = missing === 0;
  queueRestoreSummary.textContent = `Saved files to restore (${missing})`;
  queueRestoreList.innerHTML = "";
  restoreQueueButton.disabled = restoringQueue;
  relinkQueueButton.disabled = restoringQueue;
  if (missing) queueRestoreStatus.textContent = restoringQueue
    ? "Restoring files…"
    : `${missing} saved file${missing === 1 ? " needs" : "s need"} access. Restore or reselect the original files.`;
  reverseQueueButton.disabled = changingSession || mediaQueue.length < 2;
  document.getElementById("newQueueButton").disabled = changingSession || restoringQueue;
  queueList.innerHTML = "";

  if (mediaQueue.length === 0) {
    queueList.innerHTML =
      '<li class="queue-empty">No files in queue. Select files or drop them onto the page to queue them.</li>';
    return;
  }

  mediaQueue.forEach((item, index) => {
    const li = document.createElement("li");
    li.className =
      "queue-item" + (index === currentQueueIndex ? " playing" : "") + (!item.url ? " unavailable" : "");
    li.draggable = true;
    li.dataset.index = index;

    const nameWrapper = document.createElement("span");
    nameWrapper.className = "queue-item-name-wrapper";

    const nameSpan = document.createElement("span");
    nameSpan.className = "queue-item-name";
    nameSpan.textContent = item.name + (!item.url ? " (restore required)" : "");

    const popover = document.createElement("span");
    popover.className = "queue-item-popover";
    popover.setAttribute("role", "tooltip");
    popover.textContent = getQueueItemPopoverText(item);

    nameWrapper.appendChild(nameSpan);
    nameWrapper.appendChild(popover);

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.disabled = changingSession || restoringQueue;
    removeBtn.onclick = () => removeFromQueue(index);

    // Drag and drop event handlers
    li.addEventListener("dragstart", handleDragStart);
    li.addEventListener("dragend", handleDragEnd);
    li.addEventListener("dragover", handleDragOver);
    li.addEventListener("drop", handleDrop);
    li.addEventListener("dragleave", handleDragLeave);

    // Double-click to play
    li.addEventListener("dblclick", () => {
      playQueueItem(index);
    });

    li.appendChild(nameWrapper);
    li.appendChild(removeBtn);
    (item.url ? queueList : queueRestoreList).appendChild(li);
  });
}

// Drag and drop handlers
function handleDragStart(e) {
  draggedIndex = parseInt(e.currentTarget.dataset.index);
  e.currentTarget.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
}

function handleDragEnd(e) {
  e.currentTarget.classList.remove("dragging");
  // Remove all drag-over classes
  document.querySelectorAll(".queue-item").forEach((item) => {
    item.classList.remove("drag-over");
  });
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const targetIndex = parseInt(e.currentTarget.dataset.index);
  if (targetIndex !== draggedIndex) {
    e.currentTarget.classList.add("drag-over");
  }
  return false;
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}

function handleDrop(e) {
  e.stopPropagation();
  e.preventDefault();

  const targetIndex = parseInt(e.currentTarget.dataset.index);

  if (draggedIndex !== null && draggedIndex !== targetIndex) {
    // Reorder the queue
    const draggedItem = mediaQueue[draggedIndex];
    mediaQueue.splice(draggedIndex, 1);
    mediaQueue.splice(targetIndex, 0, draggedItem);

    // Update currentQueueIndex if necessary
    if (currentQueueIndex === draggedIndex) {
      currentQueueIndex = targetIndex;
    } else if (draggedIndex < currentQueueIndex && targetIndex >= currentQueueIndex) {
      currentQueueIndex--;
    } else if (draggedIndex > currentQueueIndex && targetIndex <= currentQueueIndex) {
      currentQueueIndex++;
    }

    updateQueueDisplay();
  }

  return false;
}

// Remove item from queue
function deletePositionEntry(filename) {
  const store = readPositionStore();
  if (filename in store) {
    delete store[filename];
    writePositionStore(store);
  }
}

function removeFromQueue(index) {
  const removedItem = mediaQueue[index];
  const removedName = removedItem.name;
  if (removedItem.url) URL.revokeObjectURL(removedItem.url);
  if (resumeItemId === removedItem.id) resumeItemId = null;
  deletePositionEntry(removedName);

  if (index === currentQueueIndex) {
    // If removing currently playing item, play next
    mediaQueue.splice(index, 1);
    const nextIndex = mediaQueue.findIndex((item, i) => i >= index && item.url);
    const availableIndex = nextIndex >= 0 ? nextIndex : mediaQueue.findIndex((item) => item.url);
    if (availableIndex >= 0) {
      currentQueueIndex = -1;
      currentMediaName = null;
      playQueueItem(availableIndex);
    } else {
      currentQueueIndex = -1;
      currentMediaName = null;
      // Clear players
      cancelWaveformJob();
      videoPlayer.pause();
      videoPlayer.removeAttribute("src");
      videoPlayer.load();
      videoPlayer.classList.remove("loaded-video");
      audioPlayer.pause();
      audioPlayer.removeAttribute("src");
      audioPlayer.load();
      currentWaveform = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      progressCtx.clearRect(
        0,
        0,
        progressCanvas.width,
        progressCanvas.height
      );
    }
  } else {
    mediaQueue.splice(index, 1);
    if (index < currentQueueIndex) {
      currentQueueIndex--;
    }
  }
  updateQueueDisplay();
}

// Play specific queue item
async function playQueueItem(index) {
  if (changingSession) return;
  if (index < 0 || index >= mediaQueue.length) return;
  if (!mediaQueue[index].url) {
    queueRestore.hidden = false;
    queueRestore.open = true;
    queueRestoreStatus.textContent = "Use Restore queue or reselect this file to play it.";
    return;
  }

  saveCurrentPositionNow();
  resumeItemId = mediaQueue[index].id;
  cancelWaveformJob();
  const job = { controller: new AbortController(), ff: null, audioCtx: null };
  waveformJob = job;
  currentWaveform = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  currentQueueIndex = index;
  const item = mediaQueue[index];

  updateQueueDisplay();

  // Load media and restore any cookie-saved playback position for this filename.
  const player = await loadMedia(item.url, item.isAudio, item.name);

  if (waveformJob !== job) return;
  updateMediaSession();
  await renderWaveformForItem(item, job);
}

// Play next in queue
function playNext() {
  const nextIndex = mediaQueue.findIndex((item, index) => index > currentQueueIndex && item.url);
  if (nextIndex >= 0) {
    playQueueItem(nextIndex);
  } else if (repeatMode === "playlist") {
    const firstIndex = mediaQueue.findIndex((item) => item.url);
    if (firstIndex >= 0) playQueueItem(firstIndex);
  }
}

// Play previous in queue
function playPrevious() {
  for (let index = currentQueueIndex - 1; index >= 0; index--) {
    if (mediaQueue[index].url) { playQueueItem(index); break; }
  }
}

function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;

  const item =
    currentQueueIndex >= 0 ? mediaQueue[currentQueueIndex] : null;
  if (!item) {
    navigator.mediaSession.metadata = null;
    return;
  }

  navigator.mediaSession.metadata = new MediaMetadata({
    title: item.name,
  });

  const player = videoPlayer.hidden ? audioPlayer : videoPlayer;
  navigator.mediaSession.playbackState = player.paused
    ? "paused"
    : "playing";
}

function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;

  navigator.mediaSession.setActionHandler("nexttrack", () => {
    playNext();
  });
  navigator.mediaSession.setActionHandler("previoustrack", () => {
    playPrevious();
  });
}

setupMediaSession();

function updateRepeatButton() {
  const isActive = repeatMode !== "none";
  repeatButton.dataset.repeatMode = repeatMode;
  repeatButton.classList.toggle("active", isActive);
  repeatButton.setAttribute("aria-pressed", String(isActive));
  repeatButton.setAttribute("aria-label", REPEAT_LABELS[repeatMode]);
  repeatButton.title = REPEAT_TITLES[repeatMode];
}

function cycleRepeatMode() {
  const currentIndex = REPEAT_MODES.indexOf(repeatMode);
  repeatMode = REPEAT_MODES[(currentIndex + 1) % REPEAT_MODES.length];
  updateRepeatButton();
}

function replayCurrentTrack() {
  const player = videoPlayer.hidden ? audioPlayer : videoPlayer;
  if (!player.src) return;

  player.currentTime = 0;
  player.play().catch((err) => {
    console.warn("Repeat playback blocked by browser:", err);
  });
}

function handleMediaEnded() {
  if (repeatMode === "track") {
    replayCurrentTrack();
    return;
  }

  playNext();
}

repeatButton.addEventListener("click", cycleRepeatMode);
updateRepeatButton();

// Just load/play media; no realtime analyzer
function loadMedia(url, isAudio, fileName) {
  currentMediaName = fileName;
  const savedTime = getSavedPosition(fileName);
  const player = isAudio ? audioPlayer : videoPlayer;
  const otherPlayer = isAudio ? videoPlayer : audioPlayer;

  otherPlayer.pause();
  otherPlayer.removeAttribute("src");
  otherPlayer.load();
  otherPlayer.hidden = true;
  otherPlayer.classList.remove("loaded-video");
  player.hidden = false;
  player.src = url;
  player.classList.remove("loaded-video");
  player.load();

  return new Promise((resolve) => {
    player.onloadedmetadata = () => {
      player.classList.toggle("loaded-video", !isAudio);
      player.playbackRate = currentPlaybackSpeed;

      if (savedTime > 0 && player.duration && savedTime < player.duration - 1) {
        player.currentTime = savedTime;
      }

      const queueIndex = mediaQueue.findIndex((q) => q.name === fileName);
      if (
        queueIndex >= 0 &&
        Number.isFinite(player.duration) &&
        player.duration > 0
      ) {
        mediaQueue[queueIndex].duration = player.duration;
        updateQueueDisplay();
      }

      player.focus(); // Focus so arrow keys work
      resolve(player);
    };

    player
      .play()
      .catch((err) =>
        console.warn(`${isAudio ? "Audio" : "Video"} play blocked by browser:`, err)
      );
  });
}

// Handle media ended event based on repeat mode
videoPlayer.addEventListener("ended", handleMediaEnded);
audioPlayer.addEventListener("ended", handleMediaEnded);

[videoPlayer, audioPlayer].forEach((player) => {
  player.addEventListener("timeupdate", schedulePositionSave);
  player.addEventListener("pause", () => {
    saveCurrentPositionNow();
    updateMediaSession();
  });
  player.addEventListener("play", updateMediaSession);
  player.addEventListener("seeked", saveCurrentPositionNow);
});
window.addEventListener("beforeunload", saveCurrentPositionNow);

// Force refocus after any seek to ensure arrow keys work
videoPlayer.addEventListener("seeked", function() {
  setTimeout(() => {
    videoPlayer.focus();
  }, 0);
});
audioPlayer.addEventListener("seeked", function() {
  setTimeout(() => {
    audioPlayer.focus();
  }, 0);
});

function handleQueueSkipKey(e) {
  if (e.key === "MediaTrackNext") {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    playNext();
    return true;
  }
  if (e.key === "MediaTrackPrevious") {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    playPrevious();
    return true;
  }
  return false;
}

// Try window-level capture as absolute first line of defense
window.addEventListener("keydown", function(e) {
  if (handleQueueSkipKey(e)) return false;

  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const player = videoPlayer.hidden ? audioPlayer : videoPlayer;

    // If player is playing or has focus, intercept
    if ((document.activeElement === videoPlayer || document.activeElement === audioPlayer) ||
        (player.duration && !player.paused)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (!player.duration) return;

      if (e.key === "ArrowRight") {
        player.currentTime = Math.min(player.currentTime + 2, player.duration);
      } else {
        player.currentTime = Math.max(player.currentTime - 2, 0);
      }
      return false;
    }
  }
}, true);

// Also add document-level capture to block any browser defaults
document.addEventListener("keydown", function(e) {
  if (handleQueueSkipKey(e)) return;

  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const activeElement = document.activeElement;
    const player = videoPlayer.hidden ? audioPlayer : videoPlayer;

    // Handle arrow keys if media player has focus OR if it's playing
    if (activeElement === videoPlayer || activeElement === audioPlayer ||
        (player.duration && !player.paused)) {
      e.preventDefault();
      e.stopImmediatePropagation();

      if (!player.duration) return;

      if (e.key === "ArrowRight") {
        player.currentTime = Math.min(player.currentTime + 2, player.duration);
      } else {
        player.currentTime = Math.max(player.currentTime - 2, 0);
      }

      // Ensure player has focus for consistent behavior
      player.focus();
    }
  }
}, true);


function isFileDrag(e) {
  return Array.from(e.dataTransfer?.types || []).includes("Files");
}

const supportedMediaExtensions = new Set([".3gp", ".3gpp", ".3g2"]);
const audioFallbackExtensions = new Set([".3gp", ".3gpp", ".3g2"]);

function getFileExtension(fileName) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

function isSupportedMediaFile(file) {
  return (
    file.type.startsWith("audio/") ||
    file.type.startsWith("video/") ||
    supportedMediaExtensions.has(getFileExtension(file.name))
  );
}

function shouldUseAudioPlayer(file) {
  if (file.type.startsWith("audio/")) return true;
  if (file.type.startsWith("video/")) return false;
  return audioFallbackExtensions.has(getFileExtension(file.name));
}

async function addFilesToQueue(files, sourceLabel, handles = [], relinkOnly = false) {
  if (!queueReady || changingSession) return;
  const mediaFiles = files.filter(isSupportedMediaFile);
  if (mediaFiles.length === 0) return;
  // Adding a fresh batch must not merge it into an unrestored queue.
  // Reselect files explicitly reconnects the current saved session instead.
  if (!relinkOnly && mediaQueue.length && mediaQueue.every(item => !item.url)) {
    await startNewSession();
    sessionStatus.textContent = "Previous queue saved separately. Started a new queue.";
  }

  // Add files to queue
  mediaFiles.forEach((file) => {
    const handle = handles[files.indexOf(file)] || null;
    const missing = mediaQueue.find((item) => !item.url && sameQueueFile(item, file));
    if (missing) { attachQueueFile(missing, file, handle); return; }
    if (relinkOnly) return;
    const url = URL.createObjectURL(file);
    const isAudio = shouldUseAudioPlayer(file);
    console.log(ts(), `[${sourceLabel}] Added to queue:`,
      file.name, "size:", file.size, "type:", file.type,
      "isAudio:", isAudio, "blob URL:", url);

    const queueItem = {
      id: crypto.randomUUID(),
      size: file.size,
      lastModified: file.lastModified,
      handle,
      file: file,
      url: url,
      isAudio: isAudio,
      name: file.name,
      duration: getStoredDuration(file.name),
    };
    mediaQueue.push(queueItem);

    if (queueItem.duration == null) {
      probeMediaDuration(url, isAudio).then((duration) => {
        if (
          duration != null &&
          mediaQueue.includes(queueItem)
        ) {
          queueItem.duration = duration;
          updateQueueDisplay();
        }
      });
    }
  });

  updateQueueDisplay();

  resumeRestoredQueue();
}

fileInput.addEventListener("change", function () {
  const files = Array.from(this.files);
  if (files.length === 0) return;

  addFilesToQueue(files, "fileInput", [], relinkingFiles);
  relinkingFiles = false;

  // Clear file input so same files can be added again
  this.value = "";
});

fileInput.addEventListener("cancel", () => { relinkingFiles = false; });

reverseQueueButton.addEventListener("click", function () {
  if (mediaQueue.length < 2) return;
  const playingItem = mediaQueue[currentQueueIndex];
  mediaQueue.reverse();
  currentQueueIndex = playingItem ? mediaQueue.indexOf(playingItem) : -1;
  updateQueueDisplay();
  const firstIndex = mediaQueue.findIndex((item) => item.url);
  if (firstIndex >= 0) playQueueItem(firstIndex);
});

queueContainer.addEventListener("click", function (e) {
  if (e.target.closest(".queue-restore, .saved-queues")) return;
  if (e.target.closest(".queue-actions")) return;
  if (e.target.closest(".queue-item")) return;
  if (e.target.closest(".queue-controls")) return;
  chooseQueueFiles();
});

queueContainer.addEventListener("keydown", function (e) {
  if (e.target !== queueContainer) return;
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  chooseQueueFiles();
});

document.addEventListener("dragover", function (e) {
  if (!isFileDrag(e)) return;

  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});

document.addEventListener("drop", async function (e) {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  if (!queueReady) return;
  // Capture handles before yielding: the drag data is only valid in this event.
  const entries = Array.from(e.dataTransfer.items || []).filter((item) => item.kind === "file").map((item) => {
    const file = item.getAsFile();
    let handle;
    try { handle = item.getAsFileSystemHandle?.(); } catch (_) {}
    return { file, handle };
  }).filter((entry) => entry.file);
  const handles = await Promise.all(entries.map((entry) => Promise.resolve(entry.handle).catch(() => null)));
  addFilesToQueue(entries.map((entry) => entry.file), "fileDrop", handles.map((handle) => handle?.kind === "file" ? handle : null));
});

// Speed control
speedControl.addEventListener("input", function () {
  const val = parseFloat(this.value);
  if (!Number.isFinite(val) || val < 0.1 || val > 100) return;

  currentPlaybackSpeed = val;
  savePlaybackSpeed();
  if (!videoPlayer.hidden) videoPlayer.playbackRate = val;
  if (!audioPlayer.hidden) audioPlayer.playbackRate = val;
});

// Click on waveform to seek
canvas.addEventListener("click", function (e) {
  const player = videoPlayer.hidden ? audioPlayer : videoPlayer;
  if (!player.duration) return; // No media loaded yet

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const percentage = x / rect.width;
  const newTime = percentage * player.duration;

  player.currentTime = Math.max(0, Math.min(newTime, player.duration));

  // Refocus the player so arrow keys work correctly
  player.focus();
});

// Keyboard shortcuts
window.addEventListener("keydown", function (e) {
  const tag = document.activeElement.tagName.toLowerCase();
  if (["input", "textarea", "select", "button", "summary"].includes(tag) || document.activeElement.isContentEditable) return;

  const player = videoPlayer.hidden ? audioPlayer : videoPlayer;

  switch (e.key) {
    case "d":
    case "D":
      e.preventDefault();
      player.playbackRate = Math.min(player.playbackRate + 0.1, 100);
      currentPlaybackSpeed = player.playbackRate;
      savePlaybackSpeed();
      break;
    case "s":
    case "S":
      e.preventDefault();
      player.playbackRate = Math.max(player.playbackRate - 0.1, 0.1);
      currentPlaybackSpeed = player.playbackRate;
      savePlaybackSpeed();
      break;
    case "ArrowRight":
      e.preventDefault();
      player.currentTime = Math.min(
        player.currentTime + 2,
        player.duration || player.currentTime + 2
      );
      break;
    case "ArrowLeft":
      e.preventDefault();
      player.currentTime = Math.max(player.currentTime - 2, 0);
      break;
    case " ":
    case "Spacebar":
      e.preventDefault();
      if (player.paused) player.play();
      else player.pause();
      break;
    case "MediaTrackNext":
      e.preventDefault();
      playNext();
      break;
    case "MediaTrackPrevious":
      e.preventDefault();
      playPrevious();
      break;
    default:
      return;
  }

  try {
    speedControl.value = currentPlaybackSpeed.toFixed(1);
  } catch (err) {
    console.warn(
      "Cannot update speed indicator: video controller UI not fully initialized"
    );
  }
});
fileInput.disabled = true;
loadSavedQueue();
