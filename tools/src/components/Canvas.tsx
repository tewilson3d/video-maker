import React, { useRef, useEffect, useState } from 'react';
import { useEditorStore } from '../store';
import { Asset, Clip, Project } from '../types';
import { interpolateWithEasing } from '../utils/easing';
import AIChatBox from './AIChatBox';

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

interface TransformHandle {
  x: number;
  y: number;
  type: 'corner' | 'edge' | 'rotate';
  cursor: string;
  corner?: 'tl' | 'tr' | 'bl' | 'br';
  edge?: 'top' | 'bottom' | 'left' | 'right';
}

const Canvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { 
    project, 
    playback, 
    assetsLoading, 
    canvasSelectedClipId,
    selectCanvasClip,
    getClipAtCanvasPosition,
    updateClipTransform,
    saveHistory,
    getClipTransform: storeGetClipTransform,
    getEffectiveDuration,
    setProject
  } = useEditorStore();

  // Handle AI project updates
  const handleAIProjectUpdate = (newProject: Project) => {
    // Preserve media elements when updating from AI
    const preservedProject = {
      ...newProject,
      assets: newProject.assets.map(newAsset => {
        const currentAsset = project.assets.find(a => a.id === newAsset.id);
        return {
          ...newAsset,
          element: currentAsset?.element, // Preserve the media element
          thumbnail: currentAsset?.thumbnail, // Preserve thumbnail
          waveform: currentAsset?.waveform, // Preserve waveform
        };
      }),
    };
    
    setProject(preservedProject);
    saveHistory('AI Edit');
  };
  
  const [canvasSize, setCanvasSize] = useState({ width: 640, height: 360 });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragType, setDragType] = useState<'move' | 'scale' | 'rotate' | 'pan'>('move');
  const [dragHandle, setDragHandle] = useState<TransformHandle | null>(null);
  const [initialTransform, setInitialTransform] = useState({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
  const [originalCenter, setOriginalCenter] = useState({ x: 0, y: 0 });
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [initialPanOffset, setInitialPanOffset] = useState({ x: 0, y: 0 });
  
  // Fixed zoom levels for easy navigation
  const zoomLevels = [0.1, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0, 5.0, 10.0];

  useEffect(() => {
    const updateCanvasSize = () => {
      if (!canvasRef.current) return;
      
      const container = canvasRef.current.parentElement;
      if (!container) return;

      const containerWidth = container.clientWidth - 40; // Some padding
      const containerHeight = container.clientHeight - 40;
      
      const aspectRatio = project.canvasWidth / project.canvasHeight;
      
      let width = containerWidth;
      let height = width / aspectRatio;
      
      if (height > containerHeight) {
        height = containerHeight;
        width = height * aspectRatio;
      }
      
      // Ensure minimum size
      width = Math.max(width, 320);
      height = Math.max(height, 180);
      
      setCanvasSize({ width, height });
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, [project.canvasWidth, project.canvasHeight]);

  useEffect(() => {
    renderFrame();
    syncVideoElements();
  }, [project, playback.currentTime, canvasSize, playback.isPlaying, zoomLevel, panOffset]);

  // Scroll wheel zoom removed - canvas shows full frame at all times

  // Reset zoom on double-click
  const handleCanvasDoubleClick = () => {
    setZoomLevel(1.0);
    setPanOffset({ x: 0, y: 0 });
  };

  // Keyboard shortcuts for zoom
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return; // Don't handle shortcuts when typing in input fields
      }
      
      if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setZoomLevel(1.0);
        setPanOffset({ x: 0, y: 0 });
      } else if (e.key === '=' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const currentIndex = zoomLevels.findIndex(level => Math.abs(level - zoomLevel) < 0.001);
        const newIndex = currentIndex === -1 ? 
          zoomLevels.findIndex(level => level > zoomLevel) :
          Math.min(zoomLevels.length - 1, currentIndex + 1);
        if (newIndex !== -1) setZoomLevel(zoomLevels[newIndex]);
      } else if (e.key === '-' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const currentIndex = zoomLevels.findIndex(level => Math.abs(level - zoomLevel) < 0.001);
        const newIndex = currentIndex === -1 ? 
          [...zoomLevels].reverse().findIndex(level => level < zoomLevel) :
          Math.max(0, currentIndex - 1);
        if (newIndex !== -1) {
          const actualIndex = currentIndex === -1 ? zoomLevels.length - 1 - newIndex : newIndex;
          setZoomLevel(zoomLevels[actualIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Global mouse handlers for drag operations
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDragging || !canvasSelectedClipId) return;

      const clip = getSelectedClip();
      if (!clip) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      const relativeTime = playback.currentTime - clip.start;

      if (dragType === 'pan') {
        // Pan the canvas
        const newPanX = initialPanOffset.x + deltaX;
        const newPanY = initialPanOffset.y + deltaY;
        setPanOffset({ x: newPanX, y: newPanY });
      } else if (dragType === 'move') {
        // Translate the clip (canvas element handles zoom via CSS transform)
        const newX = initialTransform.x + (deltaX / canvasSize.width) * project.canvasWidth;
        const newY = initialTransform.y + (deltaY / canvasSize.height) * project.canvasHeight;
        
        updateClipTransform(canvasSelectedClipId, 'position', { x: newX, y: newY }, relativeTime);
      } else if (dragType === 'scale' && dragHandle) {
        // Scale the clip based on handle
        let newScaleX = initialTransform.scaleX;
        let newScaleY = initialTransform.scaleY;
        let newX = initialTransform.x;
        let newY = initialTransform.y;
        
        if (dragHandle.corner) {
          if (e.ctrlKey) {
            // Center scaling when holding Ctrl
            if (e.shiftKey) {
              // Non-uniform scaling from center
              const scaleFactorX = 1 + (deltaX / 200);
              const scaleFactorY = 1 + (-deltaY / 200); // Invert Y direction
              newScaleX = Math.max(0.1, initialTransform.scaleX * scaleFactorX);
              newScaleY = Math.max(0.1, initialTransform.scaleY * scaleFactorY);
            } else {
              // Uniform scaling from center
              const initialDist = Math.sqrt(
                Math.pow(dragStart.x - originalCenter.x, 2) + Math.pow(dragStart.y - originalCenter.y, 2)
              );
              const currentDist = Math.sqrt(
                Math.pow(e.clientX - originalCenter.x, 2) + Math.pow(e.clientY - originalCenter.y, 2)
              );
              
              const scaleFactor = initialDist > 0 ? currentDist / initialDist : 1;
              newScaleX = Math.max(0.1, initialTransform.scaleX * scaleFactor);
              newScaleY = Math.max(0.1, initialTransform.scaleY * scaleFactor);
            }
          } else {
            // Anchor scaling from opposite corner (default behavior)
            if (e.shiftKey) {
              // Non-uniform scaling from opposite corner
              const scaleFactorX = 1 + (deltaX / 200);
              const scaleFactorY = 1 + (-deltaY / 200); // Invert Y direction
              newScaleX = Math.max(0.1, initialTransform.scaleX * scaleFactorX);
              newScaleY = Math.max(0.1, initialTransform.scaleY * scaleFactorY);
              
              // Calculate position offset based on anchor point
              const clip = getSelectedClip();
              const asset = clip ? project.assets.find(a => a.id === clip.assetId) : null;
              if (asset?.element) {
                let assetWidth = 100, assetHeight = 100;
                if (asset.element instanceof HTMLVideoElement) {
                  assetWidth = asset.element.videoWidth;
                  assetHeight = asset.element.videoHeight;
                } else if (asset.element instanceof HTMLImageElement) {
                  assetWidth = asset.element.naturalWidth;
                  assetHeight = asset.element.naturalHeight;
                }
                
                // Calculate how much the size changed
                const deltaScaleX = newScaleX - initialTransform.scaleX;
                const deltaScaleY = newScaleY - initialTransform.scaleY;
                
                // Adjust position based on which corner we're dragging
                if (dragHandle.corner === 'tl') {
                  newX = initialTransform.x - (assetWidth * deltaScaleX / 2);
                  newY = initialTransform.y - (assetHeight * deltaScaleY / 2);
                } else if (dragHandle.corner === 'tr') {
                  newX = initialTransform.x + (assetWidth * deltaScaleX / 2);
                  newY = initialTransform.y - (assetHeight * deltaScaleY / 2);
                } else if (dragHandle.corner === 'bl') {
                  newX = initialTransform.x - (assetWidth * deltaScaleX / 2);
                  newY = initialTransform.y + (assetHeight * deltaScaleY / 2);
                } else if (dragHandle.corner === 'br') {
                  newX = initialTransform.x + (assetWidth * deltaScaleX / 2);
                  newY = initialTransform.y + (assetHeight * deltaScaleY / 2);
                }
              }
            } else {
              // Uniform scaling from opposite corner
              const scaleFactor = 1 + (Math.abs(deltaX) > Math.abs(deltaY) ? deltaX / 200 : -deltaY / 200);
              newScaleX = Math.max(0.1, initialTransform.scaleX * scaleFactor);
              newScaleY = Math.max(0.1, initialTransform.scaleY * scaleFactor);
              
              // Calculate position offset for uniform scaling
              const clip = getSelectedClip();
              const asset = clip ? project.assets.find(a => a.id === clip.assetId) : null;
              if (asset?.element) {
                let assetWidth = 100, assetHeight = 100;
                if (asset.element instanceof HTMLVideoElement) {
                  assetWidth = asset.element.videoWidth;
                  assetHeight = asset.element.videoHeight;
                } else if (asset.element instanceof HTMLImageElement) {
                  assetWidth = asset.element.naturalWidth;
                  assetHeight = asset.element.naturalHeight;
                }
                
                const deltaScale = newScaleX - initialTransform.scaleX;
                
                // Adjust position based on which corner we're dragging
                if (dragHandle.corner === 'tl') {
                  newX = initialTransform.x - (assetWidth * deltaScale / 2);
                  newY = initialTransform.y - (assetHeight * deltaScale / 2);
                } else if (dragHandle.corner === 'tr') {
                  newX = initialTransform.x + (assetWidth * deltaScale / 2);
                  newY = initialTransform.y - (assetHeight * deltaScale / 2);
                } else if (dragHandle.corner === 'bl') {
                  newX = initialTransform.x - (assetWidth * deltaScale / 2);
                  newY = initialTransform.y + (assetHeight * deltaScale / 2);
                } else if (dragHandle.corner === 'br') {
                  newX = initialTransform.x + (assetWidth * deltaScale / 2);
                  newY = initialTransform.y + (assetHeight * deltaScale / 2);
                }
              }
            }
          }
        } else if (dragHandle.edge) {
          // Edge scaling
          if (e.ctrlKey) {
            // Center scaling for edges
            if (dragHandle.edge === 'left' || dragHandle.edge === 'right') {
              const scaleFactor = 1 + (deltaX / 200);
              newScaleX = Math.max(0.1, initialTransform.scaleX * scaleFactor);
            } else {
              const scaleFactor = 1 + (-deltaY / 200);
              newScaleY = Math.max(0.1, initialTransform.scaleY * scaleFactor);
            }
          } else {
            // Anchor scaling from opposite edge
            const clip = getSelectedClip();
            const asset = clip ? project.assets.find(a => a.id === clip.assetId) : null;
            if (asset?.element) {
              let assetWidth = 100, assetHeight = 100;
              if (asset.element instanceof HTMLVideoElement) {
                assetWidth = asset.element.videoWidth;
                assetHeight = asset.element.videoHeight;
              } else if (asset.element instanceof HTMLImageElement) {
                assetWidth = asset.element.naturalWidth;
                assetHeight = asset.element.naturalHeight;
              }
              
              if (dragHandle.edge === 'left' || dragHandle.edge === 'right') {
                const direction = dragHandle.edge === 'right' ? 1 : -1;
                const scaleFactor = 1 + (deltaX * direction / 200);
                newScaleX = Math.max(0.1, initialTransform.scaleX * scaleFactor);
                
                // Adjust position for left/right edge scaling
                const deltaScale = newScaleX - initialTransform.scaleX;
                if (dragHandle.edge === 'left') {
                  newX = initialTransform.x - (assetWidth * deltaScale / 2);
                } else {
                  newX = initialTransform.x + (assetWidth * deltaScale / 2);
                }
              } else {
                const direction = dragHandle.edge === 'bottom' ? 1 : -1;
                const scaleFactor = 1 + (deltaY * direction / 200);
                newScaleY = Math.max(0.1, initialTransform.scaleY * scaleFactor);
                
                // Adjust position for top/bottom edge scaling
                const deltaScale = newScaleY - initialTransform.scaleY;
                if (dragHandle.edge === 'top') {
                  newY = initialTransform.y - (assetHeight * deltaScale / 2);
                } else {
                  newY = initialTransform.y + (assetHeight * deltaScale / 2);
                }
              }
            }
          }
        }
        
        // Clamp scale values
        newScaleX = Math.min(newScaleX, 5);
        newScaleY = Math.min(newScaleY, 5);
        
        // Update both scale and position
                  updateClipTransform(canvasSelectedClipId, 'scale', { scaleX: newScaleX, scaleY: newScaleY }, relativeTime);
        if (newX !== initialTransform.x || newY !== initialTransform.y) {
                      updateClipTransform(canvasSelectedClipId, 'position', { x: newX, y: newY }, relativeTime);
        }
      } else if (dragType === 'rotate') {
        // Rotate the clip
        const centerX = canvasSize.width / 2;
        const centerY = canvasSize.height / 2;
        
        const startAngle = Math.atan2(dragStart.y - rect.top - centerY, dragStart.x - rect.left - centerX);
        const currentAngle = Math.atan2(y - centerY, x - centerX);
        const deltaAngle = (currentAngle - startAngle) * (180 / Math.PI);
        
        const newRotation = initialTransform.rotation + deltaAngle;
        updateClipTransform(canvasSelectedClipId, 'rotation', newRotation, relativeTime);
      }
    };

    const handleGlobalMouseUp = () => {
      if (isDragging && canvasSelectedClipId) {
        // Save history after transform operation by doing one final update with history=true
        const clip = getSelectedClip();
        if (clip) {
          const relativeTime = playback.currentTime - clip.start;
          const currentTransform = getClipTransform(clip, relativeTime);
          
          if (dragType === 'move') {
            updateClipTransform(canvasSelectedClipId, 'position', { x: currentTransform.x, y: currentTransform.y }, relativeTime, true);
          } else if (dragType === 'scale') {
                          updateClipTransform(canvasSelectedClipId, 'scale', { scaleX: currentTransform.scaleX, scaleY: currentTransform.scaleY }, relativeTime, true);
          } else if (dragType === 'rotate') {
            updateClipTransform(canvasSelectedClipId, 'rotation', currentTransform.rotation, relativeTime, true);
          }
        }
      }
      
      setIsDragging(false);
      setDragHandle(null);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, dragStart, dragType, dragHandle, canvasSelectedClipId, initialTransform, originalCenter, canvasSize, project.canvasWidth, project.canvasHeight, playback.currentTime]);

  const syncVideoElements = () => {
    try {
      const currentTime = project.timeline.currentTime;
      const { clipElementMap, createClipElement } = useEditorStore.getState();
      
      project.timeline.tracks.forEach((track) => {
        if (!track.visible) return;

        track.clips.forEach((clip) => {
          const clipEndTime = clip.start + getEffectiveDuration(clip);
          const asset = project.assets.find(a => a.id === clip.assetId);
          
          // Skip if asset is missing (can happen after undo/redo)
          if (!asset) {
            console.log(`Asset not found for clip ${clip.id.slice(-4)}`);
            return;
          }
          
          // For audio clips, ensure each clip has its own element to prevent interference
          if (asset?.type === 'audio' && !clipElementMap.has(clip.id)) {
            createClipElement(clip.id, clip.assetId);
          }
          
          // Check if there's a clip-specific element (for split clips or audio clips)
          const clipSpecificElement = clipElementMap.get(clip.id);
        
        if (asset?.type === 'video') {
          const video = (clipSpecificElement as HTMLVideoElement) || (asset.element as HTMLVideoElement);
          if (!video || typeof video.pause !== 'function') {
            console.log(`Invalid video element for clip ${clip.id.slice(-4)}`);
            return;
          }
          
          // Always mute video elements - their audio is handled separately as extracted audio tracks
          if (!video.muted) {
            video.muted = true;
          }
          
          if (currentTime >= clip.start && currentTime <= clipEndTime) {
            const relativeTime = currentTime - clip.start;
            const inPoint = clip.inPoint || 0;
            const outPoint = clip.outPoint || (asset.duration || clip.duration);
            
            // Calculate target time based on whether clip is reversed and playback speed
            let targetTime;
            const videoSpeed = clip.playbackSpeed || 1;
            
            if (clip.reversed) {
              // For reversed clips, map timeline position to reversed source time
              const clipProgress = relativeTime / getEffectiveDuration(clip); // 0 to 1
              const reversedProgress = 1 - clipProgress; // 1 to 0
              targetTime = inPoint + (reversedProgress * (outPoint - inPoint));
            } else {
              // Account for playback speed when calculating target time
              const adjustedRelativeTime = relativeTime * videoSpeed;
              targetTime = adjustedRelativeTime + inPoint;
            }
            
            // Check if we're within the source media bounds
            if (targetTime >= inPoint && targetTime <= outPoint) {
              // Use a smaller threshold for reversed clips to reduce jitter
              const threshold = clip.reversed ? 0.033 : 0.1; // ~1 frame for reversed, 0.1s for normal
              if (Math.abs(video.currentTime - targetTime) > threshold) {
                video.currentTime = targetTime;
              }
            } else {
              // Pause if we're outside the trimmed bounds
              if (!video.paused) {
                video.pause();
              }
            }
            
            // Apply playback speed
            if (video.playbackRate !== videoSpeed) {
              video.playbackRate = videoSpeed;
            }
            
            // Sync play/pause state
            if (playback.isPlaying && video.paused) {
              video.play().catch(e => console.log('Video play failed:', e));
            } else if (!playback.isPlaying && !video.paused) {
              video.pause();
            }
          } else {
            // Pause videos that are not in current time range
            if (!video.paused) {
              video.pause();
            }
          }
        }
        
        // Handle audio elements
        if (asset?.type === 'audio') {
          // Skip all audio operations if assets are still loading
          if (assetsLoading) {
            console.log(`Assets still loading, skipping audio for clip ${clip.id.slice(-4)}`);
            return;
          }
          
          // For audio clips, always prefer the clip-specific element since each clip needs independence
          const audio = (clipSpecificElement as HTMLAudioElement) || (asset.element as HTMLAudioElement);
          if (!audio || typeof audio.pause !== 'function') {
            console.log(`Invalid audio element for clip ${clip.id.slice(-4)}`);
            return;
          }
          
          // If we're using the shared asset element, this indicates a problem
          if (audio === asset.element && !clipSpecificElement) {
            console.log(`Warning: clip ${clip.id.slice(-4)} using shared audio element instead of independent element`);
          }
          
          // Check if audio is ready for manipulation (prevent glitches on newly loaded audio)
          if (audio.readyState < 1) { // HTMLMediaElement.HAVE_METADATA
            console.log(`Audio not ready for clip ${clip.id.slice(-4)}, readyState: ${audio.readyState}`);
            return;
          }
          
          // Check if the audio is currently seeking or loading to avoid race conditions
          if (audio.seeking) {
            console.log(`Audio seeking for clip ${clip.id.slice(-4)}, skipping frame`);
            return;
          }
          
          if (currentTime >= clip.start && currentTime <= clipEndTime) {
            const relativeTime = currentTime - clip.start;
            const inPoint = clip.inPoint || 0;
            const outPoint = clip.outPoint || (asset.duration || clip.duration);
            
            // Calculate target time based on whether clip is reversed and playback speed
            let targetTime;
            const audioSpeed = clip.playbackSpeed || 1;
            
            if (clip.reversed) {
              // For reversed clips, map timeline position to reversed source time
              const clipProgress = relativeTime / getEffectiveDuration(clip); // 0 to 1
              const reversedProgress = 1 - clipProgress; // 1 to 0
              targetTime = inPoint + (reversedProgress * (outPoint - inPoint));
            } else {
              // Account for playback speed when calculating target time
              const adjustedRelativeTime = relativeTime * audioSpeed;
              targetTime = adjustedRelativeTime + inPoint;
            }
            
            // Check if we're within the source media bounds
            if (targetTime >= inPoint && targetTime <= outPoint) {
              // Use a smaller threshold for reversed clips to reduce jitter
              const threshold = clip.reversed ? 0.033 : 0.1; // ~1 frame for reversed, 0.1s for normal
              if (Math.abs(audio.currentTime - targetTime) > threshold) {
                try {
                  audio.currentTime = targetTime;
                } catch (e) {
                  console.log(`Failed to seek audio for clip ${clip.id.slice(-4)}:`, e);
                  return; // Skip this frame if seeking fails
                }
              }
              
              // Apply volume from keyframes
              const volume = getAudioVolumeAtTime(clip, relativeTime);
              try {
                audio.volume = Math.max(0, Math.min(1, volume)); // Clamp volume between 0 and 1
              } catch (e) {
                console.log(`Failed to set volume for clip ${clip.id.slice(-4)}:`, e);
              }
              
              // Apply playback speed
              if (audio.playbackRate !== audioSpeed) {
                audio.playbackRate = audioSpeed;
              }
              
              // Sync play/pause state - but only if we're not in the middle of operations
              if (playback.isPlaying && audio.paused && !audio.seeking) {
                audio.play().catch(e => console.log(`Audio play failed for clip ${clip.id.slice(-4)}:`, e));
              } else if (!playback.isPlaying && !audio.paused) {
                audio.pause();
              }
            } else {
              // Pause if we're outside the trimmed bounds
              if (!audio.paused) {
                audio.pause();
              }
            }
          } else {
            // Pause audio that are not in current time range
            if (!audio.paused) {
              audio.pause();
            }
          }
        }
      });
    });
    } catch (error) {
      console.error('Error in syncVideoElements:', error);
    }
  };

  const getAudioVolumeAtTime = (clip: Clip, time: number): number => {
    if (!clip.audioKeyframes?.volume || clip.audioKeyframes.volume.length === 0) {
      return 1.0; // Default volume
    }

    const volumeKeyframes = clip.audioKeyframes.volume;
    
    // Simple interpolation for volume
    if (volumeKeyframes.length === 1) {
      return volumeKeyframes[0].value;
    }

    // Find surrounding keyframes
    let prevKeyframe = volumeKeyframes[0];
    let nextKeyframe = volumeKeyframes[volumeKeyframes.length - 1];

    for (let i = 0; i < volumeKeyframes.length - 1; i++) {
      if (time >= volumeKeyframes[i].time && time <= volumeKeyframes[i + 1].time) {
        prevKeyframe = volumeKeyframes[i];
        nextKeyframe = volumeKeyframes[i + 1];
        break;
      }
    }

    // Linear interpolation
    const t = (time - prevKeyframe.time) / (nextKeyframe.time - prevKeyframe.time);
    return prevKeyframe.value + (nextKeyframe.value - prevKeyframe.value) * t;
  };

  const renderFrame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;

    // Clear canvas
    ctx.fillStyle = project.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Render visible clips at current time
    // Render tracks in reverse order so top tracks (first in array) render on top
    const currentTime = project.timeline.currentTime;
    
    const tracksToRender = [...project.timeline.tracks].reverse();
    tracksToRender.forEach((track) => {
      if (!track.visible) return;

      track.clips.forEach((clip) => {
        const clipEndTime = clip.start + getEffectiveDuration(clip);
        if (currentTime >= clip.start && currentTime <= clipEndTime) {
          renderClip(ctx, clip, currentTime - clip.start);
        }
      });
    });
  };

  const renderClip = (ctx: CanvasRenderingContext2D, clip: Clip, relativeTime: number) => {
    const asset = project.assets.find(a => a.id === clip.assetId);
    if (!asset || !asset.element) return;

    // Additional safety check to ensure element is valid for drawing
    const element = asset.element;
    if (!element || 
        (element instanceof HTMLVideoElement && (!element.videoWidth || typeof element.pause !== 'function')) || 
        (element instanceof HTMLImageElement && !element.complete) ||
        (element instanceof HTMLAudioElement)) {
      return; // Skip rendering if element is not ready or is audio
    }

    // Calculate transform at current time
    const transform = calculateTransform(clip, relativeTime);
    
    ctx.save();
    
    // Apply transform (canvas element handles zoom via CSS transform)
    const scaleX = (canvasSize.width / project.canvasWidth) * transform.scaleX;
    const scaleY = (canvasSize.height / project.canvasHeight) * transform.scaleY;
    const x = (transform.x / project.canvasWidth) * canvasSize.width;
    const y = (transform.y / project.canvasHeight) * canvasSize.height;
    
    ctx.globalAlpha = transform.opacity;
    ctx.translate(x + canvasSize.width / 2, y + canvasSize.height / 2);
    ctx.rotate(transform.rotation * Math.PI / 180);
    ctx.scale(scaleX, scaleY);

    try {
      // Render based on asset type - scale to fit canvas (full frame)
      if (asset.type === 'video' && element instanceof HTMLVideoElement) {
        // Scale video to fit canvas dimensions
        const videoWidth = element.videoWidth;
        const videoHeight = element.videoHeight;
        // Draw centered at full canvas size
        ctx.drawImage(element, -project.canvasWidth / 2, -project.canvasHeight / 2, project.canvasWidth, project.canvasHeight);
      } else if (asset.type === 'image' && element instanceof HTMLImageElement) {
        // Scale image to fit canvas dimensions
        ctx.drawImage(element, -project.canvasWidth / 2, -project.canvasHeight / 2, project.canvasWidth, project.canvasHeight);
      }
    } catch (error) {
      console.warn('Failed to render clip:', error);
      // Draw a placeholder rectangle
      ctx.fillStyle = '#333';
      ctx.fillRect(-50, -30, 100, 60);
      ctx.fillStyle = '#666';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Missing', 0, -5);
      ctx.fillText('Media', 0, 10);
    }
    
    ctx.restore();
  };

  // Use unified transform calculation
  const calculateTransform = (clip: Clip, time: number) => {
    return storeGetClipTransform(clip.id, time) || {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    };
  };

  // Mouse event handlers
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setMousePos({ x, y });
    setDragStart({ x: e.clientX, y: e.clientY }); // Use global coordinates

    // Check for pan mode (middle mouse button or space key)
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      setIsDragging(true);
      setDragType('pan');
      setInitialPanOffset({ ...panOffset });
      return;
    }

    // Check if clicking on a clip (transform coordinates for zoom/pan)
    const transformed = transformMouseCoordinates(x, y);
    const clipId = getClipAtCanvasPosition(transformed.x, transformed.y, canvasSize.width, canvasSize.height);
    if (clipId) {
      selectCanvasClip(clipId);
      setIsDragging(true);
      setDragType('move');
      
      // Store initial transform
      const clip = getClipById(clipId);
      if (clip) {
        const currentTransform = getClipTransform(clip, playback.currentTime - clip.start);
        setInitialTransform(currentTransform);
      }
    } else {
      // Clicked on empty space
      selectCanvasClip(null);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setMousePos({ x, y });
  };

  const handleCanvasMouseUp = () => {
    // This is handled by the global event listener now
  };

  // Helper functions
  const getSelectedClip = (): Clip | null => {
    if (!canvasSelectedClipId) return null;
    return getClipById(canvasSelectedClipId);
  };

  // Transform mouse coordinates (canvas element handles zoom/pan via CSS transform)
  const transformMouseCoordinates = (x: number, y: number) => {
    // No transformation needed since canvas element handles zoom/pan
    return { x, y };
  };

  const getClipById = (clipId: string): Clip | null => {
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.id === clipId) return clip;
      }
    }
    return null;
  };

  // Use the store's getClipTransform function for consistent behavior
  const getClipTransform = (clip: Clip, relativeTime: number) => {
    return storeGetClipTransform(clip.id, relativeTime) || {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    };
  };

  const getTransformHandles = (clipId: string): TransformHandle[] => {
    const clip = getClipById(clipId);
    if (!clip) return [];

    const asset = project.assets.find(a => a.id === clip.assetId);
    if (!asset || asset.type === 'audio') return [];

    const currentTime = playback.currentTime;
    if (currentTime < clip.start || currentTime > clip.start + clip.duration) return [];

    const relativeTime = currentTime - clip.start;
    const transform = getClipTransform(clip, relativeTime);
    
    const canvas = canvasRef.current;
    if (!canvas) return [];
    
    // Get canvas position relative to the container
    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = canvas.parentElement?.getBoundingClientRect();
    
    if (!containerRect) return [];
    
    // Calculate offsets
    const canvasOffsetX = canvasRect.left - containerRect.left;
    const canvasOffsetY = canvasRect.top - containerRect.top;
    
    // Calculate bounds exactly as in renderClip (canvas element handles zoom via CSS transform)
    const scaleX = (canvasSize.width / project.canvasWidth) * transform.scaleX;
    const scaleY = (canvasSize.height / project.canvasHeight) * transform.scaleY;
    const x = (transform.x / project.canvasWidth) * canvasSize.width;
    const y = (transform.y / project.canvasHeight) * canvasSize.height;
    
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
    
    const scaledWidth = assetWidth * scaleX;
    const scaledHeight = assetHeight * scaleY;
    
    // Position handles exactly where the clip is rendered, accounting for canvas offset and zoom
    const zoomedWidth = scaledWidth * zoomLevel;
    const zoomedHeight = scaledHeight * zoomLevel;
    const centerX = canvasOffsetX + (x + canvasSize.width / 2) * zoomLevel + panOffset.x;
    const centerY = canvasOffsetY + (y + canvasSize.height / 2) * zoomLevel + panOffset.y;
    const halfWidth = zoomedWidth / 2;
    const halfHeight = zoomedHeight / 2;
    
    // Convert rotation to radians
    const rotationRad = (transform.rotation * Math.PI) / 180;
    
    // Helper function to rotate a point around the center
    const rotatePoint = (px: number, py: number) => {
      const cos = Math.cos(rotationRad);
      const sin = Math.sin(rotationRad);
      const dx = px - centerX;
      const dy = py - centerY;
      return {
        x: centerX + (dx * cos - dy * sin),
        y: centerY + (dx * sin + dy * cos)
      };
    };
    
    // Define handle positions before rotation
    const handlePositions = [
      // Corner handles
      { x: centerX - halfWidth, y: centerY - halfHeight, type: 'corner' as const, cursor: 'nw-resize', corner: 'tl' as const },
      { x: centerX + halfWidth, y: centerY - halfHeight, type: 'corner' as const, cursor: 'ne-resize', corner: 'tr' as const },
      { x: centerX - halfWidth, y: centerY + halfHeight, type: 'corner' as const, cursor: 'sw-resize', corner: 'bl' as const },
      { x: centerX + halfWidth, y: centerY + halfHeight, type: 'corner' as const, cursor: 'se-resize', corner: 'br' as const },
      
      // Edge handles
      { x: centerX, y: centerY - halfHeight, type: 'edge' as const, cursor: 'n-resize', edge: 'top' as const },
      { x: centerX, y: centerY + halfHeight, type: 'edge' as const, cursor: 's-resize', edge: 'bottom' as const },
      { x: centerX - halfWidth, y: centerY, type: 'edge' as const, cursor: 'w-resize', edge: 'left' as const },
      { x: centerX + halfWidth, y: centerY, type: 'edge' as const, cursor: 'e-resize', edge: 'right' as const },
      
      // Rotate handle (positioned above the clip, scaled with zoom)
      { x: centerX, y: centerY - halfHeight - (20 * zoomLevel), type: 'rotate' as const, cursor: 'crosshair' },
    ];
    
    // Apply rotation to all handle positions
    const handles: TransformHandle[] = handlePositions.map(handle => {
      const rotated = rotatePoint(handle.x, handle.y);
      return {
        ...handle,
        x: rotated.x,
        y: rotated.y
      };
    });
    
    return handles;
  };

  const renderSelectionBorder = () => {
    if (!canvasSelectedClipId) return null;
    
    const clip = getClipById(canvasSelectedClipId);
    if (!clip) return null;
    
    const asset = project.assets.find(a => a.id === clip.assetId);
    if (!asset || asset.type === 'audio') return null;

    const currentTime = playback.currentTime;
    if (currentTime < clip.start || currentTime > clip.start + clip.duration) return null;

    const relativeTime = currentTime - clip.start;
    const transform = getClipTransform(clip, relativeTime);
    
    const canvas = canvasRef.current;
    if (!canvas) return null;
    
    // Get canvas position relative to the container
    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = canvas.parentElement?.getBoundingClientRect();
    
    if (!containerRect) return null;
    
    // Calculate offsets
    const canvasOffsetX = canvasRect.left - containerRect.left;
    const canvasOffsetY = canvasRect.top - containerRect.top;
    
    // Calculate bounds exactly as in renderClip (canvas element handles zoom via CSS transform)
    const scaleX = (canvasSize.width / project.canvasWidth) * transform.scaleX;
    const scaleY = (canvasSize.height / project.canvasHeight) * transform.scaleY;
    const x = (transform.x / project.canvasWidth) * canvasSize.width;
    const y = (transform.y / project.canvasHeight) * canvasSize.height;
    
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
    
    const scaledWidth = assetWidth * scaleX;
    const scaledHeight = assetHeight * scaleY;
    
    // Position the border exactly where the clip is rendered, accounting for canvas offset and zoom
    const centerX = canvasOffsetX + x + canvasSize.width / 2;
    const centerY = canvasOffsetY + y + canvasSize.height / 2;
    
    // Apply zoom level adjustments for CSS scaled canvas
    const zoomedWidth = scaledWidth * zoomLevel;
    const zoomedHeight = scaledHeight * zoomLevel;
    const zoomedCenterX = canvasOffsetX + (x + canvasSize.width / 2) * zoomLevel + panOffset.x;
    const zoomedCenterY = canvasOffsetY + (y + canvasSize.height / 2) * zoomLevel + panOffset.y;
    
    return (
      <div
        className="canvas-selection-border"
        style={{
          position: 'absolute',
          left: zoomedCenterX - zoomedWidth / 2,
          top: zoomedCenterY - zoomedHeight / 2,
          width: zoomedWidth,
          height: zoomedHeight,
          transform: `rotate(${transform.rotation}deg)`,
          transformOrigin: 'center',
          pointerEvents: 'none',
        }}
      />
    );
  };

  const renderTransformHandles = () => {
    if (!canvasSelectedClipId) return null;
    
    const handles = getTransformHandles(canvasSelectedClipId);
    
    // Scale handle size based on zoom level, but limit minimum size for usability
    const handleSize = Math.max(6, 8 * Math.min(zoomLevel, 1.5));
    const handleOffset = handleSize / 2;
    
    return handles.map((handle, index) => (
      <div
        key={index}
        className={`transform-handle ${handle.type} ${handle.corner || handle.edge || ''}`}
        style={{
          position: 'absolute',
          left: handle.x - handleOffset,
          top: handle.y - handleOffset,
          width: handleSize,
          height: handleSize,
          backgroundColor: handle.type === 'rotate' ? '#ff6600' : '#00cc99',
          border: '1px solid white',
          cursor: handle.cursor,
          zIndex: 20,
          borderRadius: handle.type === 'rotate' ? '50%' : '0',
          pointerEvents: 'all',
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          
          setIsDragging(true);
          setDragHandle(handle);
          setDragType(handle.type === 'rotate' ? 'rotate' : 'scale');
          setDragStart({ x: e.clientX, y: e.clientY });
          
          // Store initial transform
          const clip = getSelectedClip();
          if (clip) {
            const currentTransform = getClipTransform(clip, playback.currentTime - clip.start);
            setInitialTransform(currentTransform);
            
            // Calculate and store the original center position for center scaling
            if (handle.type !== 'rotate') {
              const canvas = canvasRef.current;
              const rect = canvas?.getBoundingClientRect();
              if (rect) {
                // Calculate the absolute center position of the clip on screen (canvas element handles zoom via CSS transform)
                const x = (currentTransform.x / project.canvasWidth) * canvasSize.width;
                const y = (currentTransform.y / project.canvasHeight) * canvasSize.height;
                const centerX = rect.left + (x + canvasSize.width / 2) * zoomLevel + panOffset.x;
                const centerY = rect.top + (y + canvasSize.height / 2) * zoomLevel + panOffset.y;
                setOriginalCenter({ x: centerX, y: centerY });
              }
            }
          }
        }}
      />
    ));
  };

  return (
    <div className="canvas-container" style={{ position: 'relative' }}>
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        background: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        padding: '6px 10px',
        borderRadius: '4px',
        fontSize: '12px',
        zIndex: 10
      }}>
{project.canvasWidth}×{project.canvasHeight} | {Math.round(zoomLevel * 100)}%
      </div>
      
      {/* Selection indicator */}
      {canvasSelectedClipId && (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          background: 'rgba(0, 204, 153, 0.8)',
          color: 'white',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '11px',
          zIndex: 10
        }}>
          Selected: {getClipById(canvasSelectedClipId)?.assetId ? 
            project.assets.find(a => a.id === getClipById(canvasSelectedClipId)?.assetId)?.name || 'Clip' : 'Clip'}
        </div>
      )}
      
      <canvas
        ref={canvasRef}
        className="preview-canvas"
        width={canvasSize.width}
        height={canvasSize.height}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onDoubleClick={handleCanvasDoubleClick}
        style={{ 
          cursor: isDragging ? 'grabbing' : (dragType === 'pan' ? 'move' : 'grab'),
          transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
          transformOrigin: 'center'
        }}
      />
      
             {/* Selection border */}
       {renderSelectionBorder()}
       
       {/* Transform handles */}
       {renderTransformHandles()}
       
       {/* AI Chatbox */}
       <AIChatBox onProjectUpdate={handleAIProjectUpdate} />
     </div>
  );
};

export default Canvas; 