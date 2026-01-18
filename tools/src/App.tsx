import React, { useEffect, useState, useRef } from 'react';
import Toolbar from './components/Toolbar';
import AssetBrowser from './components/AssetBrowser';
import Canvas from './components/Canvas';
import Timeline from './components/Timeline';
import PNGFlipbookViewer from './components/PNGFlipbookViewer';
import { useEditorStore } from './store';

// PropertyPanel component moved here from Timeline
const PropertyPanel: React.FC = () => {
  const { 
    project, 
    canvasSelectedClipId, 
    selectedClipIds,
    updateClipTransform, 
    updateKeyframeEasing,
    removeKeyframe, 
    moveKeyframe,
    getClipTransform,
    setProject,
    setFPS,
    saveHistory,
    updateClip
  } = useEditorStore();

  // Track interaction state to avoid saving history on every slider movement
  const [isInteracting, setIsInteracting] = useState(false);
  
  // Track input editing state
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [editingInput, setEditingInput] = useState<string | null>(null);

  // Helper functions for input handling
  const handleInputFocus = (inputId: string, currentValue: string, e: React.FocusEvent<HTMLInputElement>) => {
    setEditingInput(inputId);
    setInputValues(prev => ({ ...prev, [inputId]: currentValue }));
    e.target.select(); // Select all text on focus
  };

  const handleInputBlur = (inputId: string, onCommit: (value: string) => void) => {
    const value = inputValues[inputId] || '';
    onCommit(value);
    setEditingInput(null);
    setInputValues(prev => {
      const newValues = { ...prev };
      delete newValues[inputId];
      return newValues;
    });
  };

  const handleInputChange = (inputId: string, value: string, onCommit: (value: string) => void) => {
    setInputValues(prev => ({ ...prev, [inputId]: value }));
    
    // Try to commit if it's a valid number
    if (value !== '' && value !== '-' && value !== '.' && value !== '-.' && !value.endsWith('.')) {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        onCommit(value);
      }
    }
  };

  const getClipById = (clipId: string) => {
    for (const track of project.timeline.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) return clip;
    }
    return null;
  };

  const findTrackContainingClip = (clipId: string) => {
    return project.timeline.tracks.find(track => 
      track.clips.some(clip => clip.id === clipId)
    );
  };

  // Get all selected clips (prioritize timeline selection, fallback to canvas selection)
  const getSelectedClips = () => {
    const clipsToUse = selectedClipIds.length > 0 ? selectedClipIds : (canvasSelectedClipId ? [canvasSelectedClipId] : []);
    return clipsToUse.map(clipId => ({
      id: clipId,
      clip: getClipById(clipId),
      track: findTrackContainingClip(clipId)
    })).filter(item => item.clip && item.track);
  };

  // Start interaction - save initial state to history
  const startInteraction = (actionName: string) => {
    if (!isInteracting) {
      setIsInteracting(true);
      saveHistory(`Start ${actionName}`);
    }
  };

  // End interaction - save final state to history
  const endInteraction = (actionName: string) => {
    if (isInteracting) {
      setIsInteracting(false);
      saveHistory(`${actionName}`);
    }
  };

  const updateOpacityVolume = (value: number, shouldSaveHistory: boolean = false) => {
    const selectedClips = getSelectedClips();
    if (selectedClips.length === 0) return;
    
    const currentTime = project.timeline.currentTime;
    
    // Apply to all selected clips
    selectedClips.forEach(({ id: clipId, clip, track }) => {
      if (!clip || !track) return;
      
      const clipStart = clip.start;
      const relativeTime = currentTime - clipStart;
      
      // Only update if playhead is within the clip's time range
      if (relativeTime >= 0 && relativeTime <= clip.duration) {
        if (track.type === 'audio') {
          // For audio clips, update volume keyframes
          updateClipTransform(clipId, 'volume', value, relativeTime, shouldSaveHistory);
        } else {
          // For video clips, update opacity keyframes
          updateClipTransform(clipId, 'opacity', value, relativeTime, shouldSaveHistory);
        }
      }
    });
  };

  const updateTransformProperty = (property: string, value: any, shouldSaveHistory: boolean = false) => {
    const selectedClips = getSelectedClips();
    if (selectedClips.length === 0) return;
    
    const currentTime = project.timeline.currentTime;
    
    // Apply to all selected clips
    selectedClips.forEach(({ id: clipId, clip }) => {
      if (!clip) return;
      
      const clipStart = clip.start;
      const relativeTime = currentTime - clipStart;
      
      // Only update if playhead is within the clip's time range
      if (relativeTime >= 0 && relativeTime <= clip.duration) {
        updateClipTransform(clipId, property, value, relativeTime, shouldSaveHistory);
      }
    });
  };

  const hasKeyframeAtCurrentTime = (property: string, relativeTime: number) => {
    const selectedClips = getSelectedClips();
    
    // Return true if ANY of the selected clips has a keyframe at this time
    return selectedClips.some(({ clip, track }) => {
      if (!clip) return false;
      
      const currentTime = project.timeline.currentTime;
      const clipStart = clip.start;
      const clipRelativeTime = currentTime - clipStart;
      
      // Only check clips where the playhead is within their time range
      if (clipRelativeTime < 0 || clipRelativeTime > clip.duration) return false;
      
      const keyframes = (clip.keyframes as any)?.[property] || (clip.audioKeyframes as any)?.[property];
      if (!keyframes) return false;
      
      return keyframes.some((kf: any) => Math.abs(kf.time - clipRelativeTime) < 0.01);
    });
  };

  const getCurrentKeyframeEasing = (property: string) => {
    const selectedClips = getSelectedClips();
    if (selectedClips.length === 0) return 'linear';
    
    const currentTime = project.timeline.currentTime;
    
    // Get easing from the first clip with a keyframe at current time
    for (const { clip, track } of selectedClips) {
      if (!clip) continue;
      
      const clipStart = clip.start;
      const clipRelativeTime = currentTime - clipStart;
      
      // Only check clips where the playhead is within their time range
      if (clipRelativeTime < 0 || clipRelativeTime > clip.duration) continue;
      
      const keyframes = (clip.keyframes as any)?.[property] || (clip.audioKeyframes as any)?.[property];
      if (!keyframes) continue;
      
      const keyframe = keyframes.find((kf: any) => Math.abs(kf.time - clipRelativeTime) < 0.01);
      if (keyframe) {
        return keyframe.easing || 'linear';
      }
    }
    
    return 'linear';
  };

  const getActiveKeyframeEasing = () => {
    const selectedClips = getSelectedClips();
    if (selectedClips.length === 0) return 'linear';
    
    const currentTime = project.timeline.currentTime;
    const easingTypes = new Set<string>();
    
    // Check all properties that have keyframes at current time
    ['position', 'rotation', 'scale', 'opacity', 'volume'].forEach(property => {
      selectedClips.forEach(({ clip, track }) => {
        if (!clip) return;
        
        const clipStart = clip.start;
        const clipRelativeTime = currentTime - clipStart;
        
        // Only check clips where the playhead is within their time range
        if (clipRelativeTime < 0 || clipRelativeTime > clip.duration) return;
        
        const keyframes = (clip.keyframes as any)?.[property] || (clip.audioKeyframes as any)?.[property];
        if (!keyframes) return;
        
        const hasKeyframe = keyframes.some((kf: any) => Math.abs(kf.time - clipRelativeTime) < 0.01);
        if (hasKeyframe) {
          const keyframe = keyframes.find((kf: any) => Math.abs(kf.time - clipRelativeTime) < 0.01);
          easingTypes.add(keyframe?.easing || 'linear');
        }
      });
    });
    
    // Return the most common easing type, or 'linear' if mixed
    if (easingTypes.size === 1) {
      return Array.from(easingTypes)[0];
    }
    
    return 'linear'; // Default when mixed or no keyframes
  };

  const updateCurrentKeyframeEasing = (property: string, easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out') => {
    const selectedClips = getSelectedClips();
    if (selectedClips.length === 0) return;
    
    const currentTime = project.timeline.currentTime;
    
    // Update easing for all selected clips that have a keyframe at current time
    selectedClips.forEach(({ id: clipId, clip }) => {
      if (!clip) return;
      
      const clipStart = clip.start;
      const clipRelativeTime = currentTime - clipStart;
      
      // Only update if playhead is within the clip's time range
      if (clipRelativeTime >= 0 && clipRelativeTime <= clip.duration) {
        const keyframes = (clip.keyframes as any)?.[property] || (clip.audioKeyframes as any)?.[property];
        if (!keyframes) return;
        
        const hasKeyframe = keyframes.some((kf: any) => Math.abs(kf.time - clipRelativeTime) < 0.01);
        if (hasKeyframe) {
          updateKeyframeEasing(clipId, property, clipRelativeTime, easing);
        }
      }
    });
  };

  const selectedClips = getSelectedClips();
  
  if (selectedClips.length === 0) {
    // Show project properties when no clips are selected
    return (
      <div style={{ padding: '8px' }}>
        <h3 style={{ 
          margin: '0 0 8px 0', 
          fontSize: '12px', 
          color: '#fff',
          borderBottom: '1px solid #444',
          paddingBottom: '4px'
        }}>
          Project Properties
        </h3>
        
        <div style={{ marginBottom: '10px' }}>
          <label style={{ 
            display: 'block',
            fontSize: '10px', 
            color: '#ccc', 
            marginBottom: '3px' 
          }}>
            📁 Project Name
          </label>
          <input
            type="text"
            value={project.name}
            onChange={(e) => setProject({ ...project, name: e.target.value })}
            style={{ 
              width: '100%', 
              fontSize: '10px', 
              padding: '4px 6px',
              backgroundColor: '#333',
              border: '1px solid #555',
              borderRadius: '2px',
              color: '#fff',
              boxSizing: 'border-box'
            }}
            placeholder="Enter project name"
          />
        </div>
        
        <div style={{ marginBottom: '10px' }}>
          <label style={{ 
            display: 'block',
            fontSize: '10px', 
            color: '#ccc', 
            marginBottom: '3px' 
          }}>
            📐 Canvas Size
          </label>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <input
              type="number"
              value={project.canvasWidth}
              onChange={(e) => setProject({ ...project, canvasWidth: parseInt(e.target.value) || 1920 })}
              style={{ 
                width: '60px', 
                fontSize: '9px', 
                padding: '2px 4px',
                backgroundColor: '#333',
                border: '1px solid #555',
                borderRadius: '2px',
                color: '#fff',
                textAlign: 'center'
              }}
            />
            <span style={{ fontSize: '9px', color: '#888' }}>×</span>
            <input
              type="number"
              value={project.canvasHeight}
              onChange={(e) => setProject({ ...project, canvasHeight: parseInt(e.target.value) || 1080 })}
              style={{ 
                width: '60px', 
                fontSize: '9px', 
                padding: '2px 4px',
                backgroundColor: '#333',
                border: '1px solid #555',
                borderRadius: '2px',
                color: '#fff',
                textAlign: 'center'
              }}
            />
          </div>
        </div>
        
        <div style={{ marginBottom: '10px' }}>
          <label style={{ 
            display: 'block',
            fontSize: '10px', 
            color: '#ccc', 
            marginBottom: '3px' 
          }}>
            🎬 Frame Rate (FPS)
          </label>
          <input
            type="number"
            min="1"
            max="240"
            value={project.timeline.fps}
            onChange={(e) => {
              const fps = parseInt(e.target.value) || 30;
              if (fps >= 1 && fps <= 240) {
                setFPS(fps);
              }
            }}
            style={{ 
              width: '100%', 
              fontSize: '9px', 
              padding: '4px 6px',
              backgroundColor: '#333',
              border: '1px solid #555',
              borderRadius: '2px',
              color: '#fff',
              boxSizing: 'border-box',
              textAlign: 'center'
            }}
          />
                     <div style={{ 
             fontSize: '8px', 
             color: '#888', 
             marginTop: '2px' 
           }}>
             Frame duration: {(1000/project.timeline.fps).toFixed(1)}ms<br/>
             Common: 24 (cinema), 30 (NTSC), 60 (smooth)
           </div>
        </div>
        
        <div style={{ marginBottom: '10px' }}>
          <label style={{ 
            display: 'block',
            fontSize: '10px', 
            color: '#ccc', 
            marginBottom: '3px' 
          }}>
            🎨 Background Color
          </label>
          <input
            type="color"
            value={project.backgroundColor}
            onChange={(e) => setProject({ ...project, backgroundColor: e.target.value })}
            style={{ 
              width: '100%', 
              height: '24px',
              backgroundColor: '#333',
              border: '1px solid #555',
              borderRadius: '2px',
              cursor: 'pointer'
            }}
          />
        </div>
        
        <div style={{ 
          fontSize: '8px', 
          color: '#666', 
          marginTop: '12px',
          paddingTop: '8px',
          borderTop: '1px solid #333',
          textAlign: 'center'
        }}>
          Select clip(s) to edit clip properties
        </div>
      </div>
    );
  }

  const currentTime = project.timeline.currentTime;
  
  // For display purposes, use the first selected clip or canvas selected clip
  const primaryClip = selectedClips.find(item => item.id === canvasSelectedClipId) || selectedClips[0];
  if (!primaryClip || !primaryClip.clip || !primaryClip.track) {
    return (
      <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
        Selected clip not found
      </div>
    );
  }

  const { clip, track } = primaryClip;
  const clipStart = clip.start;
  const relativeTime = currentTime - clipStart;
  
  const transform = getClipTransform(clip.id, relativeTime) || { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };
  
  const isAudioTrack = track.type === 'audio';
  const propertyLabel = isAudioTrack ? 'Volume' : 'Opacity';
  
  // Get current values from transform (with volume handling for audio tracks)
  const currentPosition = { x: transform.x, y: transform.y };
  const currentRotation = transform.rotation;
  const currentScale = { scaleX: transform.scaleX, scaleY: transform.scaleY };
  
  // Handle opacity/volume separately since audio tracks use audioKeyframes
  let currentOpacityVolume = transform.opacity;
  if (isAudioTrack && clip.audioKeyframes?.volume) {
    const volumeKeyframes = clip.audioKeyframes.volume;
    if (volumeKeyframes.length > 0) {
      const sorted = [...volumeKeyframes].sort((a, b) => a.time - b.time);
      const current = sorted.find(kf => Math.abs(kf.time - relativeTime) < 0.01);
      if (current) {
        currentOpacityVolume = current.value;
      } else {
        const before = sorted.filter(kf => kf.time <= relativeTime).pop();
        const after = sorted.find(kf => kf.time > relativeTime);
        if (before && after) {
          const t = (relativeTime - before.time) / (after.time - before.time);
          currentOpacityVolume = before.value + (after.value - before.value) * t;
        } else if (before) {
          currentOpacityVolume = before.value;
        } else if (after) {
          currentOpacityVolume = after.value;
        }
      }
    }
  }

  return (
    <div style={{ padding: '8px' }}>
      <h3 style={{ 
        margin: '0 0 8px 0', 
        fontSize: '12px', 
        color: '#fff',
        borderBottom: '1px solid #444',
        paddingBottom: '4px'
      }}>
        Properties {selectedClips.length > 1 ? `(${selectedClips.length} clips)` : ''}
      </h3>
      
      <div style={{ marginBottom: '8px' }}>
        <div style={{ 
          fontSize: '10px', 
          color: '#aaa', 
          marginBottom: '2px' 
        }}>
          {selectedClips.length > 1 ? 'Multiple clips selected' : 
           (clip.assetId && project.assets.find(a => a.id === clip.assetId)?.name || 'Unknown')}
        </div>
        <div style={{ 
          fontSize: '9px', 
          color: '#888' 
        }}>
          {selectedClips.length > 1 ? 
            `${selectedClips.filter(s => s.track?.type === 'video').length} video, ${selectedClips.filter(s => s.track?.type === 'audio').length} audio` :
            `${track.name} • ${track.type.toUpperCase()}`
          }
        </div>
      </div>

      {/* Position Controls */}
      {!isAudioTrack && (
        <div style={{ marginBottom: '10px' }}>
          <label style={{ 
            display: 'flex', 
            alignItems: 'center',
            fontSize: '10px', 
            color: '#ccc', 
            marginBottom: '3px' 
          }}>
            📍 Position
            {hasKeyframeAtCurrentTime('position', relativeTime) && (
              <span style={{ color: '#4CAF50', marginLeft: '4px', fontSize: '8px' }}>●</span>
            )}
          </label>
          
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ fontSize: '9px', color: '#888', width: '10px' }}>X</span>
            <input
              type="number"
              step="1"
              value={editingInput === 'posX' ? inputValues.posX || '' : Math.round(currentPosition.x).toString()}
              onFocus={(e) => {
                startInteraction('Change position');
                handleInputFocus('posX', Math.round(currentPosition.x).toString(), e);
              }}
              onBlur={() => {
                handleInputBlur('posX', (value) => {
                  const numValue = parseFloat(value);
                  if (!isNaN(numValue)) {
                    updateTransformProperty('position', { 
                      x: numValue, 
                      y: currentPosition.y 
                    }, false);
                  }
                });
                endInteraction('Change position');
              }}
              onChange={(e) => {
                handleInputChange('posX', e.target.value, (value) => {
                  const numValue = parseFloat(value);
                  if (!isNaN(numValue)) {
                    updateTransformProperty('position', { 
                      x: numValue, 
                      y: currentPosition.y 
                    }, false);
                  }
                });
              }}
              style={{ 
                width: '40px', 
                fontSize: '9px', 
                padding: '1px 3px',
                backgroundColor: '#333',
                border: '1px solid #555',
                borderRadius: '2px',
                color: '#fff',
                textAlign: 'center'
              }}
            />
            <span style={{ fontSize: '9px', color: '#888', width: '10px' }}>Y</span>
            <input
              type="number"
              step="1"
              value={editingInput === 'posY' ? inputValues.posY || '' : Math.round(currentPosition.y).toString()}
              onFocus={(e) => {
                startInteraction('Change position');
                handleInputFocus('posY', Math.round(currentPosition.y).toString(), e);
              }}
              onBlur={() => {
                handleInputBlur('posY', (value) => {
                  const numValue = parseFloat(value);
                  if (!isNaN(numValue)) {
                    updateTransformProperty('position', { 
                      x: currentPosition.x, 
                      y: numValue 
                    }, false);
                  }
                });
                endInteraction('Change position');
              }}
              onChange={(e) => {
                handleInputChange('posY', e.target.value, (value) => {
                  const numValue = parseFloat(value);
                  if (!isNaN(numValue)) {
                    updateTransformProperty('position', { 
                      x: currentPosition.x, 
                      y: numValue 
                    }, false);
                  }
                });
              }}
              style={{ 
                width: '40px', 
                fontSize: '9px', 
                padding: '1px 3px',
                backgroundColor: '#333',
                border: '1px solid #555',
                borderRadius: '2px',
                color: '#fff',
                textAlign: 'center'
              }}
            />
          </div>
        </div>
      )}

      {/* Rotation Control */}
      {!isAudioTrack && (
        <div style={{ marginBottom: '10px' }}>
          <label style={{ 
            display: 'flex', 
            alignItems: 'center',
            fontSize: '10px', 
            color: '#ccc', 
            marginBottom: '3px' 
          }}>
            🔄 Rotation
            {hasKeyframeAtCurrentTime('rotation', relativeTime) && (
              <span style={{ color: '#4CAF50', marginLeft: '4px', fontSize: '8px' }}>●</span>
            )}
          </label>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={currentRotation}
              onMouseDown={() => startInteraction('Change rotation')}
              onMouseUp={() => endInteraction('Change rotation')}
              onChange={(e) => updateTransformProperty('rotation', parseFloat(e.target.value), false)}
              style={{ 
                flex: 1, 
                height: '3px',
                background: '#444',
                outline: 'none',
                appearance: 'none',
                borderRadius: '2px'
              }}
            />
            <input
              type="number"
              min="-180"
              max="180"
              step="1"
              value={editingInput === 'rotation' ? inputValues.rotation || '' : Math.round(currentRotation).toString()}
              onFocus={(e) => {
                startInteraction('Change rotation');
                handleInputFocus('rotation', Math.round(currentRotation).toString(), e);
              }}
              onBlur={() => {
                handleInputBlur('rotation', (value) => {
                  const numValue = parseFloat(value);
                  if (!isNaN(numValue)) {
                    updateTransformProperty('rotation', numValue, false);
                  }
                });
                endInteraction('Change rotation');
              }}
              onChange={(e) => {
                handleInputChange('rotation', e.target.value, (value) => {
                  const numValue = parseFloat(value);
                  if (!isNaN(numValue)) {
                    updateTransformProperty('rotation', numValue, false);
                  }
                });
              }}
              style={{ 
                width: '35px', 
                fontSize: '9px', 
                padding: '1px 3px',
                backgroundColor: '#333',
                border: '1px solid #555',
                borderRadius: '2px',
                color: '#fff',
                textAlign: 'center'
              }}
            />
            <span style={{ fontSize: '9px', color: '#888' }}>°</span>
          </div>
        </div>
      )}

      {/* Scale Controls */}
      {!isAudioTrack && (
        <div style={{ marginBottom: '10px' }}>
          <label style={{ 
            display: 'flex', 
            alignItems: 'center',
            fontSize: '10px', 
            color: '#ccc', 
            marginBottom: '3px' 
          }}>
            📏 Scale
            {hasKeyframeAtCurrentTime('scale', relativeTime) && (
              <span style={{ color: '#4CAF50', marginLeft: '4px', fontSize: '8px' }}>●</span>
            )}
          </label>
          
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ fontSize: '9px', color: '#888', width: '10px' }}>X</span>
            <input
              type="number"
              min="0.1"
              max="5"
              step="0.1"
              value={editingInput === 'scaleX' ? inputValues.scaleX || '' : currentScale.scaleX.toFixed(1)}
              onFocus={(e) => {
                startInteraction('Change scale');
                handleInputFocus('scaleX', currentScale.scaleX.toFixed(1), e);
              }}
              onBlur={() => {
                handleInputBlur('scaleX', (value) => {
                  const numValue = parseFloat(value);
                  if (!isNaN(numValue) && numValue > 0) {
                    updateTransformProperty('scale', { 
                      scaleX: numValue, 
                      scaleY: currentScale.scaleY 
                    }, false);
                  }
                });
                endInteraction('Change scale');
              }}
              onChange={(e) => {
                handleInputChange('scaleX', e.target.value, (value) => {
                  const numValue = parseFloat(value);
                  if (!isNaN(numValue) && numValue > 0) {
                    updateTransformProperty('scale', { 
                      scaleX: numValue, 
                      scaleY: currentScale.scaleY 
                    }, false);
                  }
                });
              }}
              style={{ 
                width: '40px', 
                fontSize: '9px', 
                padding: '1px 3px',
                backgroundColor: '#333',
                border: '1px solid #555',
                borderRadius: '2px',
                color: '#fff',
                textAlign: 'center'
              }}
            />
            <span style={{ fontSize: '9px', color: '#888', width: '10px' }}>Y</span>
            <input
              type="number"
              min="0.1"
              max="5"
              step="0.1"
              value={editingInput === 'scaleY' ? inputValues.scaleY || '' : currentScale.scaleY.toFixed(1)}
              onFocus={(e) => {
                startInteraction('Change scale');
                handleInputFocus('scaleY', currentScale.scaleY.toFixed(1), e);
              }}
              onBlur={() => {
                handleInputBlur('scaleY', (value) => {
                  const numValue = parseFloat(value);
                  if (!isNaN(numValue) && numValue > 0) {
                    updateTransformProperty('scale', { 
                      scaleX: currentScale.scaleX, 
                      scaleY: numValue 
                    }, false);
                  }
                });
                endInteraction('Change scale');
              }}
              onChange={(e) => {
                handleInputChange('scaleY', e.target.value, (value) => {
                  const numValue = parseFloat(value);
                  if (!isNaN(numValue) && numValue > 0) {
                    updateTransformProperty('scale', { 
                      scaleX: currentScale.scaleX, 
                      scaleY: numValue 
                    }, false);
                  }
                });
              }}
              style={{ 
                width: '40px', 
                fontSize: '9px', 
                padding: '1px 3px',
                backgroundColor: '#333',
                border: '1px solid #555',
                borderRadius: '2px',
                color: '#fff',
                textAlign: 'center'
              }}
            />
          </div>
          
          {/* Scale to fit buttons */}
          <div style={{ 
            display: 'flex', 
            gap: '2px', 
            marginTop: '3px' 
          }}>
            <button
              onClick={() => {
                // Scale to fit canvas width
                const asset = project.assets.find(a => a.id === clip.assetId);
                if (asset && asset.width && asset.height) {
                  const scaleX = project.canvasWidth / asset.width;
                  updateTransformProperty('scale', { 
                    scaleX: scaleX, 
                    scaleY: scaleX 
                  }, true);
                }
              }}
              style={{ 
                fontSize: '8px', 
                padding: '1px 3px',
                backgroundColor: '#4a90e2',
                color: '#fff',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer'
              }}
              title="Scale to fit canvas width"
            >
              📐 X
            </button>
            <button
              onClick={() => {
                // Scale to fit canvas height  
                const asset = project.assets.find(a => a.id === clip.assetId);
                if (asset && asset.width && asset.height) {
                  const scaleY = project.canvasHeight / asset.height;
                  updateTransformProperty('scale', { 
                    scaleX: scaleY, 
                    scaleY: scaleY 
                  }, true);
                }
              }}
              style={{ 
                fontSize: '8px', 
                padding: '1px 3px',
                backgroundColor: '#4a90e2',
                color: '#fff',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer'
              }}
              title="Scale to fit canvas height"
            >
              📐 Y
            </button>
            <button
              onClick={() => {
                updateTransformProperty('scale', { 
                  scaleX: 1, 
                  scaleY: 1 
                }, true);
              }}
              style={{ 
                fontSize: '8px', 
                padding: '1px 3px',
                backgroundColor: '#444',
                color: '#fff',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer'
              }}
            >
              1:1
            </button>
          </div>
        </div>
      )}

      {/* Opacity/Volume Control */}
      <div style={{ marginBottom: '10px' }}>
        <label style={{ 
          display: 'flex', 
          alignItems: 'center',
          fontSize: '10px', 
          color: '#ccc', 
          marginBottom: '3px' 
        }}>
          {isAudioTrack ? '🔊' : '👁️'} {propertyLabel}
          {hasKeyframeAtCurrentTime(isAudioTrack ? 'volume' : 'opacity', relativeTime) && (
            <span style={{ color: '#4CAF50', marginLeft: '4px', fontSize: '8px' }}>●</span>
          )}
        </label>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={currentOpacityVolume}
            onMouseDown={() => startInteraction(`Change ${isAudioTrack ? 'volume' : 'opacity'}`)}
            onMouseUp={() => endInteraction(`Change ${isAudioTrack ? 'volume' : 'opacity'}`)}
            onChange={(e) => updateOpacityVolume(parseFloat(e.target.value), false)}
            style={{ 
              flex: 1, 
              height: '3px',
              background: '#444',
              outline: 'none',
              appearance: 'none',
              borderRadius: '2px'
            }}
          />
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={editingInput === 'opacityVolume' ? inputValues.opacityVolume || '' : currentOpacityVolume.toFixed(2)}
            onFocus={(e) => {
              startInteraction(`Change ${isAudioTrack ? 'volume' : 'opacity'}`);
              handleInputFocus('opacityVolume', currentOpacityVolume.toFixed(2), e);
            }}
            onBlur={() => {
              handleInputBlur('opacityVolume', (value) => {
                const numValue = parseFloat(value);
                if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) {
                  updateOpacityVolume(numValue, false);
                }
              });
              endInteraction(`Change ${isAudioTrack ? 'volume' : 'opacity'}`);
            }}
            onChange={(e) => {
              handleInputChange('opacityVolume', e.target.value, (value) => {
                const numValue = parseFloat(value);
                if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) {
                  updateOpacityVolume(numValue, false);
                }
              });
            }}
            style={{ 
              width: '40px', 
              fontSize: '9px', 
              padding: '1px 3px',
              backgroundColor: '#333',
              border: '1px solid #555',
              borderRadius: '2px',
              color: '#fff',
              textAlign: 'center'
            }}
          />
        </div>
        
        <div style={{ 
          display: 'flex', 
          gap: '3px', 
          marginTop: '3px' 
        }}>
          <button
            onClick={() => updateOpacityVolume(0, true)}
            style={{ 
              fontSize: '8px', 
              padding: '1px 4px',
              backgroundColor: '#444',
              color: '#fff',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer'
            }}
          >
            0%
          </button>
          <button
            onClick={() => updateOpacityVolume(0.5, true)}
            style={{ 
              fontSize: '8px', 
              padding: '1px 4px',
              backgroundColor: '#444',
              color: '#fff',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer'
            }}
          >
            50%
          </button>
          <button
            onClick={() => updateOpacityVolume(1, true)}
            style={{ 
              fontSize: '8px', 
              padding: '1px 4px',
              backgroundColor: '#444',
              color: '#fff',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer'
            }}
          >
            100%
          </button>
        </div>
      </div>

      {/* Playback Speed Control */}
      <div style={{ marginBottom: '10px' }}>
        <label style={{ 
          display: 'flex', 
          alignItems: 'center',
          fontSize: '10px', 
          color: '#ccc', 
          marginBottom: '3px' 
        }}>
          ⚡ Playback Speed
        </label>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="range"
            min="0.1"
            max="4"
            step="0.1"
            value={clip.playbackSpeed || 1}
            onMouseDown={() => startInteraction('Change playback speed')}
            onMouseUp={() => endInteraction('Change playback speed')}
            onChange={(e) => {
              const newSpeed = parseFloat(e.target.value);
              selectedClips.forEach(({ id }) => {
                updateClip(id, { playbackSpeed: newSpeed }, false);
              });
            }}
            style={{ 
              flex: 1, 
              height: '3px',
              background: '#444',
              outline: 'none',
              appearance: 'none',
              borderRadius: '2px'
            }}
          />
          <input
            type="number"
            min="0.1"
            max="4"
            step="0.1"
            value={editingInput === 'playbackSpeed' ? inputValues.playbackSpeed || '' : (clip.playbackSpeed || 1).toFixed(1)}
            onFocus={(e) => {
              startInteraction('Change playback speed');
              handleInputFocus('playbackSpeed', (clip.playbackSpeed || 1).toFixed(1), e);
            }}
            onBlur={() => {
              handleInputBlur('playbackSpeed', (value) => {
                const numValue = parseFloat(value);
                if (!isNaN(numValue) && numValue > 0) {
                  selectedClips.forEach(({ id }) => {
                    updateClip(id, { playbackSpeed: numValue }, false);
                  });
                }
              });
              endInteraction('Change playback speed');
            }}
            onChange={(e) => {
              handleInputChange('playbackSpeed', e.target.value, (value) => {
                const numValue = parseFloat(value);
                if (!isNaN(numValue) && numValue > 0) {
                  selectedClips.forEach(({ id }) => {
                    updateClip(id, { playbackSpeed: numValue }, false);
                  });
                }
              });
            }}
            style={{ 
              width: '40px', 
              fontSize: '9px', 
              padding: '1px 3px',
              backgroundColor: '#333',
              border: '1px solid #555',
              borderRadius: '2px',
              color: '#fff',
              textAlign: 'center'
            }}
          />
          <span style={{ fontSize: '9px', color: '#888' }}>×</span>
        </div>
        
        <div style={{ 
          display: 'flex', 
          gap: '3px', 
          marginTop: '3px' 
        }}>
          <button
            onClick={() => {
              selectedClips.forEach(({ id }) => {
                updateClip(id, { playbackSpeed: 0.5 }, true);
              });
            }}
            style={{ 
              fontSize: '8px', 
              padding: '1px 4px',
              backgroundColor: '#444',
              color: '#fff',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer'
            }}
          >
            0.5×
          </button>
          <button
            onClick={() => {
              selectedClips.forEach(({ id }) => {
                updateClip(id, { playbackSpeed: 1 }, true);
              });
            }}
            style={{ 
              fontSize: '8px', 
              padding: '1px 4px',
              backgroundColor: '#444',
              color: '#fff',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer'
            }}
          >
            1×
          </button>
          <button
            onClick={() => {
              selectedClips.forEach(({ id }) => {
                updateClip(id, { playbackSpeed: 2 }, true);
              });
            }}
            style={{ 
              fontSize: '8px', 
              padding: '1px 4px',
              backgroundColor: '#444',
              color: '#fff',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer'
            }}
          >
            2×
          </button>
        </div>
      </div>

      {/* Keyframe Easing Controls */}
      {(hasKeyframeAtCurrentTime('position', relativeTime) || 
        hasKeyframeAtCurrentTime('rotation', relativeTime) || 
        hasKeyframeAtCurrentTime('scale', relativeTime) || 
        hasKeyframeAtCurrentTime('opacity', relativeTime) ||
        hasKeyframeAtCurrentTime('volume', relativeTime)) && (
        <div style={{ marginBottom: '10px' }}>
          <label style={{ 
            display: 'flex', 
            alignItems: 'center',
            fontSize: '10px', 
            color: '#ccc', 
            marginBottom: '3px' 
          }}>
            🎯 Keyframe Easing
          </label>
          
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr', 
            gap: '3px' 
          }}>
            <button
              onClick={() => {
                ['position', 'rotation', 'scale', 'opacity', 'volume'].forEach(prop => {
                  if (hasKeyframeAtCurrentTime(prop, relativeTime)) {
                    updateCurrentKeyframeEasing(prop, 'linear');
                  }
                });
              }}
              style={{ 
                fontSize: '8px', 
                padding: '2px 4px',
                backgroundColor: getActiveKeyframeEasing() === 'linear' ? '#4CAF50' : '#444',
                color: '#fff',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer'
              }}
            >
              Linear
            </button>
            <button
              onClick={() => {
                ['position', 'rotation', 'scale', 'opacity', 'volume'].forEach(prop => {
                  if (hasKeyframeAtCurrentTime(prop, relativeTime)) {
                    updateCurrentKeyframeEasing(prop, 'ease-in');
                  }
                });
              }}
              style={{ 
                fontSize: '8px', 
                padding: '2px 4px',
                backgroundColor: getActiveKeyframeEasing() === 'ease-in' ? '#4CAF50' : '#444',
                color: '#fff',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer'
              }}
            >
              Ease In
            </button>
            <button
              onClick={() => {
                ['position', 'rotation', 'scale', 'opacity', 'volume'].forEach(prop => {
                  if (hasKeyframeAtCurrentTime(prop, relativeTime)) {
                    updateCurrentKeyframeEasing(prop, 'ease-out');
                  }
                });
              }}
              style={{ 
                fontSize: '8px', 
                padding: '2px 4px',
                backgroundColor: getActiveKeyframeEasing() === 'ease-out' ? '#4CAF50' : '#444',
                color: '#fff',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer'
              }}
            >
              Ease Out
            </button>
            <button
              onClick={() => {
                ['position', 'rotation', 'scale', 'opacity', 'volume'].forEach(prop => {
                  if (hasKeyframeAtCurrentTime(prop, relativeTime)) {
                    updateCurrentKeyframeEasing(prop, 'ease-in-out');
                  }
                });
              }}
              style={{ 
                fontSize: '8px', 
                padding: '2px 4px',
                backgroundColor: getActiveKeyframeEasing() === 'ease-in-out' ? '#4CAF50' : '#444',
                color: '#fff',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer'
              }}
            >
              Ease In-Out
            </button>
          </div>
          
          <div style={{ 
            fontSize: '8px', 
            color: '#888', 
            marginTop: '2px',
            lineHeight: '1.1'
          }}>
            Controls animation between keyframes
          </div>
        </div>
      )}

      <div style={{ 
        fontSize: '8px', 
        color: '#666', 
        marginTop: '8px',
        paddingTop: '6px',
        borderTop: '1px solid #333',
        lineHeight: '1.2'
      }}>
        Use O, P, R, T keys to create keyframes<br/>
        Green ● indicates keyframe at current time
        {selectedClips.length > 1 && (
          <><br/>Multi-clip: Changes apply to all selected clips within playhead range</>
        )}
      </div>
    </div>
  );
};

function App() {
  const { playback, play, pause, stop, seek, project, undo, redo, saveHistory, history, saveInitialHistory, showPNGViewer } = useEditorStore();
  const [timelineHeight, setTimelineHeight] = useState(200);
  const [isDragging, setIsDragging] = useState(false);
  const appRef = useRef<HTMLDivElement>(null);

  // Save initial history snapshot
  useEffect(() => {
    if (history.length === 0) {
      saveInitialHistory();
    }
  }, []);

  useEffect(() => {
    // Enable audio context for web audio
    const enableAudioContext = () => {
      // This helps with browser autoplay policies
      project.assets.forEach(asset => {
        if (asset.type === 'audio' && asset.element) {
          const audio = asset.element as HTMLAudioElement;
          audio.muted = false;
          // Prime the audio for playback
          audio.play().then(() => {
            audio.pause();
            audio.currentTime = 0;
          }).catch(() => {
            // Ignore errors from priming
          });
        }
      });
    };

    // Enable audio context on first user interaction
    const handleFirstInteraction = () => {
      enableAudioContext();
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
    };

    document.addEventListener('click', handleFirstInteraction);
    document.addEventListener('keydown', handleFirstInteraction);

    return () => {
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
    };
  }, [project.assets]);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Prevent default if focusing on input elements, dropdowns, or other interactive elements
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.contentEditable === 'true') {
        return;
      }
      
      // Also check if we're inside a dropdown or other interactive element
      if (target.closest('select') || target.closest('[contenteditable="true"]') || target.closest('.dropdown') || target.closest('[role="listbox"]')) {
        return;
      }

      // Handle Ctrl+Z (Undo) and Ctrl+Y (Redo)
      if (e.ctrlKey) {
        switch (e.code) {
          case 'KeyZ':
            e.preventDefault();
            undo();
            break;
          case 'KeyY':
            e.preventDefault();
            redo();
            break;
        }
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          e.stopPropagation();
          console.log('Spacebar pressed, isPlaying:', playback.isPlaying);
          if (playback.isPlaying) {
            pause();
          } else {
            play();
          }
          break;
        case 'Home':
          e.preventDefault();
          stop();
          break;
        case 'Escape':
          e.preventDefault();
          pause();
          break;
        case 'Comma':
        case 'ArrowLeft':
          e.preventDefault();
          // Move back one frame
          const prevFrameTime = Math.max(0, project.timeline.currentTime - (1 / project.timeline.fps));
          seek(prevFrameTime);
          break;
        case 'Period':
        case 'ArrowRight':
          e.preventDefault();
          // Move forward one frame
          const nextFrameTime = Math.min(project.timeline.duration, project.timeline.currentTime + (1 / project.timeline.fps));
          seek(nextFrameTime);
          break;
      }
    };

    // Add event listener to document for keyboard events
    document.addEventListener('keydown', handleKeyPress, true);
    
    return () => {
      document.removeEventListener('keydown', handleKeyPress, true);
    };
  }, [playback.isPlaying, play, pause, stop, seek, undo, redo, project.timeline.currentTime, project.timeline.fps, project.timeline.duration]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !appRef.current) return;
      
      const appRect = appRef.current.getBoundingClientRect();
      const newHeight = appRect.bottom - e.clientY;
      const minHeight = 150;
      const maxHeight = window.innerHeight - 200; // Leave space for toolbar and canvas
      
      setTimelineHeight(Math.max(minHeight, Math.min(newHeight, maxHeight)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  return (
    <div 
      className="app" 
      ref={appRef}
      tabIndex={0}
      style={{ outline: 'none' }}
      onFocus={() => console.log('App focused')}
      onClick={(e) => {
        // Only focus if clicking on the app background, not on interactive elements
        const target = e.target as HTMLElement;
        if (target.tagName === 'SELECT' || target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA') {
          return;
        }
        
        // Also check if we're clicking inside dropdown containers or interactive elements
        if (target.closest('select') || target.closest('.dropdown') || target.closest('[role="listbox"]') || target.closest('button') || target.closest('input')) {
          return;
        }
        
        // Ensure the app has focus for keyboard events only when clicking on non-interactive areas
        if (appRef.current) {
          appRef.current.focus();
        }
      }}
    >
      <Toolbar />
      <div className="main-content">
        <div className="sidebar">
          <AssetBrowser />
        </div>
        <div className="canvas-area">
          <Canvas />
        </div>
      </div>
      
      {/* Resize handle */}
      <div 
        className="timeline-resize-handle"
        onMouseDown={handleResizeStart}
        style={{
          cursor: isDragging ? 'row-resize' : 'row-resize',
          userSelect: 'none'
        }}
      />
      
      <div 
        className="timeline-area" 
        style={{ 
          height: `${timelineHeight}px`,
          display: 'flex'
        }}
      >
        {/* Property Panel on the left */}
        <div style={{ 
          width: '220px', 
          borderRight: '1px solid #444',
          backgroundColor: '#2a2a2a',
          flexShrink: 0,
          overflowY: 'auto'
        }}>
          <PropertyPanel />
        </div>
        
        {/* Timeline content */}
        <div style={{ flex: 1 }}>
          <Timeline />
        </div>
      </div>
      
      {/* PNG Flipbook Viewer Modal */}
      {showPNGViewer && (
        <div className="png-viewer-modal">
          <PNGFlipbookViewer />
        </div>
      )}
    </div>
  );
}

export default App; 