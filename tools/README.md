# FrameForge - Web-based Video Editor

A powerful, web-based video editing tool built with React, TypeScript, and modern web technologies.

## Features

### ✨ Core Features
- **Asset Management**: Import videos, images, and audio files via drag-and-drop or file dialog
- **Multi-layer Timeline**: Separate video and audio tracks with drag-and-drop functionality
- **Real-time Preview**: Live canvas preview with transform controls
- **Keyframe Animation**: Animate position, rotation, scale, and opacity properties
- **Frame Capture**: Extract precise frames from video clips with automatic PNG export and clipboard copy
- **Frame Sequence Export**: Export all frames from selected clip as sequential PNG files to chosen folder
- **PNG Flipbook Viewer**: Load, preview, and organize PNG sequences with playback controls and batch copy functionality
- **Project Save/Load**: JSON-based project format (.vproj)

### 📁 Supported Formats
- **Video**: .mp4, .webm
- **Audio**: .mp3, .wav, .ogg  
- **Images**: .jpg, .png, .webp, .gif

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open browser to http://localhost:3000
```

## Usage

### 1. Import Media Files
- Click "Import" button in the toolbar
- Select multiple video, audio, or image files
- Files appear in the Assets panel on the left

### 2. Add Media to Timeline
- Double-click any asset in the Assets panel to add it to the timeline
- Videos and images go to video tracks
- Audio files go to audio tracks

### 3. Edit Timeline
- **Drag clips**: Click and drag clips to reposition them
- **Select clips**: Click on a clip to select it
- **Delete clips**: Double-click a clip or click the × button when selected
- **Playback controls**: Use play/pause/stop buttons and scrub bar

### 4. Preview
- The canvas shows a live preview of your timeline
- Playhead position reflects current timeline time
- Videos and images render with proper layering

### 5. Frame Capture
- **Select a video clip** on the timeline
- **Press "I"** or use the capture tool to extract the current frame
- **Automatic save**: Frame is saved as PNG with timestamp
- **Clipboard copy**: Frame is copied for immediate pasting elsewhere
- **Asset integration**: Captured frame becomes a new project asset

### 6. Frame Sequence Export
- **Select a video clip** on the timeline
- **Press "Shift+I"** or use the export frames tool
- **Choose destination**: Folder selection dialog opens
- **Automatic export**: All frames saved as sequential PNG files
- **Smart naming**: Files named like "ClipName_frame_001.png", "ClipName_frame_002.png", etc.
- **Preserves timing**: Respects clip speed, reverse, and trim settings

### 7. PNG Flipbook Viewer
- **Open Viewer**: Click "🎞️ PNG Flipbook" in the toolbar
- **Load Images**: Drag-and-drop PNG files or click "Choose Files" to browse
- **Select Output Folder**: Click "📁 Select Output Folder" to choose destination for copying
- **Select Images**: Click individual thumbnails or use "Select All"/"Clear" buttons
- **Adjust Thumbnails**: Use the size slider to make thumbnails larger or smaller (30px-100px)
- **Preview Flipbook**: Select images and click play to see animation
- **Copy Images**: Click "📋 Copy Images" to copy selected PNGs to output folder
- **Playback Controls**: Adjust FPS (1-60), enable/disable loop, scrub through frames

### 8. Project Management
- **Save**: Click "Save" to download your project as a .vproj file
- **Load**: Click "Load" to open a previously saved project

## Keyboard Shortcuts

- **Space**: Play/Pause
- **Delete**: Delete selected clip
- **Home**: Go to beginning
- **End**: Go to end
- **I**: Capture frame from selected video clip (saves PNG + copies to clipboard)
- **Shift+I**: Export all frames from selected video clip to chosen folder
- **S**: Split clip at playhead
- **Ctrl+C**: Copy selected clips
- **Ctrl+V**: Paste clips

## Technical Architecture

### Tech Stack
- **React 18** with TypeScript
- **Zustand** for state management
- **Vite** for build tooling
- **HTML5 Canvas** for video rendering
- **Web APIs**: File API, URL.createObjectURL

### Project Structure
```
src/
├── components/          # React components
│   ├── Toolbar.tsx     # Import, save/load, controls
│   ├── AssetBrowser.tsx # File browser sidebar
│   ├── Canvas.tsx      # Video preview canvas
│   └── Timeline.tsx    # Multi-track timeline
├── store/              # Zustand state management
├── types/              # TypeScript definitions
└── App.tsx            # Main application
```

### File Format (.vproj)
Projects are saved as JSON files containing:
```json
{
  "assets": [...],           // Media file references
  "timeline": {
    "tracks": [...],         // Timeline tracks and clips
    "currentTime": 0,        // Playhead position
    "duration": 30           // Project duration
  },
  "canvasWidth": 1920,      // Output resolution
  "canvasHeight": 1080
}
```

## Planned Features

### 🚀 Coming Soon
- **Transform Handles**: Visual resize/rotate controls on canvas
- **Keyframe Editor**: Visual keyframe curve editing
- **Export**: Render to MP4/WebM format
- **Effects**: Filters, transitions, color grading
- **Audio Editing**: Waveform display, volume automation
- **Undo/Redo**: Complete action history

### 🎯 Advanced Features
- **Nested Compositions**: Precomps and grouping
- **Text Overlays**: Title and subtitle tools
- **Multi-camera Editing**: Sync and switch angles
- **WebRTC Integration**: Collaborative editing

## Development

### Adding New Features

1. **Types**: Add interfaces to `src/types/index.ts`
2. **State**: Extend the Zustand store in `src/store/index.ts`
3. **Components**: Create React components in `src/components/`
4. **Styling**: Add CSS classes to `src/index.css`

### Performance Optimization
- Canvas rendering is optimized for 30fps playback
- Large video files are handled via object URLs
- Timeline scrubbing uses RAF for smooth updates

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

Requires modern ES2020 features and Canvas 2D API.

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit changes: `git commit -am 'Add feature'`
4. Push to branch: `git push origin feature-name`
5. Submit a pull request

## License

MIT License - see LICENSE file for details. 