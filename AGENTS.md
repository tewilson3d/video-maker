# Video Maker - Agent Instructions

## Architecture Overview

This app has **TWO frontends** that work together:

| Component | Path | Technology | Purpose |
|-----------|------|------------|----------|
| **Main App** | `/` | HTML/JS | Prompting & Storyboard tabs with keyframe editor modal |
| **Editing Tab** | `/static/editor/` | React/TypeScript | Video timeline editor (loaded via iframe) |

## File Locations

### Main App (HTML/JS)
- **Template**: `srv/templates/home.html` - Contains ALL HTML, CSS, and JavaScript
- **Tabs**: Prompting, Storyboard, Editing (iframe)
- **Features**: 
  - Story prompt input
  - Keyframe editor modal (double-click to open)
  - Video generation with Veo
  - Image generation with Gemini
  - Project load/save via server API

### Editing Tab (React)
- **Source**: `tools/src/` - React/TypeScript source code
- **Built output**: `tools/dist/` - Compiled JS/CSS
- **Deployed to**: `srv/static/editor/` - Served by Go server
- **Entry point**: `tools/src/App.tsx`
- **Key components**:
  - `components/Timeline.tsx` - Multi-track timeline
  - `components/Canvas.tsx` - Video preview
  - `components/Toolbar.tsx` - Editor toolbar
  - `components/AssetBrowser.tsx` - Asset panel
- **State**: `store/index.ts` - Zustand store
- **Detailed docs**: `tools/Claude.md`

## Communication Between Frontends

The main app sends data to the React editor via `postMessage`:

```javascript
// In home.html - sending storyboard to editor
editorFrame.contentWindow.postMessage({
  type: 'loadStoryboard',
  storyboard: storyboardData
}, '*');
```

```typescript
// In App.tsx - receiving storyboard
window.addEventListener('message', (event) => {
  if (event.data?.type === 'loadStoryboard') {
    // Load storyboard into editor
  }
});
```

## Build & Deploy Commands

```bash
# Build React editor
cd tools && npm run build

# Deploy to static folder
cp -r tools/dist/* srv/static/editor/

# Build Go server
go build -o video-maker ./cmd/srv

# Restart server
pkill -f "./video-maker"; ./video-maker &
```

## Key APIs (Go Server)

- `GET /` - Serves main HTML app
- `GET /static/editor/` - Serves React editor
- `GET /api/load-project?path=...` - Load project from server path
- `POST /api/save-project` - Save project to server
- `POST /api/upload-video` - Upload video blob
- `POST /api/save-keyframe` - Save keyframe image

## When to Edit What

| Task | Edit This |
|------|----------|
| Prompting tab UI | `srv/templates/home.html` |
| Storyboard tab UI | `srv/templates/home.html` |
| Keyframe editor modal | `srv/templates/home.html` |
| Header buttons (Load/Save/Settings) | `srv/templates/home.html` |
| Timeline editor | `tools/src/components/Timeline.tsx` |
| Video preview canvas | `tools/src/components/Canvas.tsx` |
| Editor toolbar | `tools/src/components/Toolbar.tsx` |
| Asset browser | `tools/src/components/AssetBrowser.tsx` |
| Editor state/logic | `tools/src/store/index.ts` |
| API endpoints | `srv/server.go` |

## Important Notes

1. **Always rebuild React** after editing `tools/src/` files
2. **The iframe is embedded** - React editor runs inside the Editing tab
3. **postMessage is critical** - This is how data flows from Storyboard → Editor
4. **Assets need elements** - When loading into editor, video/image elements must be created
