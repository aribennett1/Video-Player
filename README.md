# Advanced Media Player

A modern, feature-rich HTML5 media player that supports both audio and video playback with advanced controls and visualizations. Runs entirely in the browser — no server required.

## Features

### 🎵 Universal Media Support

- **Video Playback**: Supports all browser-compatible video formats (MP4, WebM, MKV, MOV, 3GP, etc.)
- **Audio Playback**: Supports all browser-compatible audio formats (MP3, WAV, OGG, AAC, 3GP/3GPP, etc.)
- Automatic format detection and appropriate player selection

### ⚡ Speed Control

- **Variable Playback Speed**: Adjust from 0.1x to 100x speed
- **Manual Input**: Direct speed entry via number input field
- **Persistent Across Files**: Speed setting is maintained when the queue advances to the next file
- **Keyboard Shortcuts**: Quick speed adjustments using hotkeys
  - Press `D` to increase speed by 0.1x
  - Press `S` to decrease speed by 0.1x

### 📊 Waveform Visualization

- **Full-Length Waveform**: Accurate amplitude visualization of the entire audio track
- **Progress Overlay**: Real-time blue tint + white line showing current playback position
- **Interactive Seeking**: Click anywhere on the waveform to jump to that timestamp
- **Video Support via ffmpeg.wasm**: For video files, audio is extracted at 8kbps/8kHz mono using ffmpeg running entirely in the browser — enabling accurate waveforms for videos of any length
- **Loading State**: "Generating waveform…" indicator shown while ffmpeg processes a video
- **Graceful Fallback**: Shows a flat placeholder bar if waveform generation fails

### ⌨️ Keyboard Shortcuts

- `D` — Increase playback speed by 0.1x
- `S` — Decrease playback speed by 0.1x
- `→` (Right Arrow) — Skip forward 2 seconds
- `←` (Left Arrow) — Skip backward 2 seconds
- `Space` — Play/Pause toggle

### 📋 Queue System

- **Multiple File Selection**: Select multiple audio/video files at once (hold Ctrl/Cmd or Shift)
- **Page Drop Uploads**: Drag and drop audio/video files onto the page to add them to the queue
- **Sequential Playback**: Automatically plays the next file when the current one ends
- **Repeat Modes**: Click the repeat button once to repeat the playlist, twice to repeat the current track, and a third time to turn repeat off
- **Double-Click to Jump**: Double-click any queue item to start playing it immediately; queue continues from that point
- **Drag & Drop Reordering**: Drag any queue item to reorder the playlist
- **Remove from Queue**: Click the "Remove" button to remove a file — also clears its saved position
- **Dynamic Queue**: Add more files at any time without interrupting playback
- **Currently Playing Indicator**: Active file is highlighted in blue
- **Full Name on Hover**: Hover a queue item to see the complete filename in a popover (useful when names are truncated)

### 💾 Playback Position Memory

- **Persistent Resume**: The timestamp you were at is saved per filename and restored when you reload the same file
- **Cross-Tab**: Positions are stored in `localStorage` and sync across tabs via the `storage` event
- **Auto-Expiry**: Entries not updated in 7+ days are pruned automatically on read
- **Clear on Remove**: Removing a file from the queue deletes its saved position

## Usage

### Getting Started

1. Open `index.html` in any modern web browser
2. Click "Choose File" to select one or more audio or video files, or drag and drop files onto the page
3. Playback begins automatically and the waveform is generated
4. If you loaded a video, the waveform generates in the background via ffmpeg.wasm (first load requires a ~30MB one-time download, cached after that)

### Managing the Queue

- **View Queue**: All queued files are displayed below the controls
- **Full Filename**: Hover over any queue item to reveal the full filename in a popover
- **Jump to File**: Double-click any item to play it immediately
- **Reorder**: Drag and drop items to change play order
- **Remove**: Click "Remove" to remove a file and clear its saved position
- **Add More**: Select additional files or drop them onto the page at any time to append them to the queue

### Controlling Playback

- **Play/Pause**: Native player controls or `Space`
- **Seek**: Click the waveform, or use the native scrubber
- **Skip 2 seconds**: Arrow keys (works even after manually seeking)
- **Speed**: Number input field or `D`/`S` keys
- **Repeat**: Button cycles through playlist repeat, track repeat, and off

## Technical Details

### Waveform Generation

| File type | Method |
|---|---|
| Audio (MP3, WAV, etc.) | `file.arrayBuffer()` → Web Audio API `decodeAudioData` |
| Video (MP4, MOV, etc.) | ffmpeg.wasm strips audio to 8kbps/8kHz mono MP3 → Web Audio API |

The ffmpeg.wasm instance is a lazy singleton — it loads once on the first video file and is reused for all subsequent videos in the session.

### Arrow Key Seeking Fix

Browsers' native media controls handle arrow keys at a lower level than JavaScript events, defaulting to ~2-minute jumps. This is overridden using window-level `capture` event listeners with `stopImmediatePropagation()`, combined with forced refocus of the media element after every seek.

### Playback Position Storage

Positions are stored as JSON keyed by filename in `localStorage`. On read, entries with an `updatedAt` older than 7 days are pruned. Other tabs receive updates via the browser `storage` event and apply the saved seek position for the currently playing file.

## Browser Compatibility

- Chrome/Edge (recommended)
- Firefox
- Safari 14.1+
- Any modern browser with Web Audio API support

## Dependencies

| Library | Version | Purpose |
|---|---|---|
| `@ffmpeg/ffmpeg` | 0.12.10 | Self-hosted in `vendor/ffmpeg/` (`ffmpeg.js`, `814.ffmpeg.js`) |
| `@ffmpeg/core` | 0.12.6 | Self-hosted in `vendor/ffmpeg/` (`ffmpeg-core.js`, `ffmpeg-core.wasm`) |
| `coi-serviceworker` | — | Bundled in repo; enables `SharedArrayBuffer` on GitHub Pages |

All ffmpeg.wasm files are **self-hosted** from `vendor/ffmpeg/` so Workers load same-origin on GitHub Pages (no unpkg / cross-origin Worker errors).

> **Large video files:** Video is mounted via **WORKERFS** so ffmpeg reads the file in chunks without copying the entire video into memory. Audio is extracted to a tiny 8kHz mono MP3, then decoded with Web Audio API for the waveform.

No build step or npm install required — ffmpeg binaries are committed in `vendor/ffmpeg/`.

## License

Free to use and modify for personal or commercial projects.
