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
- **Persistent Across Files**: Speed setting is maintained when the queue advances to the next file and restored after reload or reopening. Changes from the controller and keyboard shortcuts are saved locally per URL path
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
- **Independent Tabs**: Saving progress never seeks playback in another tab. Future loads use the most recently saved position.
- **Auto-Expiry**: Entries not updated in 7+ days are pruned automatically on read. Legacy entries receive a timestamp on their first read and expire seven days later unless playback updates them.
- **Clear on Remove**: Removing a file from the queue deletes its saved position

## Usage

### Getting Started

1. Open `index.html` in any modern web browser
2. Click "Choose File" to select one or more audio or video files, or drag and drop files onto the page
3. Playback begins automatically and the waveform is generated
4. If you loaded a video, the waveform generates in the background via ffmpeg.wasm

### Live Website with Offline Fallback

When served over HTTPS (or localhost), the player saves the page and all FFmpeg files for offline use. Keep the first visit open while the initial ~30MB download finishes. Opening `index.html` directly as a local file does not enable offline website caching.

Subsequent requests try the live website first and refresh the saved copy when successful. If the connection fails, the server returns an error, or a request takes longer than eight seconds, the player uses its cached copy when available. Both the site root and `index.html` use the same saved page.

Once the service worker has installed successfully, you can reopen the same URL offline and select local audio or video files, including generating video waveforms. The queue is saved separately in browser storage. After reopening, click **Restore queue** to reopen files with saved access, or **Reselect files** to reconnect the originals. Media file contents are not copied into the website cache. Clearing browser site data also clears the offline copy.

To check: visit the hosted site online, wait for the service worker to activate, then disconnect from the network and reload the same URL. Reconnect and reload to use the live site again.

### Managing the Queue

- **View Queue**: All queued files are displayed below the controls
- **Full Filename**: Hover over any queue item to reveal the full filename in a popover
- **Jump to File**: Double-click any item to play it immediately
- **Reorder**: Drag and drop items to change play order
- **Reverse Order**: Click the opposing arrows beside “Queue” to reverse the queue and start playing the new first file.
- **Remove**: Click "Remove" to remove a file and clear its saved position
- **Add More**: Select additional files or drop them onto the page at any time to append them to the queue

### Restoring After Reload or Reopening

Each queue is saved as its own session, including file order, selected track, playback positions, and speed. Reloading a tab retains its session; a fresh tab starts empty. Expand **Saved queues** to restore an earlier session, rename it, or delete its saved state. Labels show the first filename (or your chosen name), file count, and last-used date.

Click **New queue** to save the current session and start another. Adding a new batch while the current queue is still completely unrestored also starts a separate session, preserving the old queue. Use **Reselect files** to reconnect the original queue instead. Adding files to a queue that already has accessible files appends them to that session.

Restoring a session that is not open elsewhere continues that session. Restoring a session already open in another tab, or duplicating that tab, creates an independent copy. File order, positions, and speed then save separately. The browser may request file access again, and playback may require pressing Play. Without browser support for tab coordination, restoring a saved session always makes a copy; deleting saved queues requires tab coordination support.

Files added with the modern chooser or supported drag and drop retain handles. Other browsers and the standard file input save queue metadata only: use **Reselect files** to select the original files again. Matching uses filename, size, and last modification time; selection order does not change the saved queue order. Unavailable files appear under a collapsed **Saved files to restore** chevron, with a count. Expand it to restore, reselect, or remove files. Files ready for playback stay visible in the main queue, and playback skips unavailable entries. Each tab controls its own expanded/collapsed view. Moved, deleted, or replaced files may need to be reselected or removed and added again.

Only file references and queue metadata are saved, not full media contents. Clearing site data removes the saved queue and access. Queue storage is separate for each URL path. Each session has its own storage key, so saving one queue does not overwrite another. Deleting a saved queue does not delete media files, and queues open in other tabs cannot be deleted until those tabs close.

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

Waveforms retain only 4096 amplitude bins (16 KiB) for drawing and resizing. Temporary audio is decoded at 8 kHz and released after summarizing. Each video extraction worker is terminated after use to release its WebAssembly memory and virtual filesystem. Switching tracks cancels obsolete waveform jobs; removing files revokes their blob URLs.

### Arrow Key Seeking Fix

Browsers' native media controls handle arrow keys at a lower level than JavaScript events, defaulting to ~2-minute jumps. This is overridden using window-level `capture` event listeners with `stopImmediatePropagation()`, combined with forced refocus of the media element after every seek.

### Playback Position Storage

Positions are stored as JSON keyed by filename in `localStorage`. On read, entries with an `updatedAt` older than 7 days are pruned. Legacy numeric positions and objects without a timestamp receive a one-time migration timestamp, persisted immediately; they then expire normally. Saved positions are applied only when loading a file. Updates from other tabs never seek an already loaded recording, including while paused. Saved sessions keep their own position for each queued file. The shared filename-based store supplies a default resume position for newly selected files that do not yet have a session-specific position.

### Source Layout and Tests

- `index.html`: player markup and script loading order.
- `styles.css`: layout and appearance.
- `app.js`: playback, waveforms, queue persistence, and UI events.
- `position-store.js`: pure position validation, migration, and expiry rules.
- `queue-sessions.js`: separate session records, tab ownership, copying, and deletion.
- `coi-serviceworker.js`: offline caching and cross-origin isolation headers.

Deployment remains build-free: serve these files together with `vendor/`. Run automated checks with `node --test tests/*.test.cjs`. Tests cover position expiry and migration, independent playback across tabs, session ownership and copying, queue restoration, and offline asset coverage.

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
