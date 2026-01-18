import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { Project, Asset, Track, Clip, PlaybackState, TransformKeyframes, AudioKeyframes, PNGFile, FlipbookState } from '../types';
import { interpolateWithEasing } from '../utils/easing';

// History snapshot for undo/redo
interface HistorySnapshot {
  project: Project;
  selectedClipIds: string[];
  selectedAssetId: string | null;
  timestamp: number;
  actionName: string;
}

interface EditorState {
  // Project state
  project: Project;
  selectedClipIds: string[];
  selectedAssetId: string | null;
  
  // Canvas-specific selection (separate from timeline selection)
  canvasSelectedClipId: string | null;
  
  // Playback state
  playback: PlaybackState;
  
  // UI state
  timelineZoom: number;
  canvasZoom: number;
  
  // Clipboard state
  clipboardClips: Clip[];
  
  // Clip-specific elements (for split clips that need their own audio/video elements)
  clipElementMap: Map<string, HTMLAudioElement | HTMLVideoElement>;
  
  // Internal playback state
  playbackIntervalRef: number | null;
  
  // Loading state
  assetsLoading: boolean;

  // PNG Flipbook state
  pngFiles: PNGFile[];
  flipbookState: FlipbookState;
  showPNGViewer: boolean;

  // History state
  history: HistorySnapshot[];
  historyIndex: number;
  maxHistorySize: number;
  
  // Actions
  setProject: (project: Project) => void;
  setAssetsLoading: (loading: boolean) => void;
  addAsset: (asset: Asset) => void;
  removeAsset: (assetId: string) => void;
  addTrack: (type: 'video' | 'audio') => void;
  removeTrack: (trackId: string) => void;
  addClipToTrack: (trackId: string, clip: Clip) => void;
  removeClip: (clipId: string) => void;
  updateClip: (clipId: string, updates: Partial<Clip>, skipHistory?: boolean) => void;
  updateClipTransform: (clipId: string, property: string, value: any, time: number, saveHistory?: boolean) => void;
  updateKeyframeEasing: (clipId: string, property: string, time: number, easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out') => void;
  removeKeyframe: (clipId: string, property: string, time: number) => void;
  moveKeyframe: (clipId: string, property: string, oldTime: number, newTime: number) => void;
  getClipAtCanvasPosition: (x: number, y: number, canvasWidth: number, canvasHeight: number) => string | null;
  getClipTransform: (clipId: string, time: number) => { x: number; y: number; rotation: number; scaleX: number; scaleY: number; opacity: number } | null;
  getEffectiveDuration: (clip: Clip) => number;
  selectCanvasClip: (clipId: string | null) => void;
  splitClip: (clipId: string, splitTime: number) => void;
  reverseClip: (clipId: string) => void;
  takeSnapshot: (clipId: string) => Promise<void>;
  exportAllFrames: (clipId: string) => Promise<void>;
  copyClips: () => void;
  pasteClips: (selectedTrackId?: string) => void;
  createClipElement: (clipId: string, assetId: string) => void;
  removeClipElement: (clipId: string) => void;
  selectClip: (clipId: string | null, multiSelect?: boolean) => void;
  selectAsset: (assetId: string | null) => void;
  
  // Playback actions
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setDuration: (duration: number) => void;
  setFPS: (fps: number) => void;
  
  // Timeline actions
  setTimelineZoom: (zoom: number) => void;
  setCanvasZoom: (zoom: number) => void;

  // PNG Flipbook actions
  loadPNGFiles: (files: FileList) => void;
  togglePNGSelection: (id: string) => void;
  selectAllPNGs: () => void;
  clearPNGSelection: () => void;
  playFlipbook: () => void;
  pauseFlipbook: () => void;
  stopFlipbook: () => void;
  setFlipbookFrame: (frame: number) => void;
  setFlipbookFPS: (fps: number) => void;
  setFlipbookLoop: (loop: boolean) => void;
  setShowPNGViewer: (show: boolean) => void;

  // History actions
  saveHistory: (actionName: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // New actions
  saveInitialHistory: () => void;
}

const createDefaultProject = (): Project => ({
  id: uuidv4(),
  name: 'Untitled Project',
  assets: [],
  timeline: {
    tracks: [
      {
        id: uuidv4(),
        type: 'video',
        name: 'Video 1',
        clips: [],
        visible: true,
        locked: false,
      },
      {
        id: uuidv4(),
        type: 'audio',
        name: 'Audio 1',
        clips: [],
        visible: true,
        locked: false,
      },
    ],
    currentTime: 0,
    duration: 30,
    fps: 30,
    zoom: 1,
  },
  canvasWidth: 1920,
  canvasHeight: 1080,
  backgroundColor: '#000000',
});

// Helper function to calculate transform at a specific time
const calculateTransformAtTime = (clip: Clip, time: number) => {
  const defaults = {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
  };

  if (!clip.keyframes) return defaults;

  const result = { ...defaults };

  // Interpolate each transform property
  Object.keys(clip.keyframes).forEach((property) => {
    const keyframes = (clip.keyframes as any)![property];
    if (!keyframes || keyframes.length === 0) return;

    const value = interpolateKeyframes(keyframes, time);
    
    switch (property) {
      case 'position':
        if (typeof value === 'object' && value !== null && 'x' in value && 'y' in value) {
          result.x = value.x;
          result.y = value.y;
        } else if (Array.isArray(value) && value.length >= 2) {
          result.x = value[0];
          result.y = value[1];
        }
        break;
      case 'rotation':
        result.rotation = typeof value === 'number' ? value : 0;
        break;
      case 'scale':
        if (typeof value === 'object' && value !== null && 'scaleX' in value && 'scaleY' in value) {
          result.scaleX = value.scaleX;
          result.scaleY = value.scaleY;
        } else if (Array.isArray(value) && value.length >= 2) {
          result.scaleX = value[0];
          result.scaleY = value[1];
        }
        break;
      case 'opacity':
        result.opacity = typeof value === 'number' ? value : 1;
        break;
    }
  });

  return result;
};

// Helper function to interpolate keyframes
const interpolateKeyframes = (keyframes: any[], time: number): any => {
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) return keyframes[0].value;

  // Sort keyframes by time to ensure proper order
  const sortedKeyframes = [...keyframes].sort((a, b) => a.time - b.time);

  // If time is before first keyframe, return first keyframe value
  if (time <= sortedKeyframes[0].time) {
    return sortedKeyframes[0].value;
  }

  // If time is after last keyframe, return last keyframe value (no extrapolation!)
  if (time >= sortedKeyframes[sortedKeyframes.length - 1].time) {
    return sortedKeyframes[sortedKeyframes.length - 1].value;
  }

  // Find surrounding keyframes
  let prevKeyframe = sortedKeyframes[0];
  let nextKeyframe = sortedKeyframes[sortedKeyframes.length - 1];

  for (let i = 0; i < sortedKeyframes.length - 1; i++) {
    if (time >= sortedKeyframes[i].time && time <= sortedKeyframes[i + 1].time) {
      prevKeyframe = sortedKeyframes[i];
      nextKeyframe = sortedKeyframes[i + 1];
      break;
    }
  }

  // Interpolate with easing
  const t = (time - prevKeyframe.time) / (nextKeyframe.time - prevKeyframe.time);
  const easing = nextKeyframe.easing || 'linear';
  
  return interpolateWithEasing(prevKeyframe.value, nextKeyframe.value, t, easing);
};

// Helper function to create a history snapshot
const createSnapshot = (state: EditorState, actionName: string): HistorySnapshot => ({
  project: JSON.parse(JSON.stringify(state.project)), // Deep clone without media elements
  selectedClipIds: [...state.selectedClipIds],
  selectedAssetId: state.selectedAssetId,
  timestamp: Date.now(),
  actionName,
});

export const useEditorStore = create<EditorState>((set, get) => ({
  project: createDefaultProject(),
  selectedClipIds: [],
  selectedAssetId: null,
  
  canvasSelectedClipId: null,
  
  playback: {
    isPlaying: false,
    currentTime: 0,
    duration: 30,
    fps: 30,
  },
  
  timelineZoom: 1,
  canvasZoom: 1,
  clipboardClips: [],
  clipElementMap: new Map(),
  playbackIntervalRef: null,
  assetsLoading: false,

  // PNG Flipbook state
  pngFiles: [],
  flipbookState: {
    isPlaying: false,
    currentFrame: 0,
    fps: 12,
    loop: true,
  },
  showPNGViewer: false,

  // History state
  history: [],
  historyIndex: -1,
  maxHistorySize: 50,
  
  setProject: (project) => set((state) => ({
    project,
    playback: { ...state.playback, fps: project.timeline.fps }, // Sync playback FPS
    history: [], // Clear history when loading a project
    historyIndex: -1,
  })),
  
  // Save initial history snapshot after project is loaded
  saveInitialHistory: () => {
    const state = get();
    const snapshot = createSnapshot(state, 'Load project');
    set({
      history: [snapshot],
      historyIndex: 0,
    });
  },
  
  setAssetsLoading: (loading) => set({ assetsLoading: loading }),
  
  addAsset: (asset) => {
    // First add the asset
    set((state) => ({
      project: {
        ...state.project,
        assets: [...state.project.assets, asset],
      },
    }));
    
    // Then save history AFTER the operation
    const newState = get();
    newState.saveHistory(`Import ${asset.name}`);
  },
  
  removeAsset: (assetId) => set((state) => ({
    project: {
      ...state.project,
      assets: state.project.assets.filter(a => a.id !== assetId),
    },
  })),
  
  addTrack: (type) => {
    // First add the track
    set((state) => {
      // Count existing tracks of the same type
      const existingTracksOfType = state.project.timeline.tracks.filter(track => track.type === type);
      const trackNumber = existingTracksOfType.length + 1;
      
      const newTrack = {
        id: uuidv4(),
        type,
        name: `${type === 'video' ? 'Video' : 'Audio'} ${trackNumber}`,
        clips: [],
        visible: true,
        locked: false,
      };

      return {
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            tracks: type === 'video' 
              ? [newTrack, ...state.project.timeline.tracks] // Video tracks at top
              : [...state.project.timeline.tracks, newTrack], // Audio tracks at bottom
          },
        },
      };
    });
    
    // Then save history AFTER the operation
    const newState = get();
    newState.saveHistory(`Add ${type} track`);
  },
  
  removeTrack: (trackId) => {
    const state = get();
    const track = state.project.timeline.tracks.find(t => t.id === trackId);
    
    // First remove the track
    set((state) => ({
      project: {
        ...state.project,
        timeline: {
          ...state.project.timeline,
          tracks: state.project.timeline.tracks.filter(t => t.id !== trackId),
        },
      },
    }));
    
    // Then save history AFTER the operation
    const newState = get();
    newState.saveHistory(`Remove track ${track?.name || 'Unknown'}`);
  },
  
  addClipToTrack: (trackId, clip) => {
    const state = get();
    const asset = state.project.assets.find(a => a.id === clip.assetId);
    
    // First add the clip
    set((state) => ({
      project: {
        ...state.project,
        timeline: {
          ...state.project.timeline,
          tracks: state.project.timeline.tracks.map(track =>
            track.id === trackId
              ? { ...track, clips: [...track.clips, clip] }
              : track
          ),
        },
      },
    }));
    
    // Then save history AFTER adding (captures state with the new clip)
    const newState = get();
    newState.saveHistory(`Add clip ${asset?.name || 'Unknown'}`);
  },
  
  removeClip: (clipId) => {
    // First remove the clip
    set((state) => {
      // Clean up clip element properly if it exists
      const element = state.clipElementMap.get(clipId);
      if (element) {
        if (element instanceof HTMLAudioElement || element instanceof HTMLVideoElement) {
          element.pause();
          element.currentTime = 0;
          element.remove();
          console.log(`Cleaned up independent element for removed clip ${clipId.slice(-4)}`);
        }
      }
      
      const newClipElementMap = new Map(state.clipElementMap);
      newClipElementMap.delete(clipId);
      
      return {
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            tracks: state.project.timeline.tracks.map(track => ({
              ...track,
              clips: track.clips.filter(c => c.id !== clipId),
            })),
          },
        },
        selectedClipIds: state.selectedClipIds.filter(id => id !== clipId),
        clipElementMap: newClipElementMap,
      };
    });
    
    // Then save history AFTER the operation
    const newState = get();
    newState.saveHistory('Remove clip');
  },
  
  updateClip: (clipId, updates, skipHistory = false) => {
    // Note: History is now managed manually in Timeline component during drag operations
    // skipHistory parameter is kept for compatibility but no longer triggers automatic saves
    
    set((state) => ({
      project: {
        ...state.project,
        timeline: {
          ...state.project.timeline,
          tracks: state.project.timeline.tracks.map(track => ({
            ...track,
            clips: track.clips.map(clip =>
              clip.id === clipId ? { ...clip, ...updates } : clip
            ),
          })),
        },
      },
    }));
  },

  updateClipTransform: (clipId, property, value, time, shouldSaveHistory = false) => {
    set((state) => {
      const newTracks = state.project.timeline.tracks.map(track => ({
        ...track,
        clips: track.clips.map(clip => {
          if (clip.id !== clipId) return clip;
          
          // Determine if this is an audio property
          const isAudioProperty = property === 'volume';
          
          if (isAudioProperty) {
            // Handle audio keyframes
            if (!clip.audioKeyframes) {
              clip.audioKeyframes = {};
            }
            
            // Initialize the property keyframes array if it doesn't exist
            if (!clip.audioKeyframes[property as keyof AudioKeyframes]) {
              (clip.audioKeyframes as any)[property] = [];
            }
            
            // Find existing keyframe at this time or create new one
            const keyframes = (clip.audioKeyframes as any)[property];
            const existingIndex = keyframes.findIndex((kf: any) => Math.abs(kf.time - time) < 0.01);
            
            if (existingIndex >= 0) {
              // Update existing keyframe (preserve easing if it exists)
              keyframes[existingIndex] = { ...keyframes[existingIndex], value };
            } else {
              // Add new keyframe with default easing and sort by time
              keyframes.push({ time, value, easing: 'linear' });
              keyframes.sort((a: any, b: any) => a.time - b.time);
            }
          } else {
            // Handle video/transform keyframes
            if (!clip.keyframes) {
              clip.keyframes = {};
            }
            
            // Initialize the property keyframes array if it doesn't exist
            if (!clip.keyframes[property as keyof TransformKeyframes]) {
              (clip.keyframes as any)[property] = [];
            }
            
            // Find existing keyframe at this time or create new one
            const keyframes = (clip.keyframes as any)[property];
            const existingIndex = keyframes.findIndex((kf: any) => Math.abs(kf.time - time) < 0.01);
            
            if (existingIndex >= 0) {
              // Update existing keyframe (preserve easing if it exists)
              keyframes[existingIndex] = { ...keyframes[existingIndex], value };
            } else {
              // Add new keyframe with default easing and sort by time
              keyframes.push({ time, value, easing: 'linear' });
              keyframes.sort((a: any, b: any) => a.time - b.time);
            }
          }
          
          return { ...clip };
        })
      }));
      
      return {
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            tracks: newTracks,
          },
        },
      };
    });
    
    // Save history if requested
    if (shouldSaveHistory) {
      const newState = get();
      const actionName = property === 'position' ? 'Move clip' : 
                         property === 'scale' ? 'Scale clip' : 
                         property === 'rotation' ? 'Rotate clip' :
                         property === 'opacity' ? 'Change opacity' :
                         property === 'volume' ? 'Change volume' :
                         `Update ${property}`;
      newState.saveHistory(actionName);
    }
  },

  getClipAtCanvasPosition: (x, y, canvasWidth, canvasHeight) => {
    const state = get();
    const currentTime = state.project.timeline.currentTime;
    
    // Check tracks in natural order (index 0 is topmost track)
    for (const track of state.project.timeline.tracks) {
      if (!track.visible) continue;
      
      // Check clips in reverse order within each track (later clips render on top)
      const clips = [...track.clips].reverse();
      
      for (const clip of clips) {
        // Check if clip is active at current time
        if (currentTime < clip.start || currentTime > clip.start + clip.duration) continue;
        
        const asset = state.project.assets.find(a => a.id === clip.assetId);
        if (!asset || asset.type === 'audio') continue;
        
                // Get transform at current time using proper interpolation
        const relativeTime = currentTime - clip.start;
        const transform = calculateTransformAtTime(clip, relativeTime);
        
        // Calculate bounds in canvas coordinates
        const scaleX = (canvasWidth / state.project.canvasWidth) * transform.scaleX;
        const scaleY = (canvasHeight / state.project.canvasHeight) * transform.scaleY;
        const centerX = canvasWidth / 2 + (transform.x / state.project.canvasWidth) * canvasWidth;
        const centerY = canvasHeight / 2 + (transform.y / state.project.canvasHeight) * canvasHeight;
        
        // Get asset dimensions
        let assetWidth = 100, assetHeight = 100;
        if (asset.element) {
          if (asset.element instanceof HTMLVideoElement) {
            assetWidth = asset.element.videoWidth;
            assetHeight = asset.element.videoHeight;
          } else if (asset.element instanceof HTMLImageElement) {
            assetWidth = asset.element.naturalWidth;
            assetHeight = asset.element.naturalHeight;
          }
        }
        
        // Calculate bounds (simplified - ignoring rotation for now)
        const halfWidth = (assetWidth * scaleX) / 2;
        const halfHeight = (assetHeight * scaleY) / 2;
        
        if (x >= centerX - halfWidth && x <= centerX + halfWidth &&
            y >= centerY - halfHeight && y <= centerY + halfHeight) {
          return clip.id;
        }
      }
    }
    
    return null;
  },

  getEffectiveDuration: (clip: Clip) => {
    // Calculate the effective duration considering playback speed
    const speed = clip.playbackSpeed || 1.0;
    return clip.duration / speed;
  },

  removeKeyframe: (clipId, property, time) => {
    set((state) => {
      const newTracks = state.project.timeline.tracks.map(track => ({
        ...track,
        clips: track.clips.map(clip => {
          if (clip.id !== clipId) return clip;
          
          const isAudioProperty = property === 'volume';
          
          if (isAudioProperty) {
            // Handle audio keyframes
            if (!clip.audioKeyframes) return clip;
            
            const keyframes = (clip.audioKeyframes as any)[property];
            if (!keyframes) return clip;
            
            // Remove keyframe closest to the specified time
            const filteredKeyframes = keyframes.filter((kf: any) => Math.abs(kf.time - time) > 0.01);
            
            return {
              ...clip,
              audioKeyframes: {
                ...clip.audioKeyframes,
                [property]: filteredKeyframes,
              },
            };
          } else {
            // Handle video/transform keyframes
            if (!clip.keyframes) return clip;
            
            const keyframes = (clip.keyframes as any)[property];
            if (!keyframes) return clip;
            
            // Remove keyframe closest to the specified time
            const filteredKeyframes = keyframes.filter((kf: any) => Math.abs(kf.time - time) > 0.01);
            
            return {
              ...clip,
              keyframes: {
                ...clip.keyframes,
                [property]: filteredKeyframes,
              },
            };
          }
        })
      }));
      
      return {
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            tracks: newTracks,
          },
        },
      };
    });
    
    // Save history after keyframe removal
    const newState = get();
    newState.saveHistory(`Remove ${property} keyframe`);
  },

  moveKeyframe: (clipId, property, oldTime, newTime) => {
    set((state) => {
      const newTracks = state.project.timeline.tracks.map(track => ({
        ...track,
        clips: track.clips.map(clip => {
          if (clip.id !== clipId) return clip;
          
          const isAudioProperty = property === 'volume';
          
          if (isAudioProperty) {
            // Handle audio keyframes
            if (!clip.audioKeyframes) return clip;
            
            const keyframes = (clip.audioKeyframes as any)[property];
            if (!keyframes) return clip;
            
            // Find and update the keyframe
            const updatedKeyframes = keyframes.map((kf: any) => {
              if (Math.abs(kf.time - oldTime) < 0.01) {
                return { ...kf, time: newTime };
              }
              return kf;
            }).sort((a: any, b: any) => a.time - b.time);
            
            return {
              ...clip,
              audioKeyframes: {
                ...clip.audioKeyframes,
                [property]: updatedKeyframes,
              },
            };
          } else {
            // Handle video/transform keyframes
            if (!clip.keyframes) return clip;
            
            const keyframes = (clip.keyframes as any)[property];
            if (!keyframes) return clip;
            
            // Find and update the keyframe
            const updatedKeyframes = keyframes.map((kf: any) => {
              if (Math.abs(kf.time - oldTime) < 0.01) {
                return { ...kf, time: newTime };
              }
              return kf;
            }).sort((a: any, b: any) => a.time - b.time);
            
            return {
              ...clip,
              keyframes: {
                ...clip.keyframes,
                [property]: updatedKeyframes,
              },
            };
          }
        })
      }));
      
      return {
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            tracks: newTracks,
          },
        },
      };
    });
    
    // Save history after keyframe move
    const newState = get();
    newState.saveHistory(`Move ${property} keyframe`);
  },

  updateKeyframeEasing: (clipId, property, time, easing) => {
    set((state) => {
      const newTracks = state.project.timeline.tracks.map(track => ({
        ...track,
        clips: track.clips.map(clip => {
          if (clip.id !== clipId) return clip;
          
          const isAudioProperty = property === 'volume';
          
          if (isAudioProperty) {
            // Handle audio keyframes
            if (!clip.audioKeyframes) return clip;
            
            const keyframes = (clip.audioKeyframes as any)[property];
            if (!keyframes) return clip;
            
            // Find and update the keyframe's easing
            const updatedKeyframes = keyframes.map((kf: any) => {
              if (Math.abs(kf.time - time) < 0.01) {
                return { ...kf, easing };
              }
              return kf;
            });
            
            return {
              ...clip,
              audioKeyframes: {
                ...clip.audioKeyframes,
                [property]: updatedKeyframes,
              },
            };
          } else {
            // Handle video/transform keyframes
            if (!clip.keyframes) return clip;
            
            const keyframes = (clip.keyframes as any)[property];
            if (!keyframes) return clip;
            
            // Find and update the keyframe's easing
            const updatedKeyframes = keyframes.map((kf: any) => {
              if (Math.abs(kf.time - time) < 0.01) {
                return { ...kf, easing };
              }
              return kf;
            });
            
            return {
              ...clip,
              keyframes: {
                ...clip.keyframes,
                [property]: updatedKeyframes,
              },
            };
          }
        })
      }));
      
      return {
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            tracks: newTracks,
          },
        },
      };
    });
    
    // Save history after easing update
    const newState = get();
    newState.saveHistory(`Change ${property} keyframe easing`);
  },

  selectCanvasClip: (clipId) => set({ canvasSelectedClipId: clipId }),

  splitClip: (clipId, splitTime) => {
    // Save history BEFORE the split operation to capture the original clip with keyframes
    const currentState = get();
    currentState.saveHistory('Split clip');
    
    // Then perform the split operation
    set((state) => {
      let targetClip: Clip | null = null;
      let trackId: string | null = null;

      // Find the clip and track
      for (const track of state.project.timeline.tracks) {
        const clip = track.clips.find(c => c.id === clipId);
        if (clip) {
          targetClip = clip;
          trackId = track.id;
          break;
        }
      }

      if (!targetClip || !trackId) return state;

      // Calculate split point relative to clip start
      const relativeTime = splitTime - targetClip.start;
      
      // Don't split if time is outside clip bounds
      if (relativeTime <= 0 || relativeTime >= targetClip.duration) return state;

      // Create new clip element map
      const newClipElementMap = new Map(state.clipElementMap);

      // Helper function to adjust keyframes for split clips
      const adjustKeyframes = (keyframes: any[], splitTime: number, isSecondClip: boolean): any[] => {
        if (!keyframes || keyframes.length === 0) return [];
        
        if (isSecondClip) {
          // For second clip, take all keyframes and adjust their times by subtracting split time
          return keyframes.map(kf => ({
            ...kf,
            time: kf.time - splitTime
          }));
        } else {
          // For first clip, keep all keyframes unchanged
          return [...keyframes];
        }
      };

      // Create keyframes for first clip
      const clip1Keyframes: TransformKeyframes = {};
      if (targetClip.keyframes) {
        if (targetClip.keyframes.position) {
          clip1Keyframes.position = adjustKeyframes(targetClip.keyframes.position, relativeTime, false);
        }
        if (targetClip.keyframes.rotation) {
          clip1Keyframes.rotation = adjustKeyframes(targetClip.keyframes.rotation, relativeTime, false);
        }
        if (targetClip.keyframes.scale) {
          clip1Keyframes.scale = adjustKeyframes(targetClip.keyframes.scale, relativeTime, false);
        }
        if (targetClip.keyframes.opacity) {
          clip1Keyframes.opacity = adjustKeyframes(targetClip.keyframes.opacity, relativeTime, false);
        }
      }

      // Create keyframes for second clip
      const clip2Keyframes: TransformKeyframes = {};
      if (targetClip.keyframes) {
        if (targetClip.keyframes.position) {
          clip2Keyframes.position = adjustKeyframes(targetClip.keyframes.position, relativeTime, true);
        }
        if (targetClip.keyframes.rotation) {
          clip2Keyframes.rotation = adjustKeyframes(targetClip.keyframes.rotation, relativeTime, true);
        }
        if (targetClip.keyframes.scale) {
          clip2Keyframes.scale = adjustKeyframes(targetClip.keyframes.scale, relativeTime, true);
        }
        if (targetClip.keyframes.opacity) {
          clip2Keyframes.opacity = adjustKeyframes(targetClip.keyframes.opacity, relativeTime, true);
        }
      }

      // Create audio keyframes for first clip
      const clip1AudioKeyframes: AudioKeyframes = {};
      if (targetClip.audioKeyframes) {
        if (targetClip.audioKeyframes.volume) {
          clip1AudioKeyframes.volume = adjustKeyframes(targetClip.audioKeyframes.volume, relativeTime, false);
        }
      }

      // Create audio keyframes for second clip
      const clip2AudioKeyframes: AudioKeyframes = {};
      if (targetClip.audioKeyframes) {
        if (targetClip.audioKeyframes.volume) {
          clip2AudioKeyframes.volume = adjustKeyframes(targetClip.audioKeyframes.volume, relativeTime, true);
        }
      }

      // Create two new clips
      const clip1: Clip = {
        ...targetClip,
        id: uuidv4(),
        duration: relativeTime,
        outPoint: targetClip.inPoint ? targetClip.inPoint + relativeTime : relativeTime,
        keyframes: Object.keys(clip1Keyframes).length > 0 ? clip1Keyframes : undefined,
        audioKeyframes: Object.keys(clip1AudioKeyframes).length > 0 ? clip1AudioKeyframes : undefined,
      };

      const clip2: Clip = {
        ...targetClip,
        id: uuidv4(),
        start: targetClip.start + relativeTime,
        duration: targetClip.duration - relativeTime,
        inPoint: targetClip.inPoint ? targetClip.inPoint + relativeTime : relativeTime,
        keyframes: Object.keys(clip2Keyframes).length > 0 ? clip2Keyframes : undefined,
        audioKeyframes: Object.keys(clip2AudioKeyframes).length > 0 ? clip2AudioKeyframes : undefined,
      };

      // Create separate independent audio elements for split clips to avoid conflicts
      const asset = state.project.assets.find(a => a.id === targetClip.assetId);
      if (asset?.type === 'audio' && asset.element) {
        const originalAudio = asset.element as HTMLAudioElement;
        
        // Create completely new audio elements for both split clips
        const audio1 = new Audio();
        audio1.src = originalAudio.src;
        audio1.preload = 'metadata';
        audio1.volume = 1.0;
        audio1.playbackRate = 1.0;
        audio1.crossOrigin = 'anonymous';
        
        const audio2 = new Audio();
        audio2.src = originalAudio.src;
        audio2.preload = 'metadata';
        audio2.volume = 1.0;
        audio2.playbackRate = 1.0;
        audio2.crossOrigin = 'anonymous';
        
        // Store the independent elements in the clip map
        newClipElementMap.set(clip1.id, audio1);
        newClipElementMap.set(clip2.id, audio2);
        console.log(`Created independent audio elements for split clips ${clip1.id.slice(-4)} and ${clip2.id.slice(-4)}`);
      }

      return {
        ...state,
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            tracks: state.project.timeline.tracks.map(track =>
              track.id === trackId
                ? {
                    ...track,
                    clips: track.clips
                      .filter(c => c.id !== clipId)
                      .concat([clip1, clip2])
                      .sort((a, b) => a.start - b.start)
                  }
                : track
            ),
          },
        },
        selectedClipIds: [],
        clipElementMap: newClipElementMap,
      };
    });
  },

  reverseClip: (clipId) => {
    // Save history BEFORE the reverse operation
    const currentState = get();
    currentState.saveHistory('Reverse clip');
    
    // Then perform the reverse operation
    set((state) => ({
      project: {
        ...state.project,
        timeline: {
          ...state.project.timeline,
          tracks: state.project.timeline.tracks.map(track => ({
            ...track,
            clips: track.clips.map(clip =>
              clip.id === clipId ? { ...clip, reversed: !clip.reversed } : clip
            ),
          })),
        },
      },
    }));
  },

  takeSnapshot: async (clipId) => {
    const state = get();
    
    // Find the clip
    let targetClip: Clip | null = null;
    for (const track of state.project.timeline.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) {
        targetClip = clip;
        break;
      }
    }

    if (!targetClip) {
      console.error('Clip not found for snapshot');
      return;
    }

    // Find the asset
    const asset = state.project.assets.find(a => a.id === targetClip.assetId);
    if (!asset || asset.type !== 'video') {
      console.error('Asset not found or not a video');
      return;
    }

    // Get the video element
    const videoElement = asset.element as HTMLVideoElement;
    if (!videoElement) {
      console.error('Video element not found');
      return;
    }

    try {
      // Calculate the current time within the clip
      const currentTime = state.project.timeline.currentTime;
      const clipRelativeTime = currentTime - targetClip.start;
      
      // Apply playback speed and reverse if needed
      let sourceTime = clipRelativeTime;
      if (targetClip.playbackSpeed) {
        sourceTime = clipRelativeTime * targetClip.playbackSpeed;
      }
      if (targetClip.reversed) {
        sourceTime = targetClip.duration - sourceTime;
      }
      
      // Add in/out point offset
      if (targetClip.inPoint) {
        sourceTime += targetClip.inPoint;
      }

      // Set video to the correct time
      videoElement.currentTime = sourceTime;
      
      // Wait for the video to seek to the correct frame
      await new Promise((resolve) => {
        const onSeeked = () => {
          videoElement.removeEventListener('seeked', onSeeked);
          resolve(void 0);
        };
        videoElement.addEventListener('seeked', onSeeked);
      });

      // Create canvas to capture the frame
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      // Set canvas size to video dimensions
      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;

      // Draw the video frame to canvas
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

      // Convert canvas to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob from canvas'));
          }
        }, 'image/png');
      });

      // Create filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `snapshot_${asset.name}_${timestamp}.png`;

      // Save to disk
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Copy to clipboard
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        console.log('Image copied to clipboard');
      } catch (clipboardError) {
        console.warn('Failed to copy to clipboard:', clipboardError);
      }

      // Create new image asset
      const imageUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const newAsset: Asset = {
          id: uuidv4(),
          type: 'image',
          src: imageUrl,
          name: filename,
          width: img.width,
          height: img.height,
          element: img,
        };

        // Add the new asset to the project
        const currentState = get();
        currentState.addAsset(newAsset);
        
        console.log(`Snapshot saved: ${filename}`);
      };
      img.src = imageUrl;

    } catch (error) {
      console.error('Failed to take snapshot:', error);
    }
  },

  exportAllFrames: async (clipId) => {
    const state = get();
    
    // Find the clip
    let targetClip: Clip | null = null;
    for (const track of state.project.timeline.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) {
        targetClip = clip;
        break;
      }
    }

    if (!targetClip) {
      console.error('Clip not found for frame export');
      return;
    }

    // Find the asset
    const asset = state.project.assets.find(a => a.id === targetClip.assetId);
    if (!asset || asset.type !== 'video') {
      console.error('Asset not found or not a video');
      return;
    }

    // Get the video element
    const videoElement = asset.element as HTMLVideoElement;
    if (!videoElement) {
      console.error('Video element not found');
      return;
    }

    try {
      // Show folder picker dialog
      let directoryHandle;
      try {
        // Use the modern File System Access API if available
        if ('showDirectoryPicker' in window) {
          directoryHandle = await (window as any).showDirectoryPicker();
        } else {
          throw new Error('Directory picker not supported');
        }
      } catch (error) {
        console.error('Folder selection not supported in this browser:', error);
        alert('Frame export requires a browser that supports folder selection (Chrome/Edge 86+)');
        return;
      }

      // Calculate frame count based on clip settings
      const effectiveDuration = state.getEffectiveDuration(targetClip);
      const fps = state.project.timeline.fps;
      const totalFrames = Math.ceil(effectiveDuration * fps);
      
      console.log(`Starting frame export: ${totalFrames} frames from clip "${asset.name}"`);
      
      // Create clean clip name for filenames
      const cleanClipName = asset.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      
      // Create canvas for frame capture
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      // Set canvas size to video dimensions
      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;

      // Export each frame
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        // Calculate frame time within the clip
        const clipRelativeTime = frameIndex / fps;
        
        // Apply clip settings (playback speed, reverse, in/out points)
        let sourceTime = clipRelativeTime;
        if (targetClip.playbackSpeed) {
          sourceTime = clipRelativeTime * targetClip.playbackSpeed;
        }
        if (targetClip.reversed) {
          sourceTime = effectiveDuration - sourceTime;
        }
        
        // Add in/out point offset
        if (targetClip.inPoint) {
          sourceTime += targetClip.inPoint;
        }

        // Set video to the correct time
        videoElement.currentTime = sourceTime;
        
        // Wait for the video to seek to the correct frame
        await new Promise((resolve) => {
          const onSeeked = () => {
            videoElement.removeEventListener('seeked', onSeeked);
            resolve(void 0);
          };
          videoElement.addEventListener('seeked', onSeeked);
        });

        // Draw the video frame to canvas
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

        // Convert canvas to blob
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create blob from canvas'));
            }
          }, 'image/png');
        });

        // Create sequential filename with zero padding
        const frameNumber = (frameIndex + 1).toString().padStart(4, '0');
        const filename = `${cleanClipName}_frame_${frameNumber}.png`;

        // Save file using File System Access API
        try {
          const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        } catch (error) {
          console.error(`Failed to save frame ${frameNumber}:`, error);
          throw error;
        }

        // Update progress in console
        if (frameIndex % 10 === 0 || frameIndex === totalFrames - 1) {
          console.log(`Exported frame ${frameIndex + 1}/${totalFrames} (${Math.round(((frameIndex + 1) / totalFrames) * 100)}%)`);
        }
      }
      
      console.log(`✅ Frame export complete: ${totalFrames} frames saved to folder`);
      alert(`Successfully exported ${totalFrames} frames from "${asset.name}" to the selected folder!`);
      
    } catch (error) {
      console.error('Failed to export frames:', error);
      alert(`Failed to export frames: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  copyClips: () => set((state) => {
    const clipsToStore: Clip[] = [];
    
    // Find all selected clips and store them
    state.project.timeline.tracks.forEach(track => {
      track.clips.forEach(clip => {
        if (state.selectedClipIds.includes(clip.id)) {
          clipsToStore.push({ ...clip });
        }
      });
    });
    
    return {
      clipboardClips: clipsToStore,
    };
  }),

  pasteClips: (selectedTrackId?: string) => {
    const state = get();
    if (state.clipboardClips.length === 0) return;
    
    // Save history BEFORE the paste operation
    state.saveHistory('Paste clips');
    
    // Then perform the paste operation
    set((state) => {
      if (state.clipboardClips.length === 0) return state;
      
      const currentTime = state.project.timeline.currentTime;
      const newTracks = [...state.project.timeline.tracks];
      
      // Find the first reference clip to calculate relative positioning
      const sortedClipboard = [...state.clipboardClips].sort((a, b) => a.start - b.start);
      const firstClipStart = sortedClipboard[0]?.start || 0;
      
      // Helper function to find the next available space in a track
      const findNextAvailableSpace = (track: any, preferredStart: number, clipDuration: number) => {
        const sortedClips = [...track.clips].sort((a, b) => a.start - b.start);
        
        // Check if preferred position is available
        const preferredEnd = preferredStart + clipDuration;
        let hasCollision = false;
        
        for (const clip of sortedClips) {
          if (!(preferredEnd <= clip.start || preferredStart >= clip.start + clip.duration)) {
            hasCollision = true;
            break;
          }
        }
        
        if (!hasCollision) {
          return Math.max(0, preferredStart);
        }
        
        // Find the next available gap after the collision
        for (let i = 0; i < sortedClips.length; i++) {
          const currentClip = sortedClips[i];
          const nextClip = sortedClips[i + 1];
          
          const afterCurrentClip = currentClip.start + currentClip.duration;
          
          if (nextClip) {
            const availableSpace = nextClip.start - afterCurrentClip;
            if (availableSpace >= clipDuration) {
              return afterCurrentClip;
            }
          } else {
            return afterCurrentClip;
          }
        }
        
        if (sortedClips.length === 0) {
          return Math.max(0, preferredStart);
        }
        
        const lastClip = sortedClips[sortedClips.length - 1];
        return lastClip.start + lastClip.duration;
      };
      
      // Group clipboard clips by their original track type
      const videoClips = sortedClipboard.filter(clip => {
        const asset = state.project.assets.find(a => a.id === clip.assetId);
        return asset && (asset.type === 'video' || asset.type === 'image');
      });
      
      const audioClips = sortedClipboard.filter(clip => {
        const asset = state.project.assets.find(a => a.id === clip.assetId);
        return asset && asset.type === 'audio';
      });
      
      // Find the selected track if provided
      let selectedTrack = null;
      if (selectedTrackId) {
        selectedTrack = newTracks.find(track => track.id === selectedTrackId);
      }
      
      // Paste video clips to the selected track if compatible, otherwise first available video track
      if (videoClips.length > 0) {
        const videoTrack = (selectedTrack && selectedTrack.type === 'video') 
          ? selectedTrack 
          : newTracks.find(track => track.type === 'video');
        
        if (videoTrack) {
          videoClips.forEach(originalClip => {
            const relativeOffset = originalClip.start - firstClipStart;
            const desiredStart = currentTime + relativeOffset;
            const actualStart = findNextAvailableSpace(videoTrack, desiredStart, originalClip.duration);
            
            const newClip: Clip = {
              ...originalClip,
              id: uuidv4(),
              start: actualStart,
            };
            
            videoTrack.clips.push(newClip);
          });
        }
      }
      
      // Paste audio clips to the selected track if compatible, otherwise first available audio track
      if (audioClips.length > 0) {
        const audioTrack = (selectedTrack && selectedTrack.type === 'audio') 
          ? selectedTrack 
          : newTracks.find(track => track.type === 'audio');
        
        if (audioTrack) {
          audioClips.forEach(originalClip => {
            const relativeOffset = originalClip.start - firstClipStart;
            const desiredStart = currentTime + relativeOffset;
            const actualStart = findNextAvailableSpace(audioTrack, desiredStart, originalClip.duration);
            
            const newClip: Clip = {
              ...originalClip,
              id: uuidv4(),
              start: actualStart,
            };
            
            audioTrack.clips.push(newClip);
          });
        }
      }
      
      return {
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            tracks: newTracks,
          },
        },
        selectedClipIds: [], // Clear selection after paste
      };
    });
  },

  createClipElement: (clipId, assetId) => set((state) => {
    const asset = state.project.assets.find(a => a.id === assetId);
    if (!asset?.element) return state;

    let independentElement: HTMLAudioElement | HTMLVideoElement;
    
    if (asset.type === 'audio') {
      const originalAudio = asset.element as HTMLAudioElement;
      // Create a completely new audio element for true independence
      independentElement = new Audio();
      independentElement.src = originalAudio.src;
      independentElement.preload = 'metadata';
      independentElement.volume = 1.0;
      independentElement.playbackRate = 1.0;
      independentElement.crossOrigin = 'anonymous';
      console.log(`Created independent audio element for clip ${clipId.slice(-4)}`);
    } else if (asset.type === 'video') {
      const originalVideo = asset.element as HTMLVideoElement;
      // For video, cloneNode is okay since they don't interfere as much
      independentElement = originalVideo.cloneNode() as HTMLVideoElement;
      independentElement.src = originalVideo.src;
      independentElement.preload = 'metadata';
    } else {
      return state; // Images don't need cloning
    }
    
    const newMap = new Map(state.clipElementMap);
    newMap.set(clipId, independentElement);
    
    return {
      clipElementMap: newMap,
    };
  }),

  removeClipElement: (clipId) => set((state) => {
    const element = state.clipElementMap.get(clipId);
    
    // Clean up audio/video element if it exists
    if (element) {
      if (element instanceof HTMLAudioElement || element instanceof HTMLVideoElement) {
        element.pause();
        element.currentTime = 0;
        element.remove();
        console.log(`Cleaned up independent element for clip ${clipId.slice(-4)}`);
      }
    }
    
    const newMap = new Map(state.clipElementMap);
    newMap.delete(clipId);
    
    return {
      clipElementMap: newMap,
    };
  }),

  selectClip: (clipId, multiSelect = false) => set((state) => {
    if (!clipId) {
      return { selectedClipIds: [] };
    }
    
    if (multiSelect) {
      const isSelected = state.selectedClipIds.includes(clipId);
      return {
        selectedClipIds: isSelected 
          ? state.selectedClipIds.filter(id => id !== clipId)
          : [...state.selectedClipIds, clipId]
      };
    } else {
      return { selectedClipIds: [clipId] };
    }
  }),
  selectAsset: (assetId) => set({ selectedAssetId: assetId }),
  
  play: () => {
    const state = get();
    if (state.playback.isPlaying) return;
    
    // Clear any existing interval
    if (state.playbackIntervalRef) {
      clearInterval(state.playbackIntervalRef);
    }
    
    // Start playback loop
    const intervalId = setInterval(() => {
      const currentState = get();
      const newTime = currentState.project.timeline.currentTime + (1 / currentState.playback.fps);
      
      if (newTime >= currentState.project.timeline.duration) {
        // Stop at end
        currentState.stop();
      } else {
        // Update time
        set((state) => ({
          playback: { ...state.playback, currentTime: newTime },
          project: { 
            ...state.project, 
            timeline: { ...state.project.timeline, currentTime: newTime } 
          },
        }));
      }
    }, 1000 / state.playback.fps);
    
    set({
      playback: { ...state.playback, isPlaying: true },
      playbackIntervalRef: intervalId,
    });
  },
  
  pause: () => {
    const state = get();
    if (state.playbackIntervalRef) {
      clearInterval(state.playbackIntervalRef);
    }
    
    set({
      playback: { ...state.playback, isPlaying: false },
      playbackIntervalRef: null,
    });
  },
  
  stop: () => {
    const state = get();
    if (state.playbackIntervalRef) {
      clearInterval(state.playbackIntervalRef);
    }
    
    set({
      playback: { ...state.playback, isPlaying: false, currentTime: 0 },
      project: { ...state.project, timeline: { ...state.project.timeline, currentTime: 0 } },
      playbackIntervalRef: null,
    });
  },
  
  seek: (time) => {
    const state = get();
    
    // Don't auto-pause when seeking during playback
    set((state) => ({
      playback: { ...state.playback, currentTime: time },
      project: { ...state.project, timeline: { ...state.project.timeline, currentTime: time } },
    }));
  },
  
  setDuration: (duration) => set((state) => ({
    playback: { ...state.playback, duration },
    project: { ...state.project, timeline: { ...state.project.timeline, duration } },
  })),
  
  setFPS: (fps) => set((state) => ({
    playback: { ...state.playback, fps },
    project: { ...state.project, timeline: { ...state.project.timeline, fps } },
  })),
  
  setTimelineZoom: (zoom) => set({ timelineZoom: zoom }),
  setCanvasZoom: (zoom) => set({ canvasZoom: zoom }),

  // PNG Flipbook functionality
  loadPNGFiles: (files) => {
    const pngFiles: PNGFile[] = [];
    
    Array.from(files).forEach((file) => {
      if (file.type === 'image/png') {
        const pngFile: PNGFile = {
          id: uuidv4(),
          name: file.name,
          src: URL.createObjectURL(file),
          file,
          selected: false,
        };
        pngFiles.push(pngFile);
      }
    });

    // Sort by name for consistent ordering
    pngFiles.sort((a, b) => a.name.localeCompare(b.name));

    set((state) => ({
      pngFiles,
      flipbookState: {
        ...state.flipbookState,
        currentFrame: 0,
        isPlaying: false,
      },
    }));
  },

  togglePNGSelection: (id) => set((state) => ({
    pngFiles: state.pngFiles.map(file => 
      file.id === id ? { ...file, selected: !file.selected } : file
    ),
  })),

  selectAllPNGs: () => set((state) => ({
    pngFiles: state.pngFiles.map(file => ({ ...file, selected: true })),
  })),

  clearPNGSelection: () => set((state) => ({
    pngFiles: state.pngFiles.map(file => ({ ...file, selected: false })),
  })),

  playFlipbook: () => {
    const state = get();
    if (state.flipbookState.isPlaying) return;

    const selectedFiles = state.pngFiles.filter(f => f.selected);
    if (selectedFiles.length === 0) return;

    set((state) => ({
      flipbookState: { ...state.flipbookState, isPlaying: true },
    }));

    // Animation loop
    const animate = () => {
      const currentState = get();
      if (!currentState.flipbookState.isPlaying) return;

      const selectedFiles = currentState.pngFiles.filter(f => f.selected);
      if (selectedFiles.length === 0) return;

      const nextFrame = currentState.flipbookState.currentFrame + 1;
      
      if (nextFrame >= selectedFiles.length) {
        if (currentState.flipbookState.loop) {
          set((state) => ({
            flipbookState: { ...state.flipbookState, currentFrame: 0 },
          }));
        } else {
          // Stop at the end
          set((state) => ({
            flipbookState: { ...state.flipbookState, isPlaying: false, currentFrame: 0 },
          }));
          return;
        }
      } else {
        set((state) => ({
          flipbookState: { ...state.flipbookState, currentFrame: nextFrame },
        }));
      }

      setTimeout(animate, 1000 / currentState.flipbookState.fps);
    };

    animate();
  },

  pauseFlipbook: () => set((state) => ({
    flipbookState: { ...state.flipbookState, isPlaying: false },
  })),

  stopFlipbook: () => set((state) => ({
    flipbookState: { ...state.flipbookState, isPlaying: false, currentFrame: 0 },
  })),

  setFlipbookFrame: (frame) => set((state) => {
    const selectedFiles = state.pngFiles.filter(f => f.selected);
    const clampedFrame = Math.max(0, Math.min(frame, selectedFiles.length - 1));
    return {
      flipbookState: { ...state.flipbookState, currentFrame: clampedFrame },
    };
  }),

  setFlipbookFPS: (fps) => set((state) => ({
    flipbookState: { ...state.flipbookState, fps: Math.max(1, Math.min(fps, 60)) },
  })),

  setFlipbookLoop: (loop) => set((state) => ({
    flipbookState: { ...state.flipbookState, loop },
  })),

  setShowPNGViewer: (show) => set({ showPNGViewer: show }),

  // History management
  saveHistory: (actionName) => set((state) => {
    console.log(`📚 SAVING HISTORY: ${actionName}`);
    
    // Debug: Log current clip state when saving history
    const allClips = state.project.timeline.tracks.flatMap(t => t.clips);
    if (allClips.length > 0) {
      const firstClip = allClips[0];
      console.log(`📚 Snapshot of first clip ${firstClip.id.slice(-4)}: start=${firstClip.start}, duration=${firstClip.duration}, inPoint=${firstClip.inPoint}, outPoint=${firstClip.outPoint}`);
    }
    
    const snapshot = createSnapshot(state, actionName);
    
    // Remove any history after current index (when undoing then doing new action)
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(snapshot);
    
    // Limit history size
    if (newHistory.length > state.maxHistorySize) {
      newHistory.shift();
    }
    
    const newIndex = newHistory.length - 1;
    console.log(`📚 History entries: [${newHistory.map(h => h.actionName).join(', ')}] | Index: ${newIndex}`);
    
    return {
      history: newHistory,
      historyIndex: newIndex,
    };
  }),

  undo: () => set((state) => {
    if (state.historyIndex <= 0) return state;
    
    // Log the action we're undoing FROM (current state)
    const currentAction = state.history[state.historyIndex].actionName;
    console.log(`⏪ UNDOING: ${currentAction}`);
    
    // Get the snapshot we're going TO (previous state)
    const snapshot = state.history[state.historyIndex - 1];
    
    // Debug: Log clip states for comparison
    const currentClips = state.project.timeline.tracks.flatMap(t => t.clips);
    const snapshotClips = snapshot.project.timeline.tracks.flatMap(t => t.clips);
    console.log(`🔍 Current state has ${currentClips.length} clips`);
    console.log(`🔍 Snapshot state has ${snapshotClips.length} clips`);
    
    if (currentClips.length > 0) {
      const currentClip = currentClips[0];
      console.log(`📍 Current clip ${currentClip.id.slice(-4)}: start=${currentClip.start}, duration=${currentClip.duration}`);
    }
    
    if (snapshotClips.length > 0) {
      const snapshotClip = snapshotClips[0];
      console.log(`📍 Snapshot clip ${snapshotClip.id.slice(-4)}: start=${snapshotClip.start}, duration=${snapshotClip.duration}`);
    } else {
      console.log(`❌ Snapshot has no clips! Going back to: ${snapshot.actionName}`);
    }
    
    // Restore media elements from current state before switching
    const restoredProject = {
      ...snapshot.project,
      assets: snapshot.project.assets.map(snapshotAsset => {
        const currentAsset = state.project.assets.find(a => a.id === snapshotAsset.id);
        return {
          ...snapshotAsset,
          element: currentAsset?.element, // Preserve the media element
          thumbnail: currentAsset?.thumbnail, // Preserve thumbnail
          waveform: currentAsset?.waveform, // Preserve waveform
        };
      }),
    };
    
    return {
      project: restoredProject,
      selectedClipIds: snapshot.selectedClipIds,
      selectedAssetId: snapshot.selectedAssetId,
      historyIndex: state.historyIndex - 1,
    };
  }),

  redo: () => set((state) => {
    if (state.historyIndex >= state.history.length - 1) return state;
    
    // Get the snapshot we're going TO (next state)
    const snapshot = state.history[state.historyIndex + 1];
    console.log(`⏩ REDOING: ${snapshot.actionName}`);
    
    // Restore media elements from current state before switching
    const restoredProject = {
      ...snapshot.project,
      assets: snapshot.project.assets.map(snapshotAsset => {
        const currentAsset = state.project.assets.find(a => a.id === snapshotAsset.id);
        return {
          ...snapshotAsset,
          element: currentAsset?.element, // Preserve the media element
          thumbnail: currentAsset?.thumbnail, // Preserve thumbnail
          waveform: currentAsset?.waveform, // Preserve waveform
        };
      }),
    };
    
    return {
      project: restoredProject,
      selectedClipIds: snapshot.selectedClipIds,
      selectedAssetId: snapshot.selectedAssetId,
      historyIndex: state.historyIndex + 1,
    };
  }),

  canUndo: () => {
    const state = get();
    return state.historyIndex > 0;
  },

  canRedo: () => {
    const state = get();
    return state.historyIndex < state.history.length - 1;
  },

  getClipTransform: (clipId, time) => {
    const state = get();
    const clip = state.project.timeline.tracks.flatMap(t => t.clips).find(c => c.id === clipId);
    if (!clip) return null;
    return calculateTransformAtTime(clip, time);
  },
})); 