# FrameForge Video Editor - Technical Specification

## Project Overview

**FrameForge** is a modern, web-based video editing application built with React, TypeScript, and advanced web technologies. It provides a comprehensive video editing experience with multi-track timeline editing, real-time preview, keyframe animation, and AI-powered editing assistance.

---

## 🏗️ Architecture & Tech Stack

### Core Technologies
- **Frontend Framework**: React 18 with TypeScript
- **State Management**: Zustand (lightweight alternative to Redux)
- **Build Tool**: Vite 4.5+
- **Canvas Rendering**: HTML5 Canvas + Fabric.js 5.3+
- **AI Integration**: OpenAI API 5.8+
- **Styling**: CSS3 with modern features

### Key Dependencies
```json
{
  "fabric": "^5.3.0",      // Canvas manipulation & transforms
  "openai": "^5.8.2",      // AI-powered editing
  "react": "^18.2.0",      // UI framework
  "react-dom": "^18.2.0",  // DOM rendering
  "uuid": "^9.0.1",        // Unique ID generation
  "zustand": "^4.4.7"      // State management
}
```

---

## 📁 Project Structure

```
src/
├── components/              # React UI Components
│   ├── AIChatBox.tsx       # AI assistant interface
│   ├── AssetBrowser.tsx    # Media file browser
│   ├── AssetPreview.tsx    # Asset preview component
│   ├── Canvas.tsx          # Video preview & transform controls
│   ├── Timeline.tsx        # Multi-track timeline editor
│   └── Toolbar.tsx         # Main toolbar with controls
├── ai/
│   └── aiInterpreter.ts    # OpenAI integration for editing
├── store/
│   └── index.ts            # Zustand state management
├── types/
│   └── index.ts            # TypeScript type definitions
├── utils/
│   ├── easing.ts           # Keyframe easing functions
│   ├── thumbnails.ts       # Media thumbnail generation
│   └── waveform.ts         # Audio waveform visualization
├── App.tsx                 # Main application component
├── main.tsx               # Application entry point
└── index.css              # Global styles
```

---

## 🎯 Core Features

### 1. Asset Management System
- **Supported Formats**:
  - Video: `.mp4`, `.webm`
  - Audio: `.mp3`, `.wav`, `.ogg`
  - Images: `.jpg`, `.png`, `.webp`, `.gif`
- **Import Methods**:
  - Drag & drop interface
  - File dialog selection
  - Batch import support
- **Asset Processing**:
  - Automatic thumbnail generation
  - Audio waveform extraction
  - Metadata detection (duration, dimensions)
  - Separate audio track extraction from video files

### 2. Multi-Track Timeline Editor
- **Track Types**:
  - Video tracks (visual content)
  - Audio tracks (sound content)
- **Timeline Operations**:
  - Drag & drop clip positioning
  - Visual clip trimming with handles
  - Multi-clip selection with Ctrl+click
  - Copy/paste functionality
  - Clip splitting at playhead
  - Clip reversal
  - Video frame snapshot capture
- **Playback Controls**:
  - Play/pause/stop functionality
  - Frame-accurate seeking
  - Variable playback speed (0.1x - 4x)
  - Timeline zoom controls

### 3. Keyframe Animation System
- **Animatable Properties**:
  - **Position**: X/Y coordinates
  - **Rotation**: Degrees (-180° to 180°)
  - **Scale**: X/Y scale factors (0.1x to 5x)
  - **Opacity**: Transparency (0-1)
  - **Volume**: Audio level (0-1)
- **Easing Functions**:
  - Linear
  - Ease-in (quadratic)
  - Ease-out (quadratic)
  - Ease-in-out (quadratic)
- **Keyframe Management**:
  - Visual keyframe indicators
  - Time-based positioning
  - Interpolation between keyframes
  - Keyframe deletion and modification

### 4. Real-Time Canvas Preview
- **Rendering Features**:
  - Hardware-accelerated canvas rendering
  - Multi-layer composition
  - Real-time transform application
  - Responsive canvas scaling
- **Transform Controls**:
  - Visual transform handles
  - Mouse-based manipulation
  - Snap-to-grid functionality
  - Zoom and pan controls
- **Visual Feedback**:
  - Selection indicators
  - Keyframe position markers
  - Transform handle visibility

### 5. AI-Powered Editing Assistant
- **Natural Language Processing**:
  - Voice command input (Speech Recognition API)
  - Text-based editing commands
  - Contextual understanding of editing requests
- **AI Capabilities**:
  - Automated keyframe creation
  - Timeline manipulation
  - Property adjustments
  - Effect application
- **Example Commands**:
  ```
  "Make the first clip fade in over 2 seconds"
  "Slow down the music to half speed"
  "Move the video to the center and rotate it 45 degrees"
  "Lower the volume during the first 10 seconds"
  ```

### 6. Project Management
- **File Format**: JSON-based `.vproj` files
- **Project Structure**:
  ```typescript
  interface Project {
    id: string;
    name: string;
    assets: Asset[];
    timeline: Timeline;
    canvasWidth: number;
    canvasHeight: number;
    backgroundColor: string;
  }
  ```
- **Operations**:
  - Save/load projects
  - Export functionality
  - Undo/redo system (50-step history)
  - Auto-save capabilities

---

## 🔧 Technical Implementation

### State Management (Zustand)
```typescript
interface EditorState {
  // Core project data
  project: Project;
  selectedClipIds: string[];
  selectedAssetId: string | null;
  canvasSelectedClipId: string | null;
  
  // Playback state
  playback: PlaybackState;
  
  // UI state
  timelineZoom: number;
  canvasZoom: number;
  
  // History system
  history: HistorySnapshot[];
  historyIndex: number;
  
  // Actions for state manipulation
  // ... (50+ action methods)
}
```

### Data Types System
```typescript
// Core asset interface
interface Asset {
  id: string;
  type: 'video' | 'image' | 'audio';
  src: string;
  name: string;
  duration?: number;
  width?: number;
  height?: number;
  element?: HTMLVideoElement | HTMLImageElement | HTMLAudioElement;
  thumbnail?: string;
  waveform?: number[];
}

// Timeline clip with keyframes
interface Clip {
  id: string;
  assetId: string;
  start: number;
  duration: number;
  inPoint?: number;
  outPoint?: number;
  reversed?: boolean;
  playbackSpeed?: number;
  keyframes?: TransformKeyframes;
  audioKeyframes?: AudioKeyframes;
}

// Keyframe system
interface Keyframe {
  time: number;
  value: any;
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
}
```

### Canvas Rendering Pipeline
1. **Asset Loading**: HTML5 media elements
2. **Transform Calculation**: Keyframe interpolation with easing
3. **Layer Composition**: Z-index based rendering
4. **Real-time Updates**: RAF-based render loop
5. **User Interaction**: Mouse/touch event handling

### Audio Processing
- **Waveform Generation**: Web Audio API analysis
- **Multi-clip Synchronization**: Independent audio elements
- **Volume Automation**: Keyframe-based level control
- **Format Support**: Multiple codec compatibility

---

## 🎮 User Interface

### Main Layout
```
┌─────────────────────────────────────────┐
│              Toolbar                    │
├──────────┬──────────────────────────────┤
│  Asset   │                              │
│ Browser  │         Canvas               │
│          │       (Preview)              │
├──────────┼──────────────────────────────┤
│Properties│                              │
│  Panel   │        Timeline              │
│          │     (Multi-track)            │
└──────────┴──────────────────────────────┘
│           AI Chat Assistant             │
└─────────────────────────────────────────┘
```

### Keyboard Shortcuts
- **Space**: Play/Pause toggle
- **Home**: Jump to timeline start
- **Escape**: Pause playback
- **←/→ or ,/.**: Frame-by-frame navigation
- **I**: Take snapshot of selected video clip
- **S**: Split clip at playhead
- **Ctrl+C**: Copy clips
- **Ctrl+V**: Paste clips
- **Ctrl+Z**: Undo
- **Ctrl+Y**: Redo
- **Delete**: Remove selected clips

### Mouse Interactions
- **Canvas**: Click to select, drag to transform
- **Timeline**: Drag clips, trim with handles
- **Properties**: Real-time value editing
- **Waveform**: Visual audio representation

---

## 🚀 Export & Rendering

### Export Capabilities
- **Video Formats**: MP4, WebM
- **Quality Presets**: Low, Medium, High, Ultra
- **Custom Settings**: Bitrate, resolution, FPS
- **Progress Tracking**: Real-time export progress

### Rendering Pipeline
1. **Timeline Analysis**: Calculate effective clip durations
2. **Transform Application**: Apply keyframe animations
3. **Layer Composition**: Combine all tracks
4. **Audio Mixing**: Blend multiple audio sources
5. **Format Encoding**: Output to selected format

---

## 🔮 AI Integration

### OpenAI Integration
```typescript
// AI command processing
const interpretVideoEditCommand = async (
  command: string, 
  project: Project
): Promise<Project> => {
  // Natural language processing
  // Project modification
  // Return updated project
}
```

### AI Capabilities
- **Command Understanding**: Natural language parsing
- **Context Awareness**: Current project state analysis
- **Automated Editing**: Keyframe and timeline manipulation
- **Error Handling**: Graceful fallback for unsupported commands

---

## 📊 Performance Considerations

### Optimization Strategies
- **Canvas Rendering**: Efficient redraw cycles
- **Memory Management**: Proper asset cleanup
- **Timeline Scrubbing**: Throttled update rates
- **Large File Handling**: Object URL management
- **Keyframe Interpolation**: Optimized easing calculations

### Browser Compatibility
- **Minimum Requirements**:
  - Chrome 90+
  - Firefox 88+
  - Safari 14+
  - Edge 90+
- **Required APIs**:
  - HTML5 Canvas
  - Web Audio API
  - File API
  - Speech Recognition (optional)

---

## 🛠️ Development Workflow

### Getting Started
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Code Organization
- **Components**: Functional React components with hooks
- **State Management**: Centralized Zustand store
- **Type Safety**: Comprehensive TypeScript coverage
- **Error Handling**: Graceful error boundaries
- **Testing**: Unit and integration test support

---

## 🔄 Future Enhancements

### Planned Features
- **Advanced Effects**: Filters, transitions, color grading
- **Text Overlays**: Dynamic title and subtitle tools
- **Nested Compositions**: Precomps and grouping
- **Collaborative Editing**: Real-time multi-user support
- **Cloud Integration**: Online asset storage
- **Performance Analytics**: Render time optimization
- **Mobile Support**: Touch-optimized interface

### Technical Improvements
- **WebGL Rendering**: Hardware acceleration
- **Web Workers**: Background processing
- **Progressive Loading**: Streaming asset support
- **Advanced Codecs**: AV1, HEVC support
- **Real-time Collaboration**: WebRTC integration

---

## 📋 API Reference

### Core Store Actions
```typescript
// Asset management
addAsset(asset: Asset): void
removeAsset(assetId: string): void

// Timeline operations
addClipToTrack(trackId: string, clip: Clip): void
updateClip(clipId: string, updates: Partial<Clip>): void
removeClip(clipId: string): void

// Keyframe system
updateClipTransform(clipId: string, property: string, value: any, time: number): void
updateKeyframeEasing(clipId: string, property: string, time: number, easing: string): void

// Playback control
play(): void
pause(): void
stop(): void
seek(time: number): void

// History management
saveHistory(actionName: string): void
undo(): void
redo(): void
```

---

This specification provides a comprehensive overview of the FrameForge video editor, covering its architecture, features, implementation details, and future roadmap. The system represents a sophisticated web-based video editing solution with modern development practices and advanced user experience features. 