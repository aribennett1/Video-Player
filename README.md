# Advanced Media Player

A modern, feature-rich HTML5 media player that supports both audio and video playback with advanced controls and visualizations. Runs entirely in the browser — no server required.

## Features

### 🎵 Universal Media Support

- **Video Playback**: Supports all browser-compatible video formats (MP4, WebM, MKV, MOV, etc.)
- **Audio Playback**: Supports all browser-compatible audio formats (MP3, WAV, OGG, AAC, etc.)
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
- **Sequential Playback**: Automatically plays the next file when the current one ends
- **Double-Click to Jump**: Double-click any queue item to start playing it immediately; queue continues from that point
- **Drag & Drop Reordering**: Drag any queue item to reorder the playlist
- **Remove from Queue**: Click the "Remove" button to remove a file — also clears its saved position
- **Dynamic Queue**: Add more files at any time without interrupting playback
- **Currently Playing Indicator**: Active file is highlighted in blue

### 💾 Playback Position Memory

- **Persistent Resume**: The timestamp you were at is saved per filename and restored when you reload the same file
- **Cross-Tab**: Positions are stored in both a cookie and localStorage — accessible across tabs and browser sessions
- **Auto-Save**: Position is saved every ~5 seconds during playback, on pause, on seek, and on page close
- **Storage Management**: Cookie entries are sorted by most-recently-used and pruned if storage limits are approached
- **Clear on Remove**: Removing a file from the queue also deletes its saved position

## Usage

### Getting Started

1. Open `index.html` in any modern web browser
2. Click "Choose File" to select one or more audio or video files
3. Playback begins automatically and the waveform is generated
4. If you loaded a video, the waveform generates in the background via ffmpeg.wasm (first load requires a ~30MB one-time download, cached after that)

### Managing the Queue

- **View Queue**: All queued files are displayed below the controls
- **Jump to File**: Double-click any item to play it immediately
- **Reorder**: Drag and drop items to change play order
- **Remove**: Click "Remove" to remove a file and clear its saved position
- **Add More**: Select additional files at any time to append them to the queue

### Controlling Playback

- **Play/Pause**: Native player controls or `Space`
- **Seek**: Click the waveform, or use the native scrubber
- **Skip 2 seconds**: Arrow keys (works even after manually seeking)
- **Speed**: Number input field or `D`/`S` keys

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

Positions are stored as JSON keyed by filename in both a cookie (`max-age` 1 year) and `localStorage`. On read, the cookie is checked first with localStorage as fallback. The cookie is kept under 3.5KB by pruning the oldest entries when needed.

## Browser Compatibility

- Chrome/Edge (recommended)
- Firefox
- Safari 14.1+
- Any modern browser with Web Audio API support

## Dependencies

| Library | Version | Purpose |
|---|---|---|
| `@ffmpeg/ffmpeg` | 0.12.10 | ffmpeg.wasm browser wrapper |
| `@ffmpeg/util` | 0.12.1 | `fetchFile` / `toBlobURL` helpers |
| `@ffmpeg/core` | 0.12.6 | Single-threaded wasm core (no COOP/COEP headers required) |

Loaded from [unpkg.com](https://unpkg.com) CDN. No build step or npm install required.

## License

Free to use and modify for personal or commercial projects.
