# Advanced Media Player

A modern, feature-rich HTML5 media player that supports both audio and video playback with advanced controls and visualizations.

## Features

### 🎵 Universal Media Support

- **Video Playback**: Supports all browser-compatible video formats (MP4, WebM, etc.)
- **Audio Playback**: Supports all browser-compatible audio formats (MP3, WAV, OGG, etc.)
- Automatic format detection and appropriate player selection

### ⚡ Speed Control

- **Variable Playback Speed**: Adjust from 0.1x to 100x speed
- **Manual Input**: Direct speed entry via number input field
- **Keyboard Shortcuts**: Quick speed adjustments using hotkeys
  - Press `D` to increase speed by 0.1x
  - Press `S` to decrease speed by 0.1x
- Real-time speed display updates

### 📊 Waveform Visualization

- **Full-Length Waveform**: Visual representation of the entire audio track
- **Progress Overlay**: Real-time visual indicator showing current playback position on the waveform
- **Interactive Seeking**: Click anywhere on the waveform to jump to that timestamp
- **Auto-Generated**: Automatically creates waveform for any loaded media file
- Works for both video (audio track) and audio files

### ⌨️ Keyboard Shortcuts

- `D` - Increase playback speed by 0.1x
- `S` - Slow down playback speed by 0.1x
- `→` (Right Arrow) - Skip forward 2 seconds
- `←` (Left Arrow) - Skip backward 2 seconds
- `Space` - Play/Pause toggle

### 🎨 User Interface

- **Dark Theme**: Easy on the eyes with black background and sleek design
- **Responsive Design**: Adapts to different screen sizes
- **Clean Layout**: Minimalist interface focusing on functionality
- **Visual Feedback**: Blue waveform bars for clear visualization

### 📋 Queue System

- **Multiple File Selection**: Select multiple audio/video files at once
- **Sequential Playback**: Automatically plays the next file when the current one ends
- **Queue Management**: View all queued files with visual indicator of currently playing item
- **Drag & Drop Reordering**: Click and drag any queue item to reorder the playlist
- **Remove from Queue**: Remove any file from the queue with a single click
- **Dynamic Queue**: Add more files to the queue at any time without interrupting playback
- **Persistent Speed**: Playback speed is maintained across all files in the queue

## Usage

### Getting Started

1. Open `Advanced Media Player.html` in any modern web browser
2. Click "Choose File" to select a video or audio file
3. The media will automatically load and begin playing
4. The waveform will be generated and displayed

### Loading Media

- Click the file input button at the top of the player
- Select one or multiple audio/video files from your computer (hold Ctrl/Cmd or Shift to select multiple)
- Files will be added to the queue and playback will start automatically
- Supported formats depend on your browser (common formats like MP4, MP3, WAV, etc.)

### Managing the Queue

- **View Queue**: All queued files are displayed below the controls
- **Current Item**: The currently playing file is highlighted in blue
- **Jump to File**: Double-click any queue item to start playing it immediately (queue continues from that point)
- **Reorder Items**: Click and drag any queue item to move it to a different position
  - A blue line appears to show where the item will be dropped
  - The currently playing item can also be reordered
- **Remove Items**: Click the "Remove" button next to any file to remove it from the queue
- **Add More Files**: Select additional files at any time to add them to the queue
- **Auto-Play**: When a file finishes, the next one in the queue automatically starts

### Controlling Playback

- **Play/Pause**: Use the native player controls or press `Space`
- **Seek**: Click on the waveform or use the native player scrubber
- **Speed**: Use the number input or press `D`/`S` to adjust

### Speed Control

- Enter a specific speed value in the "Speed" input field
- Or use keyboard shortcuts for incremental adjustments
- Speed range: 0.1x (very slow) to 100x (very fast)

### Navigation

- **Quick Skip**: Use arrow keys to skip forward/backward 2 seconds
- **Precise Seek**: Click on the waveform to jump to exact positions
- **Visual Reference**: Use the waveform to identify sections of the media

## Technical Requirements

### Browser Compatibility

- Chrome/Edge 14+
- Firefox 25+
- Safari 14.1+
- Any modern browser with HTML5 audio/video and Web Audio API support

### Dependencies

- None! Pure HTML5, CSS3, and vanilla JavaScript
- No external libraries or frameworks required

## How It Works

### Waveform Generation

1. The entire audio file is decoded using the Web Audio API
2. Audio samples are processed and averaged into blocks
3. Each pixel of the canvas represents a block of audio samples
4. Absolute amplitude values are calculated for visual representation
5. The waveform is rendered as vertical bars centered on the canvas

### Audio Context

- Creates an AudioContext for audio processing
- Decodes audio data from uploaded files
- Processes the first channel (mono representation)
- Does not use real-time analysis for performance optimization

## License

Free to use and modify for personal or commercial projects.

## Credits

Built with pure HTML5, CSS3, and JavaScript using the Web Audio API.
