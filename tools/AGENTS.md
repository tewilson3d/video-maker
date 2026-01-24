# React Video Editor - Agent Instructions

## This is the EDITING TAB

This React app is loaded inside an iframe in the main Video Maker app's "Editing" tab.

## Quick Reference

| File | Purpose |
|------|----------|
| `src/App.tsx` | Main app, handles iframe messages |
| `src/components/Timeline.tsx` | Multi-track timeline editor |
| `src/components/Canvas.tsx` | Video preview with transforms |
| `src/components/Toolbar.tsx` | Import, Undo/Redo, Export, Settings |
| `src/components/AssetBrowser.tsx` | Asset panel (drag to timeline) |
| `src/store/index.ts` | Zustand state management |
| `src/types/index.ts` | TypeScript interfaces |

## How Data Gets Here

The main app (`srv/templates/home.html`) sends storyboard data via postMessage:

```typescript
// Received in App.tsx useEffect
window.addEventListener('message', (event) => {
  if (event.data?.type === 'loadStoryboard') {
    // Convert storyboard to project
    // Load video/image elements
    // Set project state
  }
});
```

## Build Commands

```bash
npm run build          # Build to dist/
cp -r dist/* ../srv/static/editor/   # Deploy
```

## Detailed Documentation

See `Claude.md` for comprehensive technical specs including:
- Full component architecture
- State management details
- Keyframe animation system
- Export pipeline
- AI integration
