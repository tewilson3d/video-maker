import React, { useRef, useEffect, useState } from 'react';
import { useEditorStore } from '../store';
import { Clip, Asset, Track } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { renderWaveform } from '../utils/waveform';
import { interpolateWithEasing } from '../utils/easing';

interface WaveformVisualizationProps {
  clip: Clip;
  asset: Asset;
  clipWidth: number;
  pixelsPerSecond: number;
}

const WaveformVisualization: React.FC<WaveformVisualizationProps> = ({ 
  clip, 
  asset, 
  clipWidth, 
  pixelsPerSecond 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !asset.waveform) return;

    const canvas = canvasRef.current;
    const waveform = asset.waveform;
    const totalSamples = waveform.length;
    
    // Calculate which portion of the waveform to show based on trimming
    const inPoint = clip.inPoint || 0;
    const outPoint = clip.outPoint || (asset.duration || clip.duration);
    const sourceDuration = asset.duration || clip.duration;
    
    // Map timeline trimming to waveform samples
    const startSample = (inPoint / sourceDuration) * totalSamples;
    const endSample = (outPoint / sourceDuration) * totalSamples;
    
    // Set appropriate color based on clip state
    let waveformColor = '#00ff88'; // Default green
    if (clip.reversed) {
      waveformColor = '#ff88ff'; // Purple for reversed
    }
    
    renderWaveform(
      canvas,
      waveform,
      startSample,
      endSample,
      clipWidth,
      24, // Height of waveform area
      waveformColor
    );
  }, [clip, asset, clipWidth, pixelsPerSecond]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        left: 0,
        top: 3,
        width: clipWidth,
        height: 24,
        pointerEvents: 'none',
        zIndex: 1
      }}
    />
  );
};



const Timeline: React.FC = () => {
  const {
    project,
    playback,
    selectedClipIds,
    canvasSelectedClipId,
    selectClip,
    selectCanvasClip,
    updateClip,
    removeClip,
    addClipToTrack,
    addTrack,
    removeTrack,
    splitClip,
    reverseClip,
    takeSnapshot,
    exportAllFrames,
    copyClips,
    pasteClips,
    play,
    pause,
    stop,
    seek,
    saveHistory,
    removeKeyframe,
    moveKeyframe,
    updateClipTransform,
    getEffectiveDuration,
    getClipTransform,
  } = useEditorStore();

  const timelineRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    dragType: 'move' | 'trim-left' | 'trim-right' | 'slip';
    clipId: string | null;
    startX: number;
    startY: number;
    startTime: number;
    startDuration: number;
    originalTrackId: string | null;
    currentTrackId: string | null;
    originalPositions?: { [clipId: string]: number }; // Store original positions for multi-clip dragging
    historyAction?: string; // Store history action for saving after operation completes
    // Additional fields for slip editing
    startInPoint?: number;
    startOutPoint?: number;
  }>({
    isDragging: false,
    dragType: 'move',
    clipId: null,
    startX: 0,
    startY: 0,
    startTime: 0,
    startDuration: 0,
    originalTrackId: null,
    currentTrackId: null,
  });

  const [cursorState, setCursorState] = useState<{
    clipId: string | null;
    edge: 'left' | 'right' | null;
  }>({
    clipId: null,
    edge: null,
  });

  const [justFinishedDragging, setJustFinishedDragging] = useState(false);
  const [collisionDetected, setCollisionDetected] = useState(false);
  
  // Snapping state
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapState, setSnapState] = useState<{
    isSnapped: boolean;
    snapPosition: number;
    snapType: 'start' | 'end';
    snapTargetClipId: string | null;
    originalPosition: number; // Position before snapping
  }>({
    isSnapped: false,
    snapPosition: 0,
    snapType: 'start',
    snapTargetClipId: null,
    originalPosition: 0,
  });
  
  // Multi-select state
  const [selectionDrag, setSelectionDrag] = useState<{
    isDragging: boolean;
    isPotentialDrag: boolean;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  }>({
    isDragging: false,
    isPotentialDrag: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  });

  // Selected track state
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(
    project.timeline.tracks.length > 0 ? project.timeline.tracks[0].id : null
  );
  
  // Playhead drag state
  const [playheadDrag, setPlayheadDrag] = useState<{
    isDragging: boolean;
  }>({
    isDragging: false,
  });

  // Zoom state - pixels per second
  const [pixelsPerSecond, setPixelsPerSecond] = useState(50);
  
  // Auto-scroll to keep playhead in view
  const scrollToPlayhead = () => {
    if (!timelineRef.current) return;
    
    const container = timelineRef.current;
    const playheadX = project.timeline.currentTime * pixelsPerSecond;
    const containerWidth = container.clientWidth;
    const scrollLeft = container.scrollLeft;
    const trackLabelWidth = 100;
    
    // Calculate the total content width and maximum possible scroll
    const totalContentWidth = Math.max(project.timeline.duration * pixelsPerSecond, 1000);
    const scrollableAreaWidth = containerWidth - trackLabelWidth;
    const maxScrollLeft = Math.max(0, totalContentWidth - scrollableAreaWidth);
    
    // Calculate the visible area (excluding track labels)
    const visibleStart = scrollLeft;
    const visibleEnd = scrollLeft + scrollableAreaWidth;
    
    // Check if playhead is outside visible area
    if (playheadX < visibleStart || playheadX > visibleEnd - 50) {
      // Scroll to center the playhead in the scrollable area
      const targetScrollLeft = playheadX - scrollableAreaWidth / 2;
      // Clamp to valid scroll range
      container.scrollLeft = Math.max(0, Math.min(targetScrollLeft, maxScrollLeft));
    }
  };
  
  // Zoom levels available
  const zoomLevels = [10, 25, 50, 100, 200, 500];
  const currentZoomIndex = zoomLevels.indexOf(pixelsPerSecond);
  
  const zoomIn = () => {
    const nextIndex = Math.min(currentZoomIndex + 1, zoomLevels.length - 1);
    setPixelsPerSecond(zoomLevels[nextIndex]);
  };
  
  const zoomOut = () => {
    const prevIndex = Math.max(currentZoomIndex - 1, 0);
    setPixelsPerSecond(zoomLevels[prevIndex]);
  };
  
  // Auto-scroll when playhead position changes
  useEffect(() => {
    scrollToPlayhead();
  }, [project.timeline.currentTime, pixelsPerSecond]);

  // Helper function to find the track that contains a specific clip
  const findTrackContainingClip = (clipId: string) => {
    for (const track of project.timeline.tracks) {
      if (track.clips.some(c => c.id === clipId)) {
        return track;
      }
    }
    return null;
  };

  // Helper function to check for collisions and constrain movement
  const getConstrainedPosition = (track: any, clipId: string, proposedStart: number, clipDuration: number, excludeClipIds?: string[]) => {
    if (!track) return proposedStart;

    // Filter out the current clip and any clips being moved together (to avoid false collisions)
    const otherClips = track.clips.filter((c: Clip) => {
      if (c.id === clipId) return false;
      if (excludeClipIds && excludeClipIds.includes(c.id)) return false;
      return true;
    });
    
    const proposedEnd = proposedStart + clipDuration;

    for (const otherClip of otherClips) {
      const otherStart = otherClip.start;
      const otherEnd = otherClip.start + getEffectiveDuration(otherClip);

      // Check if we're trying to move into this clip
      if (!(proposedEnd <= otherStart || proposedStart >= otherEnd)) {
        // We're colliding, so constrain to the nearest edge
        if (proposedStart < otherStart) {
          // Moving right into clip, stop at left edge
          return Math.max(0, otherStart - clipDuration);
        } else {
          // Moving left into clip, stop at right edge
          return otherEnd;
        }
      }
    }

    return Math.max(0, proposedStart);
  };

  // Helper function to check for trimming collisions
  const getConstrainedTrimPosition = (track: any, clipId: string, currentClipStart: number, currentClipDuration: number, proposedNewStart: number, proposedNewDuration: number) => {
    if (!track) return { start: proposedNewStart, duration: proposedNewDuration };

    // Filter out the current clip
    const otherClips = track.clips.filter((c: Clip) => c.id !== clipId);
    
    let constrainedStart = proposedNewStart;
    let constrainedDuration = proposedNewDuration;
    const proposedNewEnd = proposedNewStart + proposedNewDuration;

    // Check each other clip for potential collisions
    for (const otherClip of otherClips) {
      const otherStart = otherClip.start;
      const otherEnd = otherClip.start + getEffectiveDuration(otherClip);

      // Left trim collision: if proposed start would go into another clip
      if (constrainedStart < otherEnd && constrainedStart + constrainedDuration > otherStart) {
        // If we're trying to start before this clip ends
        if (constrainedStart < otherEnd && constrainedStart < currentClipStart) {
          // Constrain start to not go past the other clip's end
          constrainedStart = otherEnd;
          constrainedDuration = (currentClipStart + currentClipDuration) - constrainedStart;
          constrainedDuration = Math.max(0.1, constrainedDuration);
        }
      }

      // Right trim collision: if proposed end would go into another clip  
      const newEnd = constrainedStart + constrainedDuration;
      if (constrainedStart < otherEnd && newEnd > otherStart) {
        // If we're trying to end after this clip starts
        if (newEnd > otherStart && newEnd > (currentClipStart + currentClipDuration)) {
          // Constrain end to not go past the other clip's start
          constrainedDuration = otherStart - constrainedStart;
          constrainedDuration = Math.max(0.1, constrainedDuration);
        }
      }
    }

    return { 
      start: Math.max(0, constrainedStart), 
      duration: Math.max(0.1, constrainedDuration) 
    };
  };

  // Helper function to find the next available space in a track when switching tracks
  const findNextAvailableSpace = (track: any, preferredStart: number, clipDuration: number) => {
    if (!track) return preferredStart;

    // Sort clips by start time
    const sortedClips = [...track.clips].sort((a, b) => a.start - b.start);
    
    // Check if preferred position is available
    const preferredEnd = preferredStart + clipDuration;
    let hasCollision = false;
    
    for (const clip of sortedClips) {
      if (!(preferredEnd <= clip.start || preferredStart >= clip.start + getEffectiveDuration(clip))) {
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
      
      // Check if we can fit after this clip
      const afterCurrentClip = currentClip.start + getEffectiveDuration(currentClip);
      
      if (nextClip) {
        // Check if there's enough space between this clip and the next
        const availableSpace = nextClip.start - afterCurrentClip;
        if (availableSpace >= clipDuration) {
          return afterCurrentClip;
        }
      } else {
        // No next clip, so we can place it after the current clip
        return afterCurrentClip;
      }
    }
    
    // If no clips exist, place at preferred position or 0
    if (sortedClips.length === 0) {
      return Math.max(0, preferredStart);
    }
    
    // Fallback: place at the end
    const lastClip = sortedClips[sortedClips.length - 1];
    return lastClip.start + getEffectiveDuration(lastClip);
  };

  // Helper function to find snap targets (clip edges on other tracks)
  const findSnapTargets = (currentClipId: string, currentTrackId: string, clipDuration: number) => {
    const snapTargets: Array<{
      position: number;
      type: 'start' | 'end';
      clipId: string;
      distance: number;
    }> = [];
    
    // Look through all tracks except the current one
    for (const track of project.timeline.tracks) {
      if (track.id === currentTrackId) continue;
      
      for (const clip of track.clips) {
        if (clip.id === currentClipId) continue;
        
        // Add start and end positions as potential snap targets
        snapTargets.push({
          position: clip.start,
          type: 'start',
          clipId: clip.id,
          distance: 0, // Will be calculated later
        });
        
        snapTargets.push({
          position: clip.start + getEffectiveDuration(clip),
          type: 'end',
          clipId: clip.id,
          distance: 0, // Will be calculated later
        });
      }
    }
    
    return snapTargets;
  };
  
  // Helper function to check for snapping and return snapped position
  const checkForSnapping = (
    proposedStart: number,
    clipDuration: number,
    currentClipId: string,
    currentTrackId: string,
    currentSnapState: typeof snapState
  ) => {
    const snapThreshold = 10 / pixelsPerSecond; // 10 pixels threshold converted to time
    const unsnapThreshold = 20 / pixelsPerSecond; // 20 pixels to break snap (sticky behavior)
    
    const clipEnd = proposedStart + clipDuration;
    const snapTargets = findSnapTargets(currentClipId, currentTrackId, clipDuration);
    
    // Add playhead as a snap target
    snapTargets.push({
      position: project.timeline.currentTime,
      type: 'start',
      clipId: 'playhead',
      distance: 0
    });
    
    // If currently snapped, check if we should break the snap
    if (currentSnapState.isSnapped) {
      const distanceFromSnap = Math.abs(proposedStart - currentSnapState.originalPosition);
      if (distanceFromSnap > unsnapThreshold) {
        // Break the snap
        return {
          position: proposedStart,
          isSnapped: false,
          snapPosition: 0,
          snapType: 'start' as const,
          snapTargetClipId: null,
          originalPosition: proposedStart,
        };
      } else {
        // Stay snapped
        return {
          position: currentSnapState.snapPosition,
          isSnapped: true,
          snapPosition: currentSnapState.snapPosition,
          snapType: currentSnapState.snapType,
          snapTargetClipId: currentSnapState.snapTargetClipId,
          originalPosition: currentSnapState.originalPosition,
        };
      }
    }
    
    // Not currently snapped, check for new snap opportunities
    let closestSnap = null;
    let closestDistance = snapThreshold;
    
    for (const target of snapTargets) {
      // Check if clip start can snap to this target
      const startDistance = Math.abs(proposedStart - target.position);
      if (startDistance < closestDistance) {
        closestSnap = {
          position: target.position,
          snapType: 'start' as const,
          distance: startDistance,
          targetClipId: target.clipId,
        };
        closestDistance = startDistance;
      }
      
      // Check if clip end can snap to this target
      const endDistance = Math.abs(clipEnd - target.position);
      if (endDistance < closestDistance) {
        closestSnap = {
          position: target.position - clipDuration, // Adjust so end aligns with target
          snapType: 'end' as const,
          distance: endDistance,
          targetClipId: target.clipId,
        };
        closestDistance = endDistance;
      }
    }
    
    if (closestSnap) {
      // Snap to the closest target
      return {
        position: closestSnap.position,
        isSnapped: true,
        snapPosition: closestSnap.position,
        snapType: closestSnap.snapType,
        snapTargetClipId: closestSnap.targetClipId,
        originalPosition: proposedStart,
      };
    }
    
    // No snapping
    return {
      position: proposedStart,
      isSnapped: false,
      snapPosition: 0,
      snapType: 'start' as const,
      snapTargetClipId: null,
      originalPosition: proposedStart,
    };
  };

  // Enhanced snapping function for trimming operations
  const checkForTrimmingSnap = (
    proposedEdgePosition: number,
    currentClipId: string,
    currentTrackId: string,
    currentSnapState: typeof snapState,
    trimType: 'left' | 'right'
  ) => {
    if (!snapEnabled) {
      return {
        position: proposedEdgePosition,
        isSnapped: false,
        snapPosition: 0,
        snapType: 'start' as const,
        snapTargetClipId: null,
        originalPosition: proposedEdgePosition,
      };
    }

    const snapThreshold = 10 / pixelsPerSecond; // 10 pixels threshold converted to time
    const unsnapThreshold = 20 / pixelsPerSecond; // 20 pixels to break snap (sticky behavior)
    
    const snapTargets = findSnapTargets(currentClipId, currentTrackId, 0); // Duration doesn't matter for edge snapping
    
    // Add playhead as a snap target
    snapTargets.push({
      position: project.timeline.currentTime,
      type: 'start',
      clipId: 'playhead',
      distance: 0
    });
    
    // If currently snapped, check if we should break the snap
    if (currentSnapState.isSnapped) {
      const distanceFromSnap = Math.abs(proposedEdgePosition - currentSnapState.originalPosition);
      if (distanceFromSnap > unsnapThreshold) {
        // Break the snap
        return {
          position: proposedEdgePosition,
          isSnapped: false,
          snapPosition: 0,
          snapType: 'start' as const,
          snapTargetClipId: null,
          originalPosition: proposedEdgePosition,
        };
      } else {
        // Stay snapped
        return {
          position: currentSnapState.snapPosition,
          isSnapped: true,
          snapPosition: currentSnapState.snapPosition,
          snapType: currentSnapState.snapType,
          snapTargetClipId: currentSnapState.snapTargetClipId,
          originalPosition: currentSnapState.originalPosition,
        };
      }
    }
    
    // Not currently snapped, check for new snap opportunities
    let closestSnap = null;
    let closestDistance = snapThreshold;
    
    for (const target of snapTargets) {
      // Check if edge can snap to target start
      const edgeToStartDistance = Math.abs(proposedEdgePosition - target.position);
      if (edgeToStartDistance < closestDistance) {
        closestSnap = {
          position: target.position,
          snapType: trimType === 'left' ? 'start' as const : 'end' as const,
          distance: edgeToStartDistance,
          targetClipId: target.clipId,
        };
        closestDistance = edgeToStartDistance;
      }
      
      // Targets already represent both start and end positions, so we just check distance to the target position
      // No need to check target.position + target.duration since findSnapTargets already creates both start and end targets
    }
    
    if (closestSnap) {
      // Snap to the closest target
      return {
        position: closestSnap.position,
        isSnapped: true,
        snapPosition: closestSnap.position,
        snapType: closestSnap.snapType,
        snapTargetClipId: closestSnap.targetClipId,
        originalPosition: proposedEdgePosition,
      };
    }
    
    // No snapping
    return {
      position: proposedEdgePosition,
      isSnapped: false,
      snapPosition: 0,
      snapType: 'start' as const,
      snapTargetClipId: null,
      originalPosition: proposedEdgePosition,
    };
  };

  // Helper function to update clip selection based on rectangle selection
  const updateSelectionFromRectangle = () => {
    if (!timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const scrollLeft = timelineRef.current.scrollLeft;
    const trackLabelWidth = 100;
    const rulerHeight = 40;
    const trackHeight = 40;

    // Calculate selection rectangle bounds in timeline coordinates
    const selectionLeft = Math.min(selectionDrag.startX, selectionDrag.currentX) - trackLabelWidth + scrollLeft;
    const selectionRight = Math.max(selectionDrag.startX, selectionDrag.currentX) - trackLabelWidth + scrollLeft;
    const selectionTop = Math.min(selectionDrag.startY, selectionDrag.currentY) - rulerHeight;
    const selectionBottom = Math.max(selectionDrag.startY, selectionDrag.currentY) - rulerHeight;

    // Convert pixel coordinates to time coordinates
    const selectionStartTime = Math.max(0, selectionLeft / pixelsPerSecond);
    const selectionEndTime = selectionRight / pixelsPerSecond;

    // Find all clips that intersect with the selection rectangle
    const selectedClips: string[] = [];
    
    project.timeline.tracks.forEach((track, trackIndex) => {
      const trackTop = trackIndex * trackHeight;
      const trackBottom = trackTop + trackHeight;
      
      // Check if track intersects with selection rectangle vertically
      if (selectionBottom >= trackTop && selectionTop <= trackBottom) {
        track.clips.forEach((clip) => {
          const clipStart = clip.start;
          const clipEnd = clip.start + clip.duration;
          
          // Check if clip intersects with selection rectangle horizontally
          if (clipEnd >= selectionStartTime && clipStart <= selectionEndTime) {
            selectedClips.push(clip.id);
          }
        });
      }
    });

    // Update selection
    if (selectedClips.length > 0) {
      selectClip(selectedClips[0], false);
      for (let i = 1; i < selectedClips.length; i++) {
        selectClip(selectedClips[i], true);
      }
    }
  };



  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Handle playhead scrubbing
      if (playheadDrag.isDragging && timelineRef.current) {
        const rect = timelineRef.current.getBoundingClientRect();
        const scrollLeft = timelineRef.current.scrollLeft;
        const x = e.clientX - rect.left - 100 + scrollLeft; // Subtract track label width and add scroll offset
        const time = Math.max(0, Math.min(x / pixelsPerSecond, project.timeline.duration));
        seek(time);
        return;
      }
      
      // Handle potential drag becoming actual drag
      if (selectionDrag.isPotentialDrag && !selectionDrag.isDragging && timelineRef.current) {
        const rect = timelineRef.current.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        
        // Check if we've moved enough to start dragging
        const moveDistance = Math.abs(currentX - selectionDrag.startX) + Math.abs(currentY - selectionDrag.startY);
        if (moveDistance > 5) {
          // Start actual dragging
          setSelectionDrag(prev => ({
            ...prev,
            isDragging: true,
            isPotentialDrag: false,
            currentX,
            currentY,
          }));
        } else {
          // Just update position for tracking
          setSelectionDrag(prev => ({
            ...prev,
            currentX,
            currentY,
          }));
        }
        return;
      }

      // Handle selection dragging
      if (selectionDrag.isDragging && timelineRef.current) {
        const rect = timelineRef.current.getBoundingClientRect();
        setSelectionDrag(prev => ({
          ...prev,
          currentX: e.clientX - rect.left,
          currentY: e.clientY - rect.top,
        }));
        
        // Find clips that intersect with selection rectangle
        updateSelectionFromRectangle();
        return;
      }
      
      if (!dragState.isDragging || !dragState.clipId) return;

      // Find the clip and its asset to get source media duration
      let currentClip: Clip | null = null;
      let asset: any = null;
      
      for (const track of project.timeline.tracks) {
        const clip = track.clips.find(c => c.id === dragState.clipId);
        if (clip) {
          currentClip = clip;
          asset = project.assets.find(a => a.id === clip.assetId);
          break;
        }
      }
      
      if (!currentClip || !asset) return;

      const deltaX = e.clientX - dragState.startX;
      const deltaTime = deltaX / pixelsPerSecond;
      
      // Get current inPoint/outPoint or defaults
      const currentInPoint = currentClip.inPoint || 0;
      const currentOutPoint = currentClip.outPoint || (asset.type === 'image' ? dragState.startDuration : asset.duration) || dragState.startDuration;
      const sourceDuration = asset.type === 'image' ? 30 : (asset.duration || dragState.startDuration);

      if (dragState.dragType === 'move') {
        const rawNewStartTime = Math.max(0, dragState.startTime + deltaTime);
        
        // Handle multi-clip moving
        if (selectedClipIds.length > 1 && selectedClipIds.includes(dragState.clipId) && dragState.originalPositions) {
          // Calculate the movement offset based on the original position of the dragged clip
          const draggedClipOriginalStart = dragState.originalPositions[dragState.clipId];
          const moveOffset = rawNewStartTime - draggedClipOriginalStart;
          
          // First pass: Calculate the maximum safe movement distance for all clips
          let maxSafeMovement = moveOffset;
          let hasAnyCollision = false;
          
          for (const clipId of selectedClipIds) {
            const originalPosition = dragState.originalPositions[clipId];
            if (originalPosition === undefined) continue;
            
            // Find the clip and its track
            let clip: Clip | null = null;
            let track: any = null;
            
            for (const t of project.timeline.tracks) {
              const foundClip = t.clips.find(c => c.id === clipId);
              if (foundClip) {
                clip = foundClip;
                track = t;
                break;
              }
            }
            
            if (!clip || !track) continue;
            
            // Calculate proposed position and constrained position
            const proposedNewStart = Math.max(0, originalPosition + moveOffset);
            const constrainedStart = getConstrainedPosition(track, clipId, proposedNewStart, getEffectiveDuration(clip), selectedClipIds);
            
            // Calculate the actual movement that would be allowed for this clip
            const actualMovement = constrainedStart - originalPosition;
            
            // Find the most restrictive movement (closest to zero while maintaining direction)
            if (moveOffset >= 0) {
              // Moving right: find the minimum positive movement
              if (actualMovement < maxSafeMovement) {
                maxSafeMovement = actualMovement;
              }
            } else {
              // Moving left: find the maximum negative movement (closest to zero)
              if (actualMovement > maxSafeMovement) {
                maxSafeMovement = actualMovement;
              }
            }
            
            // Check if this clip would be constrained
            if (Math.abs(constrainedStart - proposedNewStart) > 0.01) {
              hasAnyCollision = true;
            }
          }
          
          // Second pass: Move all clips by the same safe amount
          for (const clipId of selectedClipIds) {
            const originalPosition = dragState.originalPositions[clipId];
            if (originalPosition === undefined) continue;
            
            const newStart = Math.max(0, originalPosition + maxSafeMovement);
            updateClip(clipId, { start: newStart }, true); // Skip history during drag
          }
          
          setCollisionDetected(hasAnyCollision);
          return;
        }
        
        // Single clip moving (original logic)
        
        // Apply snapping before track switching or collision detection (if enabled)
        const currentTrack = findTrackContainingClip(dragState.clipId);
        const currentTrackId = currentTrack?.id || dragState.currentTrackId;
        
        let snapResult;
        if (snapEnabled) {
          snapResult = checkForSnapping(
            rawNewStartTime,
            getEffectiveDuration(currentClip),
            dragState.clipId,
            currentTrackId || '',
            snapState
          );
        } else {
          // Snapping disabled, use raw position
          snapResult = {
            position: rawNewStartTime,
            isSnapped: false,
            snapPosition: 0,
            snapType: 'start' as const,
            snapTargetClipId: null,
            originalPosition: rawNewStartTime,
          };
        }
        
        // Update snap state
        setSnapState({
          isSnapped: snapResult.isSnapped,
          snapPosition: snapResult.snapPosition,
          snapType: snapResult.snapType,
          snapTargetClipId: snapResult.snapTargetClipId,
          originalPosition: snapResult.originalPosition,
        });
        
        const snappedStartTime = snapResult.position;
        
        // Check if we need to switch tracks based on mouse Y position
        if (timelineRef.current) {
          const timelineRect = timelineRef.current.getBoundingClientRect();
          const relativeY = e.clientY - timelineRect.top;
          const trackHeight = 40; // Height of each track
          const rulerHeight = 40; // Height of time ruler
          const trackIndex = Math.floor((relativeY - rulerHeight) / trackHeight);
          
          if (trackIndex >= 0 && trackIndex < project.timeline.tracks.length) {
            const targetTrack = project.timeline.tracks[trackIndex];
            
            // Check media type compatibility
            const isCompatible = 
              (targetTrack.type === 'video' && (asset.type === 'video' || asset.type === 'image')) ||
              (targetTrack.type === 'audio' && asset.type === 'audio');
            
            if (isCompatible && targetTrack.id !== dragState.currentTrackId) {
              // Find the next available space in the target track (use snapped position)
              const nextAvailableTime = findNextAvailableSpace(targetTrack, snappedStartTime, getEffectiveDuration(currentClip));
              
              // Set collision state if position was moved to avoid collision
              setCollisionDetected(Math.abs(nextAvailableTime - snappedStartTime) > 0.01);
              
              // Move clip to new track
              removeClip(dragState.clipId);
              const newClip = {
                ...currentClip,
                id: uuidv4(),
                start: nextAvailableTime,
              };
              addClipToTrack(targetTrack.id, newClip);
              
              // Update drag state with new clip and track  
              setDragState(prev => ({
                ...prev,
                clipId: newClip.id,
                currentTrackId: targetTrack.id,
                startTime: nextAvailableTime, // Update start time for continued dragging
              }));
              
              selectClip(newClip.id);
              
              // Clear snap state when switching tracks
              setSnapState({
                isSnapped: false,
                snapPosition: 0,
                snapType: 'start',
                snapTargetClipId: null,
                originalPosition: 0,
              });
              
              return;
            }
          }
        }
        
        // Apply collision detection on current track (use snapped position)
        const constrainedTime = getConstrainedPosition(currentTrack, dragState.clipId, snappedStartTime, getEffectiveDuration(currentClip));
        
        // Set collision state if position was constrained
        setCollisionDetected(Math.abs(constrainedTime - snappedStartTime) > 0.01);
        
        updateClip(dragState.clipId, { start: constrainedTime }, true); // Skip history during drag
      } else if (dragState.dragType === 'trim-left') {
        // For reversed clips, left trim affects outPoint (visual start = source end)
        // For normal clips, left trim affects inPoint (visual start = source start)
        if (currentClip.reversed) {
          // Reversed clip: left trim affects outPoint (visual left = source end)
          // Dragging left should expand clip (include more from source end)
          // Dragging right should contract clip (include less from source end)
          
          // Calculate the raw desired change in outPoint (inverted from deltaTime)
          const rawDesiredOutPointChange = -deltaTime;
          const rawNewStartTime = dragState.startTime - rawDesiredOutPointChange;
          
          // Apply snapping to the proposed new start position
          const currentTrack = findTrackContainingClip(dragState.clipId);
          const currentTrackId = currentTrack?.id || dragState.currentTrackId;
          
          let snapResult;
          if (snapEnabled) {
            snapResult = checkForTrimmingSnap(
              rawNewStartTime,
              dragState.clipId,
              currentTrackId || '',
              snapState,
              'left'
            );
          } else {
            snapResult = {
              position: rawNewStartTime,
              isSnapped: false,
              snapPosition: 0,
              snapType: 'start' as const,
              snapTargetClipId: null,
              originalPosition: rawNewStartTime,
            };
          }
          
          // Update snap state
          setSnapState({
            isSnapped: snapResult.isSnapped,
            snapPosition: snapResult.snapPosition,
            snapType: snapResult.snapType,
            snapTargetClipId: snapResult.snapTargetClipId,
            originalPosition: snapResult.originalPosition,
          });
          
          const snappedNewStartTime = snapResult.position;
          const snappedDesiredOutPointChange = dragState.startTime - snappedNewStartTime;
          
          // Calculate constraints
          const maxExpansion = sourceDuration - currentOutPoint; // Can't go beyond source end
          const maxContraction = dragState.startDuration - 0.1; // Can't make clip too small (timeline duration)
          const maxTimelineExpansion = dragState.startTime; // Can't move start below 0
          
          // Apply constraints to the snapped change
          let constrainedOutPointChange;
          if (snappedDesiredOutPointChange > 0) {
            // Expanding: limited by source duration and timeline start position
            constrainedOutPointChange = Math.min(snappedDesiredOutPointChange, maxExpansion, maxTimelineExpansion);
          } else {
            // Contracting: limited by minimum clip duration
            constrainedOutPointChange = Math.max(snappedDesiredOutPointChange, -maxContraction);
          }
          
          const proposedNewStartTime = Math.max(0, dragState.startTime - constrainedOutPointChange);
          const proposedNewDuration = dragState.startDuration + constrainedOutPointChange;
          
          // Apply collision detection to prevent overlapping other clips
          const clipTrack = findTrackContainingClip(dragState.clipId);
          const collisionResult = getConstrainedTrimPosition(
            clipTrack,
            dragState.clipId,
            dragState.startTime,
            dragState.startDuration,
            proposedNewStartTime,
            proposedNewDuration
          );
          
          const actualOutPointChange = (collisionResult.start - dragState.startTime) + (collisionResult.duration - dragState.startDuration);
          const newOutPoint = currentOutPoint - actualOutPointChange;
          
          // Set collision state for visual feedback
          setCollisionDetected(
            Math.abs(collisionResult.start - proposedNewStartTime) > 0.01 ||
            Math.abs(collisionResult.duration - proposedNewDuration) > 0.01
          );
          
          updateClip(dragState.clipId, { 
            start: collisionResult.start, 
            duration: collisionResult.duration,
            outPoint: newOutPoint <= sourceDuration ? newOutPoint : undefined
          }, true); // Skip history during drag
        } else {
          // Normal clip: left trim affects inPoint
          const rawTrimAmount = deltaTime;
          const rawNewStartTime = dragState.startTime + rawTrimAmount;
          
          // Apply snapping to the proposed new start position (left edge)
          const currentTrack = findTrackContainingClip(dragState.clipId);
          const currentTrackId = currentTrack?.id || dragState.currentTrackId;
          
          let snapResult;
          if (snapEnabled) {
            snapResult = checkForTrimmingSnap(
              rawNewStartTime,
              dragState.clipId,
              currentTrackId || '',
              snapState,
              'left'
            );
          } else {
            snapResult = {
              position: rawNewStartTime,
              isSnapped: false,
              snapPosition: 0,
              snapType: 'start' as const,
              snapTargetClipId: null,
              originalPosition: rawNewStartTime,
            };
          }
          
          // Update snap state
          setSnapState({
            isSnapped: snapResult.isSnapped,
            snapPosition: snapResult.snapPosition,
            snapType: snapResult.snapType,
            snapTargetClipId: snapResult.snapTargetClipId,
            originalPosition: snapResult.originalPosition,
          });
          
          const snappedNewStartTime = snapResult.position;
          const snappedTrimAmount = snappedNewStartTime - dragState.startTime;
          
          // Apply constraints to the snapped trim amount
          const maxForwardTrim = Math.min(
            dragState.startDuration - 0.1, // Don't trim to less than 0.1s
            currentOutPoint - currentInPoint - 0.1 // Don't exceed source bounds
          );
          const maxBackwardTrim = currentInPoint; // Can't go below inPoint 0
          
          const constrainedTrimAmount = Math.max(-maxBackwardTrim, Math.min(maxForwardTrim, snappedTrimAmount));
          
          const proposedNewStartTime = Math.max(0, dragState.startTime + constrainedTrimAmount);
          const proposedNewDuration = dragState.startDuration - constrainedTrimAmount;
          
          // Apply collision detection to prevent overlapping other clips
          const clipTrack = findTrackContainingClip(dragState.clipId);
          const collisionResult = getConstrainedTrimPosition(
            clipTrack,
            dragState.clipId,
            dragState.startTime,
            dragState.startDuration,
            proposedNewStartTime,
            proposedNewDuration
          );
          
          const newInPoint = currentInPoint + (collisionResult.start - dragState.startTime);
          
          // Set collision state for visual feedback
          setCollisionDetected(
            Math.abs(collisionResult.start - proposedNewStartTime) > 0.01 ||
            Math.abs(collisionResult.duration - proposedNewDuration) > 0.01
          );
          
          updateClip(dragState.clipId, { 
            start: collisionResult.start, 
            duration: collisionResult.duration,
            inPoint: newInPoint > 0 ? newInPoint : undefined
          }, true); // Skip history during drag
        }
      } else if (dragState.dragType === 'trim-right') {
        // For reversed clips, right trim affects inPoint (visual end = source start)
        // For normal clips, right trim affects outPoint (visual end = source end)
        if (currentClip.reversed) {
          // Reversed clip: right trim affects inPoint (visual right = source start)
          // Dragging right should expand clip (decrease inPoint toward 0)
          // Dragging left should contract clip (increase inPoint)
          
          // Calculate the raw desired change in inPoint (same direction as deltaTime)
          const rawDesiredInPointChange = -deltaTime;
          const rawNewEndTime = dragState.startTime + dragState.startDuration - rawDesiredInPointChange;
          
          // Apply snapping to the proposed new end position
          const currentTrack = findTrackContainingClip(dragState.clipId);
          const currentTrackId = currentTrack?.id || dragState.currentTrackId;
          
          let snapResult;
          if (snapEnabled) {
            snapResult = checkForTrimmingSnap(
              rawNewEndTime,
              dragState.clipId,
              currentTrackId || '',
              snapState,
              'right'
            );
          } else {
            snapResult = {
              position: rawNewEndTime,
              isSnapped: false,
              snapPosition: 0,
              snapType: 'end' as const,
              snapTargetClipId: null,
              originalPosition: rawNewEndTime,
            };
          }
          
          // Update snap state
          setSnapState({
            isSnapped: snapResult.isSnapped,
            snapPosition: snapResult.snapPosition,
            snapType: snapResult.snapType,
            snapTargetClipId: snapResult.snapTargetClipId,
            originalPosition: snapResult.originalPosition,
          });
          
          const snappedNewEndTime = snapResult.position;
          const snappedDesiredInPointChange = (dragState.startTime + dragState.startDuration) - snappedNewEndTime;
          
          // Calculate constraints
          const maxExpansion = currentInPoint; // Can't go below 0 for inPoint
          const maxContraction = dragState.startDuration - 0.1; // Can't make clip too small (timeline duration)
          
          // Apply constraints to the snapped change
          let constrainedInPointChange;
          if (snappedDesiredInPointChange < 0) {
            // Expanding (inPoint decreases): limited by how far we can reduce inPoint (towards 0)
            constrainedInPointChange = Math.max(snappedDesiredInPointChange, -maxExpansion);
          } else {
            // Contracting (inPoint increases): limited by minimum clip duration
            constrainedInPointChange = Math.min(snappedDesiredInPointChange, maxContraction);
          }
          
          const proposedNewDuration = dragState.startDuration - constrainedInPointChange;
          
          // Apply collision detection to prevent overlapping other clips
          const clipTrack = findTrackContainingClip(dragState.clipId);
          const collisionResult = getConstrainedTrimPosition(
            clipTrack,
            dragState.clipId,
            dragState.startTime,
            dragState.startDuration,
            dragState.startTime, // Start doesn't change for right trim
            proposedNewDuration
          );
          
          const actualInPointChange = dragState.startDuration - collisionResult.duration;
          const newInPoint = currentInPoint + actualInPointChange;
          
          // Set collision state for visual feedback
          setCollisionDetected(Math.abs(collisionResult.duration - proposedNewDuration) > 0.01);
          
          updateClip(dragState.clipId, { 
            duration: collisionResult.duration,
            inPoint: newInPoint > 0 ? newInPoint : undefined
          }, true); // Skip history during drag
        } else {
          // Normal clip: right trim affects outPoint
          const rawTrimAmount = deltaTime;
          const rawNewEndTime = dragState.startTime + dragState.startDuration + rawTrimAmount;
          
          // Apply snapping to the proposed new end position (right edge)
          const currentTrack = findTrackContainingClip(dragState.clipId);
          const currentTrackId = currentTrack?.id || dragState.currentTrackId;
          
          let snapResult;
          if (snapEnabled) {
            snapResult = checkForTrimmingSnap(
              rawNewEndTime,
              dragState.clipId,
              currentTrackId || '',
              snapState,
              'right'
            );
          } else {
            snapResult = {
              position: rawNewEndTime,
              isSnapped: false,
              snapPosition: 0,
              snapType: 'end' as const,
              snapTargetClipId: null,
              originalPosition: rawNewEndTime,
            };
          }
          
          // Update snap state
          setSnapState({
            isSnapped: snapResult.isSnapped,
            snapPosition: snapResult.snapPosition,
            snapType: snapResult.snapType,
            snapTargetClipId: snapResult.snapTargetClipId,
            originalPosition: snapResult.originalPosition,
          });
          
          const snappedNewEndTime = snapResult.position;
          const snappedTrimAmount = snappedNewEndTime - (dragState.startTime + dragState.startDuration);
          
          // Apply constraints to the snapped trim amount
          const maxExtension = sourceDuration - currentOutPoint; // Can't extend beyond source
          const maxReduction = dragState.startDuration - 0.1; // Can't reduce to less than 0.1s
          
          const constrainedTrimAmount = Math.max(-maxReduction, Math.min(maxExtension, snappedTrimAmount));
          
          const proposedNewDuration = dragState.startDuration + constrainedTrimAmount;
          
          // Apply collision detection to prevent overlapping other clips
          const clipTrack = findTrackContainingClip(dragState.clipId);
          const collisionResult = getConstrainedTrimPosition(
            clipTrack,
            dragState.clipId,
            dragState.startTime,
            dragState.startDuration,
            dragState.startTime, // Start doesn't change for right trim
            proposedNewDuration
          );
          
          const newOutPoint = currentOutPoint + (collisionResult.duration - dragState.startDuration);
          
          // Set collision state for visual feedback
          setCollisionDetected(Math.abs(collisionResult.duration - proposedNewDuration) > 0.01);
          
          updateClip(dragState.clipId, { 
            duration: collisionResult.duration,
            outPoint: newOutPoint < sourceDuration ? newOutPoint : undefined
          }, true); // Skip history during drag
        }
      } else if (dragState.dragType === 'slip') {
        // Slip editing: shift inPoint and outPoint together while keeping clip position and duration fixed
        const deltaX = e.clientX - dragState.startX;
        const deltaTime = deltaX / pixelsPerSecond;
        
        // Calculate new in/out points
        const newInPoint = (dragState.startInPoint || 0) + deltaTime;
        const newOutPoint = (dragState.startOutPoint || 0) + deltaTime;
        
        // Constrain to source bounds
        const maxInPoint = sourceDuration - dragState.startDuration;
        const constrainedInPoint = Math.max(0, Math.min(maxInPoint, newInPoint));
        const constrainedOutPoint = constrainedInPoint + dragState.startDuration;
        
        // Update clip with new trim points while keeping start and duration the same
        updateClip(dragState.clipId, {
          inPoint: constrainedInPoint > 0 ? constrainedInPoint : undefined,
          outPoint: constrainedOutPoint < sourceDuration ? constrainedOutPoint : undefined
        }, true); // Skip history during drag
      }
    };

    const handleMouseUp = () => {
      const wasDragging = dragState.isDragging;
      const wasPlayheadDragging = playheadDrag.isDragging;
      const wasSelectionDragging = selectionDrag.isDragging;
      const wasPotentialDrag = selectionDrag.isPotentialDrag;
      
      if (wasDragging && dragState.clipId) {
        console.log(`🏁 Completed ${dragState.dragType} operation for clip ${dragState.clipId.slice(-4)}`);
        
        // Save history after operation completes
        if (dragState.historyAction) {
          console.log(`📚 Saving history after operation: ${dragState.historyAction}`);
          saveHistory(dragState.historyAction);
        }
      }
      
      // Handle seek if it was a potential drag that never became actual drag
      if (wasPotentialDrag && !wasSelectionDragging && timelineRef.current) {
        const trackLabelWidth = 100;
        const rulerHeight = 40;
        const clickX = selectionDrag.startX - trackLabelWidth;
        const clickY = selectionDrag.startY - rulerHeight;
        const clickTime = Math.max(0, clickX / pixelsPerSecond);
        const trackIndex = Math.floor(clickY / (40)); // track height
        
        if (clickY >= 0 && trackIndex >= 0 && trackIndex < project.timeline.tracks.length) {
          seek(clickTime);
          setSelectedTrackId(project.timeline.tracks[trackIndex].id);
        }
      }
      
      setDragState({
        isDragging: false,
        dragType: 'move',
        clipId: null,
        startX: 0,
        startY: 0,
        startTime: 0,
        startDuration: 0,
        originalTrackId: null,
        currentTrackId: null,
        originalPositions: undefined,
        historyAction: undefined,
        startInPoint: undefined,
        startOutPoint: undefined,
      });
      
      setPlayheadDrag({ isDragging: false });
      
      // End selection dragging
      setSelectionDrag({
        isDragging: false,
        isPotentialDrag: false,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
      });

      // Clear collision detection and snap state
      setCollisionDetected(false);
      setSnapState({
        isSnapped: false,
        snapPosition: 0,
        snapType: 'start',
        snapTargetClipId: null,
        originalPosition: 0,
      });

      // Set flag to prevent immediate timeline clicks after dragging
      if (wasDragging || wasPlayheadDragging || wasSelectionDragging) {
        setJustFinishedDragging(true);
        setTimeout(() => setJustFinishedDragging(false), 100);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when user is typing in input fields
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true') {
        return;
      }
      
      if (e.key === 's' || e.key === 'S') {
        if (selectedClipIds.length > 0) {
          handleSplitClip();
          e.preventDefault();
        }
      } else if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (selectedClipIds.length > 0) {
          copyClips();
        }
      } else if ((e.key === 'v' || e.key === 'V') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        pasteClips(selectedTrackId || undefined);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        selectedClipIds.forEach(clipId => removeClip(clipId));
      } else if (e.key === ' ') {
        e.preventDefault();
        playback.isPlaying ? pause() : play();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        pause();
      } else if (e.key === 'Home') {
        e.preventDefault();
        seek(0);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        // Create opacity keyframe for selected clip
        if (canvasSelectedClipId) {
          createOpacityKeyframe();
        }
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        // Create position keyframe for selected clip
        if (canvasSelectedClipId) {
          createPositionKeyframe();
        }
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        // Create rotation keyframe for selected clip
        if (canvasSelectedClipId) {
          createRotationKeyframe();
        }
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        // Create scale keyframe for selected clip
        if (canvasSelectedClipId) {
          createScaleKeyframe();
        }
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        if (e.shiftKey) {
          // Export all frames from selected video clip
          handleExportAllFrames();
        } else {
          // Take snapshot of selected video clip
          handleTakeSnapshot();
        }
      }
    };

    if (dragState.isDragging || playheadDrag.isDragging || selectionDrag.isDragging || selectionDrag.isPotentialDrag) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [dragState, playheadDrag, selectionDrag, updateClip, pixelsPerSecond, selectedClipIds, splitClip, copyClips, pasteClips, removeClip, playback.isPlaying, play, pause, seek, project.timeline.currentTime, project.timeline.duration]);

  const handleClipMouseDown = (e: React.MouseEvent, clip: Clip) => {
    e.stopPropagation();
    
    // Handle multi-selection with Ctrl/Cmd or Shift
    const isMultiSelect = e.ctrlKey || e.metaKey || e.shiftKey;
    const isAlreadySelected = selectedClipIds.includes(clip.id);
    
    // Only change selection if the clip isn't already selected, or if using multi-select modifiers
    if (!isAlreadySelected || isMultiSelect) {
      selectClip(clip.id, isMultiSelect);
      // Also select the clip in the canvas for keyframe visualization
      selectCanvasClip(clip.id);
    }

    // Update selected track based on the clip's track
    const clipTrack = findTrackContainingClip(clip.id);
    if (clipTrack) {
      setSelectedTrackId(clipTrack.id);
    }
    
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const relativeX = e.clientX - rect.left;
    const clipWidth = getEffectiveDuration(clip) * pixelsPerSecond;
    const edgeThreshold = 8; // pixels
    
    let dragType: 'move' | 'trim-left' | 'trim-right' = 'move';
    if (relativeX < edgeThreshold) {
      dragType = 'trim-left';
    } else if (relativeX > clipWidth - edgeThreshold) {
      dragType = 'trim-right';
    }
    
    const currentTrack = findTrackContainingClip(clip.id);
    
    // Store original positions for multi-clip dragging if this clip is part of a selection
    let originalPositions: { [clipId: string]: number } | undefined;
    if (dragType === 'move' && selectedClipIds.length > 1 && selectedClipIds.includes(clip.id)) {
      originalPositions = {};
      for (const track of project.timeline.tracks) {
        for (const trackClip of track.clips) {
          if (selectedClipIds.includes(trackClip.id)) {
            originalPositions[trackClip.id] = trackClip.start;
          }
        }
      }
    }
    
    // Store action info for saving history after operation completes
    const historyAction = dragType === 'move' ? 'Move clip' : 'Trim clip';
    const timestamp = Date.now();
    console.log(`🎯 Starting ${dragType} operation for clip ${clip.id.slice(-4)} at ${timestamp}`);

    setDragState({
      isDragging: true,
      dragType,
      clipId: clip.id,
      startX: e.clientX,
      startY: e.clientY,
      startTime: clip.start,
      startDuration: clip.duration,
      originalTrackId: currentTrack?.id || null,
      currentTrackId: currentTrack?.id || null,
      originalPositions,
      historyAction: `${historyAction} (${timestamp.toString().slice(-6)})`,
    });
  };

  const handleClipRightClick = (e: React.MouseEvent, clip: Clip) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Select the clip if it's not already selected
    if (!selectedClipIds.includes(clip.id)) {
      selectClip(clip.id, false);
      selectCanvasClip(clip.id);
    }

    // Update selected track based on the clip's track
    const clipTrack = findTrackContainingClip(clip.id);
    if (clipTrack) {
      setSelectedTrackId(clipTrack.id);
    }
    
    const asset = project.assets.find(a => a.id === clip.assetId);
    if (!asset) return;
    
    const timestamp = Date.now();
    console.log(`🎯 Starting slip operation for clip ${clip.id.slice(-4)} at ${timestamp}`);
    
    setDragState({
      isDragging: true,
      dragType: 'slip',
      clipId: clip.id,
      startX: e.clientX,
      startY: e.clientY,
      startTime: clip.start,
      startDuration: clip.duration,
      originalTrackId: clipTrack?.id || null,
      currentTrackId: clipTrack?.id || null,
      historyAction: `Slip clip (${timestamp.toString().slice(-6)})`,
      startInPoint: clip.inPoint || 0,
      startOutPoint: clip.outPoint || (asset.type === 'image' ? clip.duration : asset.duration) || clip.duration,
    });
  };

  const handleClipDelete = (clipId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeClip(clipId);
  };

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!timelineRef.current) return;
    
    // Don't seek if we're currently dragging or just finished dragging
    if (dragState.isDragging || justFinishedDragging || playheadDrag.isDragging || selectionDrag.isDragging || selectionDrag.isPotentialDrag) return;
    
    // Don't handle if clicking on keyframes
    const target = e.target as HTMLElement;
    if (target.closest('.keyframe')) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const scrollLeft = timelineRef.current.scrollLeft;
    const x = e.clientX - rect.left - 100 + scrollLeft; // Subtract track label width and add scroll offset
    const time = Math.max(0, x / pixelsPerSecond);
    
    seek(time);
    selectClip(null);
    selectCanvasClip(null);
  };

  const handleTimelineMouseDown = (e: React.MouseEvent) => {
    if (!timelineRef.current) return;
    
    // Don't start selection drag if clicking on clips or playhead
    const target = e.target as HTMLElement;
    if (target.closest('.clip') || target.closest('.playhead') || target.closest('.track-label')) {
      return;
    }
    
    const rect = timelineRef.current.getBoundingClientRect();
    const scrollLeft = timelineRef.current.scrollLeft;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check if clicking in empty space
    const trackLabelWidth = 100;
    const rulerHeight = 40;
    const trackHeight = 40;
    const clickX = x - trackLabelWidth + scrollLeft;
    const clickY = y - rulerHeight;
    const clickTime = Math.max(0, clickX / pixelsPerSecond);
    const trackIndex = Math.floor(clickY / trackHeight);
    
    // Check if there are any clips directly at the click position
    let clickingOnClip = false;
    
    if (trackIndex >= 0 && trackIndex < project.timeline.tracks.length) {
      const track = project.timeline.tracks[trackIndex];
      for (const clip of track.clips) {
        if (clip.start <= clickTime && clip.start + clip.duration >= clickTime) {
          clickingOnClip = true;
          break;
        }
      }
    }
    
    // Only proceed if clicking in valid track area and not on clips
    if (clickingOnClip || clickY < 0 || trackIndex < 0 || trackIndex >= project.timeline.tracks.length) {
      return;
    }
    
    // Start potential drag - will become actual drag on movement or seek on click
    setSelectionDrag({
      isDragging: false,
      isPotentialDrag: true,
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
    });
    
    // Clear current selection if not holding Ctrl/Cmd
    if (!e.ctrlKey && !e.metaKey) {
      selectClip(null);
      selectCanvasClip(null);
    }
  };

  const handlePlayheadMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPlayheadDrag({ isDragging: true });
  };

  const handleTrackDrop = (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    target.className = 'track-content';
    target.style.borderColor = 'transparent';
    
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.type === 'asset') {
        const asset = project.assets.find(a => a.id === data.assetId);
        const track = project.timeline.tracks.find(t => t.id === trackId);
        if (!asset || !track) return;

        // Check media type compatibility
        const isCompatible = 
          (track.type === 'video' && (asset.type === 'video' || asset.type === 'image')) ||
          (track.type === 'audio' && asset.type === 'audio');

        if (!isCompatible) {
          console.warn(`Cannot add ${asset.type} asset to ${track.type} track`);
          return;
        }

        // Calculate drop position
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        const scrollLeft = timelineRef.current?.scrollLeft || 0;
        const x = e.clientX - rect.left + scrollLeft;
        const rawDropTime = Math.max(0, x / pixelsPerSecond);
        const clipDuration = asset.duration || 5;
        
        // Find the next available space in the track  
        const dropTime = findNextAvailableSpace(track, rawDropTime, clipDuration);

        const clip = {
          id: uuidv4(),
          assetId: asset.id,
          start: dropTime,
          duration: clipDuration,
        };

        addClipToTrack(trackId, clip);
        
        // If this is a video asset, check if there's a corresponding audio asset
        if (asset.type === 'video') {
          const audioAssetName = `${asset.name} (Audio)`;
          const correspondingAudioAsset = project.assets.find(a => 
            a.type === 'audio' && a.name === audioAssetName
          );
          
          if (correspondingAudioAsset) {
            // Find or create an audio track
            let audioTrack = project.timeline.tracks.find(track => track.type === 'audio');
            
            if (!audioTrack) {
              // Create a new audio track if none exists
              addTrack('audio');
              audioTrack = project.timeline.tracks.find(track => track.type === 'audio');
            }
            
            if (audioTrack) {
              // Find the next available space in the audio track at the same time
              const audioDropTime = findNextAvailableSpace(audioTrack, dropTime, clipDuration);
              
              const audioClip = {
                id: uuidv4(),
                assetId: correspondingAudioAsset.id,
                start: audioDropTime, // Try to sync with video, but respect available space
                duration: correspondingAudioAsset.duration || clipDuration,
              };
              
              addClipToTrack(audioTrack.id, audioClip);
              console.log(`Added synchronized audio clip for ${asset.name} at time ${audioDropTime}`);
            }
          }
        }
      }
    } catch (error) {
      console.error('Drop error:', error);
    }
  };

  const handleTrackDragOver = (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      const track = project.timeline.tracks.find(t => t.id === trackId);
      if (!track) return;

      let isCompatible = false;

      if (data.type === 'asset') {
        const asset = project.assets.find(a => a.id === data.assetId);
        if (asset) {
          isCompatible = 
            (track.type === 'video' && (asset.type === 'video' || asset.type === 'image')) ||
            (track.type === 'audio' && asset.type === 'audio');
        }
      }

      // Set drag effect based on compatibility
      e.dataTransfer.dropEffect = isCompatible ? 'move' : 'none';
    } catch (error) {
      // If we can't parse the data, allow the drop by default
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * project.timeline.fps);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  };

  const renderTimeRuler = () => {
    const duration = project.timeline.duration;
    const ticks = [];
    
    // Determine tick interval based on zoom level
    let majorInterval: number;
    let minorInterval: number;
    
    if (pixelsPerSecond >= 500) {
      // Very zoomed in: show every 0.1s major, 0.05s minor
      majorInterval = 0.1;
      minorInterval = 0.05;
    } else if (pixelsPerSecond >= 200) {
      // Zoomed in: show every 0.5s major, 0.1s minor
      majorInterval = 0.5;
      minorInterval = 0.1;
    } else if (pixelsPerSecond >= 100) {
      // Zoomed in: show every 0.5s major, 0.25s minor
      majorInterval = 0.5;
      minorInterval = 0.25;
    } else if (pixelsPerSecond >= 50) {
      // Normal: show every 1s major, 0.5s minor
      majorInterval = 1;
      minorInterval = 0.5;
    } else if (pixelsPerSecond >= 25) {
      // Zoomed out: show every 2s major, 1s minor
      majorInterval = 2;
      minorInterval = 1;
    } else {
      // Very zoomed out: show every 5s major, 1s minor
      majorInterval = 5;
      minorInterval = 1;
    }
    
    // Generate major ticks
    for (let i = 0; i <= duration; i += majorInterval) {
      ticks.push(
        <div
          key={`major-${i}`}
          style={{
            position: 'absolute',
            left: i * pixelsPerSecond,
            top: 0,
            width: '1px',
            height: '20px',
            backgroundColor: '#666',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: '20px',
              left: '-20px',
              fontSize: '10px',
              color: '#aaa',
              width: '40px',
              textAlign: 'center',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              MozUserSelect: 'none',
              msUserSelect: 'none',
            }}
          >
            {formatTime(i)}
          </span>
        </div>
      );
    }
    
    // Generate minor ticks (only if zoom level is high enough to see them clearly)
    if (pixelsPerSecond >= 50) {
      for (let i = 0; i <= duration; i += minorInterval) {
        // Skip positions that already have major ticks
        if (i % majorInterval !== 0) {
          ticks.push(
            <div
              key={`minor-${i}`}
              style={{
                position: 'absolute',
                left: i * pixelsPerSecond,
                top: 0,
                width: '1px',
                height: '10px',
                backgroundColor: '#444',
              }}
            />
          );
        }
      }
    }
    
    return ticks;
  };

  // Calculate the height needed for keyframe lanes
  const getMaxKeyframeStackHeight = () => {
    // Keep original timeline height - keyframes fit within existing space
    return 40;
  };

  // Render keyframes for the canvas-selected clip
  const renderKeyframes = () => {
    // Get all selected clips (prioritize timeline selection, fallback to canvas selection)
    const clipsToShow = selectedClipIds.length > 0 ? selectedClipIds : (canvasSelectedClipId ? [canvasSelectedClipId] : []);
    
    if (clipsToShow.length === 0) return [];
    
    const allKeyframes: Array<{
      property: string;
      keyframe: any;
      index: number;
      effectiveTime: number;
      absoluteTime: number;
      leftPosition: number;
      icon: string;
      color: string;
      bgColor: string;
      clipId: string;
    }> = [];
    
    // Process each selected clip
    clipsToShow.forEach((clipId) => {
      const selectedClip = getClipById(clipId);
      const selectedTrack = selectedClip ? findTrackContainingClip(selectedClip.id) : null;
      
      if (!selectedClip || !selectedTrack) return;
      
      // Collect transform keyframes for video clips
      if (selectedClip.keyframes && selectedTrack.type === 'video') {
        Object.keys(selectedClip.keyframes).forEach((property) => {
          const propertyKeyframes = (selectedClip.keyframes as any)[property];
          if (!propertyKeyframes || propertyKeyframes.length === 0) return;
        
          // Determine icon and color based on property type
          let icon = '●';
          let color = '#fff';
          let bgColor = '#666';
          
          switch (property) {
            case 'position':
              icon = '⚬';
              color = '#fff';
              bgColor = '#007acc';
              break;
            case 'scale':
              icon = '⤡';
              color = '#fff';
              bgColor = '#ff6600';
              break;
            case 'rotation':
              icon = '↻';
              color = '#fff';
              bgColor = '#9933ff';
              break;
            case 'opacity':
              icon = '◐';
              color = '#fff';
              bgColor = '#00cc66';
              break;
            default:
              icon = '●';
              color = '#fff';
              bgColor = '#666';
              break;
          }
          
          propertyKeyframes.forEach((keyframe: any, index: number) => {
            // Use temporary position if this keyframe is being dragged
            let effectiveTime = keyframe.time;
            if (keyframeDragState.isDragging && 
                keyframeDragState.clipId === selectedClip.id && 
                keyframeDragState.property === property) {
              if (keyframeDragState.isShiftDrag) {
                // For shift+drag, only move the clone, not the original
                if (Math.abs(keyframeDragState.originalTime - keyframe.time) < 0.01) {
                  effectiveTime = keyframeDragState.currentTime;
                }
                // Original keyframe stays at its position
              } else {
                // For normal drag, move the keyframe being dragged
                if (Math.abs(keyframeDragState.originalKeyframeTime - keyframe.time) < 0.01) {
                  effectiveTime = keyframeDragState.currentTime;
                }
              }
            }
            
            const absoluteTime = selectedClip.start + effectiveTime;
            const leftPosition = absoluteTime * pixelsPerSecond;
            
            allKeyframes.push({
              property,
              keyframe,
              index,
              effectiveTime,
              absoluteTime,
              leftPosition,
              icon,
              color,
              bgColor,
              clipId: selectedClip.id
            });
          });
        });
      }

      // Collect audio keyframes for audio clips  
      if (selectedClip.audioKeyframes && selectedTrack.type === 'audio') {
        Object.keys(selectedClip.audioKeyframes).forEach((property) => {
          const propertyKeyframes = (selectedClip.audioKeyframes as any)[property];
          if (!propertyKeyframes || propertyKeyframes.length === 0) return;
        
          // Determine icon and color for audio properties
          let icon = '●';
          let color = '#fff';
          let bgColor = '#666';
          
          switch (property) {
            case 'volume':
              icon = '♪';
              color = '#fff';
              bgColor = '#00cc66';
              break;
            default:
              icon = '●';
              color = '#fff';
              bgColor = '#666';
              break;
          }
          
          propertyKeyframes.forEach((keyframe: any, index: number) => {
            // Use temporary position if this keyframe is being dragged
            let effectiveTime = keyframe.time;
            if (keyframeDragState.isDragging && 
                keyframeDragState.clipId === selectedClip.id && 
                keyframeDragState.property === property) {
              if (keyframeDragState.isShiftDrag) {
                // For shift+drag, only move the clone, not the original
                if (Math.abs(keyframeDragState.originalTime - keyframe.time) < 0.01) {
                  effectiveTime = keyframeDragState.currentTime;
                }
                // Original keyframe stays at its position
              } else {
                // For normal drag, move the keyframe being dragged
                if (Math.abs(keyframeDragState.originalKeyframeTime - keyframe.time) < 0.01) {
                  effectiveTime = keyframeDragState.currentTime;
                }
              }
            }
            
            const absoluteTime = selectedClip.start + effectiveTime;
            const leftPosition = absoluteTime * pixelsPerSecond;
            
            allKeyframes.push({
              property,
              keyframe,
              index,
              effectiveTime,
              absoluteTime,
              leftPosition,
              icon,
              color,
              bgColor,
              clipId: selectedClip.id
            });
          });
        });
      }
    });
    
    // Render keyframes with fixed positions for each property type
    const keyframes: JSX.Element[] = [];
    
    allKeyframes.forEach((kf) => {
      // Assign fixed Y positions for each property type (proper spacing)
      let topPosition: number;
      switch (kf.property) {
        case 'position':
          topPosition = 6; // Top lane for translate/position
          break;
        case 'rotation':
          topPosition = 16; // Second lane for rotation
          break;
        case 'scale':
          topPosition = 26; // Third lane for scale
          break;
        case 'opacity':
        case 'volume':
          topPosition = 36; // Bottom lane for opacity/volume
          break;
        default:
          topPosition = 46; // Fallback for unknown properties
          break;
      }
      
      keyframes.push(
        <div
          key={`${kf.clipId}-${kf.property}-${kf.index}`}
          className="keyframe"
          style={{
            position: 'absolute',
            left: kf.leftPosition - 6,
            top: topPosition,
            width: '12px',
            height: '12px',
            backgroundColor: kf.bgColor,
            color: kf.color,
            border: '1px solid white',
            borderRadius: '2px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '8px',
            cursor: 'pointer',
            zIndex: 15,
            userSelect: 'none',
            fontWeight: 'bold',
            lineHeight: '1',
          }}
          title={`${kf.property} keyframe at ${kf.effectiveTime.toFixed(2)}s`}
          onMouseDown={(e) => handleKeyframeMouseDown(e, kf.clipId, kf.property, kf.keyframe.time)}
          onContextMenu={(e) => handleKeyframeRightClick(e, kf.clipId, kf.property, kf.keyframe.time)}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Immediately jump to keyframe time on click
            const selectedClip = project.timeline.tracks
              .flatMap(track => track.clips)
              .find(clip => clip.id === kf.clipId);
            
            if (selectedClip) {
              const absoluteTime = selectedClip.start + kf.keyframe.time;
              seek(absoluteTime);
              
              // Auto-scroll to keep playhead in view
              setTimeout(() => {
                scrollToPlayhead();
              }, 10);
            }
          }}
        >
          {kf.icon}
        </div>
      );
    });
    
    // Add visual clone for shift+drag operations
    if (keyframeDragState.isDragging && keyframeDragState.isShiftDrag) {
      // Find the original keyframe being dragged
      const originalKeyframe = allKeyframes.find(kf => 
        kf.clipId === keyframeDragState.clipId &&
        kf.property === keyframeDragState.property &&
        Math.abs(kf.keyframe.time - keyframeDragState.originalTime) < 0.01
      );
      
      if (originalKeyframe) {
        // Calculate position for the clone
        const selectedClip = project.timeline.tracks
          .flatMap(track => track.clips)
          .find(clip => clip.id === keyframeDragState.clipId);
        
        if (selectedClip) {
          const absoluteTime = selectedClip.start + keyframeDragState.currentTime;
          const leftPosition = absoluteTime * pixelsPerSecond;
          
          // Determine Y position based on property type
          let topPosition: number;
          switch (keyframeDragState.property) {
            case 'position':
              topPosition = 6;
              break;
            case 'rotation':
              topPosition = 16;
              break;
            case 'scale':
              topPosition = 26;
              break;
            case 'opacity':
            case 'volume':
              topPosition = 36;
              break;
            default:
              topPosition = 46;
              break;
          }
          
          // Add the visual clone
          keyframes.push(
            <div
              key={`${keyframeDragState.clipId}-${keyframeDragState.property}-clone`}
              className="keyframe"
              style={{
                position: 'absolute',
                left: leftPosition - 6,
                top: topPosition,
                width: '12px',
                height: '12px',
                backgroundColor: originalKeyframe.bgColor,
                color: originalKeyframe.color,
                border: '2px solid #ffcc00', // Different border to indicate it's a clone
                borderRadius: '2px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '8px',
                cursor: 'pointer',
                zIndex: 20, // Higher z-index to appear on top
                userSelect: 'none',
                fontWeight: 'bold',
                lineHeight: '1',
                opacity: 0.8, // Slightly transparent to indicate it's a preview
              }}
              title={`Clone of ${keyframeDragState.property} keyframe at ${keyframeDragState.currentTime.toFixed(2)}s`}
            >
              {originalKeyframe.icon}
            </div>
          );
        }
      }
    }
    
    return keyframes;
  };

  // Handle keyframe mouse down for dragging
  // State for smooth keyframe dragging
  const [keyframeDragState, setKeyframeDragState] = useState<{
    isDragging: boolean;
    clipId: string | null;
    property: string | null;
    originalTime: number;
    currentTime: number;
    startX: number;
    isShiftDrag: boolean;
    originalKeyframeTime: number;
  }>({
    isDragging: false,
    clipId: null,
    property: null,
    originalTime: 0,
    currentTime: 0,
    startX: 0,
    isShiftDrag: false,
    originalKeyframeTime: 0
  });

  const handleKeyframeMouseDown = (e: React.MouseEvent, clipId: string, property: string, keyframeTime: number) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.button !== 0) return; // Only handle left click
    
    const startX = e.clientX;
    const startY = e.clientY;
    const shiftPressed = e.shiftKey; // Capture shift state at start
    let hasDragged = false;
    let dragStarted = false;
    
    // Get the original keyframe value for duplication
    const clip = getClipById(clipId);
    let originalKeyframeValue = null;
    let originalKeyframeEasing = 'linear';
    
    if (clip) {
      const isAudioProperty = property === 'volume';
      const keyframes = isAudioProperty ? 
        (clip.audioKeyframes as any)?.[property] : 
        (clip.keyframes as any)?.[property];
      
      if (keyframes) {
        const keyframe = keyframes.find((kf: any) => Math.abs(kf.time - keyframeTime) < 0.01);
        if (keyframe) {
          originalKeyframeValue = keyframe.value;
          originalKeyframeEasing = keyframe.easing || 'linear';
        }
      }
    }
    
    // For shift+drag, we'll handle visual feedback in the rendering logic
    // Don't create actual data until drag completes
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      // Consider it a drag if moved more than 5 pixels in any direction
      if (!hasDragged && distance > 5) {
        hasDragged = true;
        dragStarted = true;
        
        // Initialize drag state
        setKeyframeDragState({
          isDragging: true,
          clipId,
          property,
          originalTime: keyframeTime,
          currentTime: keyframeTime,
          startX,
          isShiftDrag: shiftPressed,
          originalKeyframeTime: keyframeTime
        });
      }
      
      // Only update position during mousemove if we've actually started dragging
      if (dragStarted) {
        const deltaTime = deltaX / pixelsPerSecond;
        const newTime = Math.max(0, keyframeTime + deltaTime);
        
        setKeyframeDragState(prev => ({
          ...prev,
          currentTime: newTime
        }));
      }
    };
    
    const handleMouseUp = (upEvent: MouseEvent) => {
      const deltaX = upEvent.clientX - startX;
      const deltaY = upEvent.clientY - startY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      // Use a higher threshold for drag detection to make clicking more reliable
      const actuallyDragged = distance > 5;
      
      if (actuallyDragged && dragStarted) {
        const deltaTime = deltaX / pixelsPerSecond;
        const finalTime = Math.max(0, keyframeTime + deltaTime);
        
        // Only commit if there's a meaningful time change
        if (Math.abs(finalTime - keyframeTime) > 0.01) {
          if (shiftPressed && originalKeyframeValue !== null) {
            // Shift+drag: Create duplicate keyframe at new position
            const isAudioProperty = property === 'volume';
            if (isAudioProperty) {
              updateClipTransform(clipId, property, originalKeyframeValue, finalTime, true);
            } else {
              updateClipTransform(clipId, property, originalKeyframeValue, finalTime, true);
            }
          } else {
            // Normal drag: Move keyframe
            moveKeyframe(clipId, property, keyframeTime, finalTime);
          }
        }
      }
      // For clicks or unsuccessful drags, do nothing (original keyframe stays)
      
      // Clear drag state
      setKeyframeDragState({
        isDragging: false,
        clipId: null,
        property: null,
        originalTime: 0,
        currentTime: 0,
        startX: 0,
        isShiftDrag: false,
        originalKeyframeTime: 0
      });
      
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Handle keyframe right click for deletion
  const handleKeyframeRightClick = (e: React.MouseEvent, clipId: string, property: string, keyframeTime: number) => {
    e.preventDefault();
    e.stopPropagation();
    
    removeKeyframe(clipId, property, keyframeTime);
  };

  // Helper functions for creating keyframes
  const createOpacityKeyframe = () => {
    if (!canvasSelectedClipId) return;
    
    const clip = getClipById(canvasSelectedClipId);
    if (!clip) return;
    
    const relativeTime = playback.currentTime - clip.start;
    if (relativeTime < 0 || relativeTime > clip.duration) return;
    
    // Get current transform to get current opacity value
    const currentTransform = getClipTransform(canvasSelectedClipId, relativeTime);
    if (!currentTransform) return;
    
    // For audio clips, create volume keyframe instead of opacity
    const track = findTrackContainingClip(canvasSelectedClipId);
    if (track?.type === 'audio') {
      // Create volume keyframe for audio clips
      updateClipTransform(canvasSelectedClipId, 'volume', currentTransform.opacity, relativeTime, true);
    } else {
      // Create opacity keyframe for video clips
      updateClipTransform(canvasSelectedClipId, 'opacity', currentTransform.opacity, relativeTime, true);
    }
  };

  const createPositionKeyframe = () => {
    if (!canvasSelectedClipId) return;
    
    const clip = getClipById(canvasSelectedClipId);
    if (!clip) return;
    
    const relativeTime = playback.currentTime - clip.start;
    if (relativeTime < 0 || relativeTime > clip.duration) return;
    
    const currentTransform = getClipTransform(canvasSelectedClipId, relativeTime);
    if (!currentTransform) return;
    
    updateClipTransform(canvasSelectedClipId, 'position', { x: currentTransform.x, y: currentTransform.y }, relativeTime, true);
  };

  const createRotationKeyframe = () => {
    if (!canvasSelectedClipId) return;
    
    const clip = getClipById(canvasSelectedClipId);
    if (!clip) return;
    
    const relativeTime = playback.currentTime - clip.start;
    if (relativeTime < 0 || relativeTime > clip.duration) return;
    
    const currentTransform = getClipTransform(canvasSelectedClipId, relativeTime);
    if (!currentTransform) return;
    
    updateClipTransform(canvasSelectedClipId, 'rotation', currentTransform.rotation, relativeTime, true);
  };

  const createScaleKeyframe = () => {
    if (!canvasSelectedClipId) return;
    
    const clip = getClipById(canvasSelectedClipId);
    if (!clip) return;
    
    const relativeTime = playback.currentTime - clip.start;
    if (relativeTime < 0 || relativeTime > clip.duration) return;
    
    const currentTransform = getClipTransform(canvasSelectedClipId, relativeTime);
    if (!currentTransform) return;
    
    updateClipTransform(canvasSelectedClipId, 'scale', { scaleX: currentTransform.scaleX, scaleY: currentTransform.scaleY }, relativeTime, true);
  };

  const getClipById = (clipId: string): Clip | null => {
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.id === clipId) return clip;
      }
    }
    return null;
  };



  const interpolateKeyframes = (keyframes: any[], time: number): any => {
    if (keyframes.length === 0) return null;
    
    // Sort keyframes by time
    const sortedKeyframes = [...keyframes].sort((a, b) => a.time - b.time);
    
    // If time is before the first keyframe or at the first keyframe, return the first keyframe's value
    if (time <= sortedKeyframes[0].time) {
      return sortedKeyframes[0].value;
    }
    
    // If time is after the last keyframe or at the last keyframe, return the last keyframe's value
    if (time >= sortedKeyframes[sortedKeyframes.length - 1].time) {
      return sortedKeyframes[sortedKeyframes.length - 1].value;
    }
    
    // Find the two keyframes to interpolate between
    for (let i = 0; i < sortedKeyframes.length - 1; i++) {
      const current = sortedKeyframes[i];
      const next = sortedKeyframes[i + 1];
      
      if (time >= current.time && time <= next.time) {
        // Interpolate with easing
        const t = (time - current.time) / (next.time - current.time);
        const easing = next.easing || 'linear';
        
        return interpolateWithEasing(current.value, next.value, t, easing);
      }
    }
    
    return sortedKeyframes[0].value;
  };

  const handleClipMouseMove = (e: React.MouseEvent, clip: Clip) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const relativeX = e.clientX - rect.left;
    const clipWidth = getEffectiveDuration(clip) * pixelsPerSecond;
    const edgeThreshold = 8;
    
    if (relativeX < edgeThreshold) {
      setCursorState({ clipId: clip.id, edge: 'left' });
    } else if (relativeX > clipWidth - edgeThreshold) {
      setCursorState({ clipId: clip.id, edge: 'right' });
    } else {
      setCursorState({ clipId: clip.id, edge: null });
    }
  };

  const handleClipMouseLeave = () => {
    setCursorState({ clipId: null, edge: null });
  };

  const getCursor = (clip: Clip) => {
    // Show slip cursor when slip editing is active
    if (dragState.isDragging && dragState.clipId === clip.id && dragState.dragType === 'slip') {
      return 'col-resize';
    }
    
    if (cursorState.clipId === clip.id) {
      if (cursorState.edge === 'left' || cursorState.edge === 'right') {
        return 'ew-resize';
      }
    }
    return 'move';
  };



  // Helper function to check if playhead is within any selected clip
  const isPlayheadInSelectedClip = () => {
    if (selectedClipIds.length === 0) return false;
    
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (selectedClipIds.includes(clip.id)) {
          const clipStart = clip.start;
          const clipEnd = clip.start + clip.duration;
          if (project.timeline.currentTime >= clipStart && project.timeline.currentTime <= clipEnd) {
            return true;
          }
        }
      }
    }
    return false;
  };

  // Helper function to get clips under playhead
  const getClipsUnderPlayhead = () => {
    const clipsUnderPlayhead: string[] = [];
    
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (selectedClipIds.includes(clip.id)) {
          const clipStart = clip.start;
          const clipEnd = clip.start + clip.duration;
          if (project.timeline.currentTime >= clipStart && project.timeline.currentTime <= clipEnd) {
            clipsUnderPlayhead.push(clip.id);
          }
        }
      }
    }
    return clipsUnderPlayhead;
  };

  // Helper function to handle split clip action
  const handleSplitClip = () => {
    const clipsToSplit = getClipsUnderPlayhead();
    
    if (clipsToSplit.length > 0) {
      // Split all clips that are under the playhead
      for (const clipId of clipsToSplit) {
        splitClip(clipId, project.timeline.currentTime);
      }
    }
  };

  // Helper function to get split button tooltip
  const getSplitButtonTooltip = () => {
    if (selectedClipIds.length === 0) {
      return "Select clips to split";
    }
    
    const clipsUnderPlayhead = getClipsUnderPlayhead();
    if (clipsUnderPlayhead.length === 0) {
      return "Move playhead inside selected clips to split";
    }
    
    if (clipsUnderPlayhead.length === 1) {
      return "Split clip at playhead position (S key)";
    } else {
      return `Split ${clipsUnderPlayhead.length} clips at playhead position (S key)`;
    }
  };

  // Helper function to handle reverse clip action
  const handleReverseClip = () => {
    if (selectedClipIds.length === 0) return;
    
    for (const clipId of selectedClipIds) {
      reverseClip(clipId);
    }
  };

  // Helper function to get reverse button tooltip
  const getReverseButtonTooltip = () => {
    if (selectedClipIds.length === 0) {
      return "Select a clip to reverse";
    }
    return "Reverse selected clips (makes them play backwards)";
  };

  // Helper function to handle snapshot action
  const handleTakeSnapshot = async () => {
    if (selectedClipIds.length === 0) return;
    
    // Get clips that are video clips and under the playhead
    const clipsUnderPlayhead = getClipsUnderPlayhead();
    const videoClipsUnderPlayhead = clipsUnderPlayhead.filter(clipId => {
      for (const track of project.timeline.tracks) {
        const clip = track.clips.find(c => c.id === clipId);
        if (clip) {
          const asset = project.assets.find(a => a.id === clip.assetId);
          return asset && asset.type === 'video';
        }
      }
      return false;
    });
    
    if (videoClipsUnderPlayhead.length === 0) return;
    
    // Take snapshot of the first video clip under playhead
    try {
      await takeSnapshot(videoClipsUnderPlayhead[0]);
    } catch (error) {
      console.error('Failed to take snapshot:', error);
    }
  };

  // Helper function to handle export all frames action
  const handleExportAllFrames = async () => {
    if (selectedClipIds.length === 0) return;
    
    // Get clips that are video clips and selected
    const selectedVideoClips = selectedClipIds.filter(clipId => {
      for (const track of project.timeline.tracks) {
        const clip = track.clips.find(c => c.id === clipId);
        if (clip) {
          const asset = project.assets.find(a => a.id === clip.assetId);
          return asset && asset.type === 'video';
        }
      }
      return false;
    });
    
    if (selectedVideoClips.length === 0) return;
    
    // Export frames from the first selected video clip
    try {
      await exportAllFrames(selectedVideoClips[0]);
    } catch (error) {
      console.error('Failed to export frames:', error);
    }
  };

  // Helper function to get snapshot button tooltip
  const getSnapshotButtonTooltip = () => {
    if (selectedClipIds.length === 0) {
      return "Select a video clip to take snapshot";
    }
    
    const clipsUnderPlayhead = getClipsUnderPlayhead();
    const videoClipsUnderPlayhead = clipsUnderPlayhead.filter(clipId => {
      for (const track of project.timeline.tracks) {
        const clip = track.clips.find(c => c.id === clipId);
        if (clip) {
          const asset = project.assets.find(a => a.id === clip.assetId);
          return asset && asset.type === 'video';
        }
      }
      return false;
    });
    
    if (videoClipsUnderPlayhead.length === 0) {
      return "Move playhead inside a selected video clip to take snapshot";
    }
    
    return "Take snapshot of current frame (saves image and copies to clipboard) - I key";
  };

  // Helper function to get export frames button tooltip
  const getExportFramesButtonTooltip = () => {
    if (selectedClipIds.length === 0) {
      return "Select a video clip to export all frames";
    }
    
    const selectedVideoClips = selectedClipIds.filter(clipId => {
      for (const track of project.timeline.tracks) {
        const clip = track.clips.find(c => c.id === clipId);
        if (clip) {
          const asset = project.assets.find(a => a.id === clip.assetId);
          return asset && asset.type === 'video';
        }
      }
      return false;
    });
    
    if (selectedVideoClips.length === 0) {
      return "No video clips selected - select a video clip to export frames";
    }
    
    return "Export all frames from selected video clip to folder (Shift+I key)";
  };

  // Helper function to get copy button tooltip
  const getCopyButtonTooltip = () => {
    if (selectedClipIds.length === 0) {
      return "Select clips to copy (Ctrl+C)";
    }
    return `Copy ${selectedClipIds.length} selected clip${selectedClipIds.length > 1 ? 's' : ''} (Ctrl+C)`;
  };

  // Helper function to get paste button tooltip
  const getPasteButtonTooltip = () => {
    const { clipboardClips } = useEditorStore.getState();
    if (clipboardClips.length === 0) {
      return "No clips to paste (Ctrl+V)";
    }
    const trackName = selectedTrackId ? project.timeline.tracks.find(t => t.id === selectedTrackId)?.name : 'default tracks';
    return `Paste ${clipboardClips.length} clip${clipboardClips.length > 1 ? 's' : ''} to ${trackName} (Ctrl+V)`;
  };

  const renderClip = (clip: Clip, trackType: 'video' | 'audio') => {
    const asset = project.assets.find(a => a.id === clip.assetId);
    if (!asset) return null;

    const clipWidth = getEffectiveDuration(clip) * pixelsPerSecond;
    const clipLeft = clip.start * pixelsPerSecond;

    return (
      <div
        key={clip.id}
        className={`clip ${selectedClipIds.includes(clip.id) ? 'selected' : ''} ${
          dragState.isDragging && dragState.clipId === clip.id && dragState.dragType !== 'move' ? 'trimming' : ''
        } ${
          dragState.isDragging && dragState.clipId === clip.id && dragState.dragType === 'slip' ? 'slipping' : ''
        } ${
          dragState.isDragging && dragState.clipId === clip.id && collisionDetected ? 'collision-detected' : ''
        } ${
          dragState.isDragging && dragState.clipId === clip.id && snapState.isSnapped ? 'snapped' : ''
        } ${
          dragState.isDragging && snapState.snapTargetClipId === clip.id ? 'snap-target' : ''
        }`}
        style={{
          left: clipLeft,
          width: clipWidth,
          backgroundColor: clip.reversed ? '#9933ff' : (trackType === 'video' ? '#007acc' : '#00cc66'),
          cursor: getCursor(clip),
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
        }}

        onMouseDown={(e) => handleClipMouseDown(e, clip)}
        onMouseMove={(e) => handleClipMouseMove(e, clip)}
        onMouseLeave={handleClipMouseLeave}
        onDoubleClick={(e) => handleClipDelete(clip.id, e)}
        onContextMenu={(e) => handleClipRightClick(e, clip)}
        title={`${asset.name} - Double click to delete, S to split, drag edges to trim, drag body to move freely, right-click drag to slip edit`}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '100%' }}>
          {/* Thumbnail for video and image clips */}
          {(asset.type === 'video' || asset.type === 'image') && asset.thumbnail && (
            <div style={{
              width: '20px',
              height: '20px',
              backgroundColor: '#222',
              border: '1px solid #333',
              borderRadius: '2px',
              overflow: 'hidden',
              flexShrink: 0,
              pointerEvents: 'none'
            }}>
              <img 
                src={asset.thumbnail} 
                alt={asset.name}
                draggable={false}
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  objectFit: 'cover',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  MozUserSelect: 'none',
                  msUserSelect: 'none',
                  pointerEvents: 'none'
                }} 
              />
            </div>
          )}
          
          {/* Waveform for audio clips */}
          {asset.type === 'audio' && asset.waveform && (
            <WaveformVisualization 
              clip={clip}
              asset={asset}
              clipWidth={clipWidth}
              pixelsPerSecond={pixelsPerSecond}
            />
          )}
          
          {/* Asset name */}
          <span style={{ 
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            zIndex: 10,
            position: 'relative',
            pointerEvents: 'none'
          }}>
            {asset.name}
          </span>
        </div>
        {selectedClipIds.includes(clip.id) && (
          <>
            <button
              style={{
                position: 'absolute',
                right: '2px',
                top: '2px',
                width: '16px',
                height: '16px',
                fontSize: '10px',
                padding: 0,
                background: '#ff4444',
                border: 'none',
                borderRadius: '2px',
                color: 'white',
                cursor: 'pointer',
              }}
              onClick={(e) => handleClipDelete(clip.id, e)}
            >
              ×
            </button>
            <div style={{
              position: 'absolute',
              bottom: '2px',
              right: '2px',
              fontSize: '9px',
              color: '#fff',
              backgroundColor: 'rgba(0,0,0,0.7)',
              padding: '1px 3px',
              borderRadius: '2px',
            }}>
              S
            </div>
          </>
        )}
      </div>
    );
  };



  return (
    <div className="timeline" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Timeline content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="timeline-header">
          <button 
            onClick={() => addTrack('video')}
            style={{ 
              fontSize: '12px', 
              padding: '4px 8px',
              backgroundColor: '#007acc',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              marginRight: '5px'
            }}
            title="Add Video Track (adds to top)"
          >
            + Video
          </button>
          <button 
            onClick={() => addTrack('audio')}
            style={{ 
              fontSize: '12px', 
              padding: '4px 8px',
              backgroundColor: '#00cc66',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              marginRight: '5px'
            }}
            title="Add Audio Track (adds to bottom)"
          >
            + Audio
          </button>
          <button 
            onClick={handleSplitClip}
            disabled={selectedClipIds.length === 0 || getClipsUnderPlayhead().length === 0}
            style={{ 
              fontSize: '12px', 
              padding: '4px 8px',
              backgroundColor: (selectedClipIds.length > 0 && getClipsUnderPlayhead().length > 0) ? '#ff6600' : '#666',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              marginRight: '5px',
              cursor: (selectedClipIds.length > 0 && getClipsUnderPlayhead().length > 0) ? 'pointer' : 'not-allowed'
            }}
            title={getSplitButtonTooltip()}
          >
            ✂️ Split
          </button>
          <button 
            onClick={handleReverseClip}
            disabled={selectedClipIds.length === 0}
            style={{ 
              fontSize: '12px', 
              padding: '4px 8px',
              backgroundColor: selectedClipIds.length > 0 ? '#9933ff' : '#666',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              marginRight: '5px',
              cursor: selectedClipIds.length > 0 ? 'pointer' : 'not-allowed'
            }}
            title={getReverseButtonTooltip()}
          >
            🔄 Reverse
          </button>
          <button 
            onClick={handleTakeSnapshot}
            disabled={(() => {
              if (selectedClipIds.length === 0) return true;
              const clipsUnderPlayhead = getClipsUnderPlayhead();
              const videoClipsUnderPlayhead = clipsUnderPlayhead.filter(clipId => {
                for (const track of project.timeline.tracks) {
                  const clip = track.clips.find(c => c.id === clipId);
                  if (clip) {
                    const asset = project.assets.find(a => a.id === clip.assetId);
                    return asset && asset.type === 'video';
                  }
                }
                return false;
              });
              return videoClipsUnderPlayhead.length === 0;
            })()}
            style={{ 
              fontSize: '12px', 
              padding: '4px 8px',
              backgroundColor: (() => {
                if (selectedClipIds.length === 0) return '#666';
                const clipsUnderPlayhead = getClipsUnderPlayhead();
                const videoClipsUnderPlayhead = clipsUnderPlayhead.filter(clipId => {
                  for (const track of project.timeline.tracks) {
                    const clip = track.clips.find(c => c.id === clipId);
                    if (clip) {
                      const asset = project.assets.find(a => a.id === clip.assetId);
                      return asset && asset.type === 'video';
                    }
                  }
                  return false;
                });
                return videoClipsUnderPlayhead.length > 0 ? '#ff6b35' : '#666';
              })(),
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              marginRight: '5px',
              cursor: (() => {
                if (selectedClipIds.length === 0) return 'not-allowed';
                const clipsUnderPlayhead = getClipsUnderPlayhead();
                const videoClipsUnderPlayhead = clipsUnderPlayhead.filter(clipId => {
                  for (const track of project.timeline.tracks) {
                    const clip = track.clips.find(c => c.id === clipId);
                    if (clip) {
                      const asset = project.assets.find(a => a.id === clip.assetId);
                      return asset && asset.type === 'video';
                    }
                  }
                  return false;
                });
                return videoClipsUnderPlayhead.length > 0 ? 'pointer' : 'not-allowed';
              })()
            }}
            title={getSnapshotButtonTooltip()}
          >
            📸 Snapshot
          </button>
          <button 
            onClick={handleExportAllFrames}
            disabled={(() => {
              if (selectedClipIds.length === 0) return true;
              const selectedVideoClips = selectedClipIds.filter(clipId => {
                for (const track of project.timeline.tracks) {
                  const clip = track.clips.find(c => c.id === clipId);
                  if (clip) {
                    const asset = project.assets.find(a => a.id === clip.assetId);
                    return asset && asset.type === 'video';
                  }
                }
                return false;
              });
              return selectedVideoClips.length === 0;
            })()}
            style={{ 
              fontSize: '12px', 
              padding: '4px 8px',
              backgroundColor: (() => {
                if (selectedClipIds.length === 0) return '#666';
                const selectedVideoClips = selectedClipIds.filter(clipId => {
                  for (const track of project.timeline.tracks) {
                    const clip = track.clips.find(c => c.id === clipId);
                    if (clip) {
                      const asset = project.assets.find(a => a.id === clip.assetId);
                      return asset && asset.type === 'video';
                    }
                  }
                  return false;
                });
                return selectedVideoClips.length > 0 ? '#4a90e2' : '#666';
              })(),
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              marginRight: '5px',
              cursor: (() => {
                if (selectedClipIds.length === 0) return 'not-allowed';
                const selectedVideoClips = selectedClipIds.filter(clipId => {
                  for (const track of project.timeline.tracks) {
                    const clip = track.clips.find(c => c.id === clipId);
                    if (clip) {
                      const asset = project.assets.find(a => a.id === clip.assetId);
                      return asset && asset.type === 'video';
                    }
                  }
                  return false;
                });
                return selectedVideoClips.length > 0 ? 'pointer' : 'not-allowed';
              })()
            }}
            title={getExportFramesButtonTooltip()}
          >
            🎞️ Export Frames
          </button>
          <button 
            onClick={copyClips}
            disabled={selectedClipIds.length === 0}
            style={{ 
              fontSize: '12px', 
              padding: '4px 8px',
              backgroundColor: selectedClipIds.length > 0 ? '#00cc99' : '#666',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              marginRight: '5px',
              cursor: selectedClipIds.length > 0 ? 'pointer' : 'not-allowed'
            }}
            title={getCopyButtonTooltip()}
          >
            📋 Copy
          </button>
          <button 
            onClick={() => pasteClips(selectedTrackId || undefined)}
            style={{ 
              fontSize: '12px', 
              padding: '4px 8px',
              backgroundColor: '#00aa77',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              marginRight: '15px',
              cursor: 'pointer'
            }}
            title={getPasteButtonTooltip()}
          >
            📄 Paste
          </button>
          
          {/* Snap Toggle */}
          <button 
            onClick={() => {
              setSnapEnabled(!snapEnabled);
              // Clear snap state when disabling
              if (snapEnabled) {
                setSnapState({
                  isSnapped: false,
                  snapPosition: 0,
                  snapType: 'start',
                  snapTargetClipId: null,
                  originalPosition: 0,
                });
              }
            }}
            style={{ 
              fontSize: '12px', 
              padding: '4px 8px',
              backgroundColor: snapEnabled ? '#00cc66' : '#666',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              marginRight: '15px',
              cursor: 'pointer'
            }}
            title={snapEnabled ? "Disable snapping" : "Enable snapping"}
          >
            🧲 {snapEnabled ? 'ON' : 'OFF'}
          </button>
          
          {/* Zoom Controls */}
          <div style={{ display: 'flex', alignItems: 'center', marginRight: '15px', gap: '5px' }}>
            <button 
              onClick={zoomOut}
              disabled={currentZoomIndex === 0}
              style={{ 
                fontSize: '12px', 
                padding: '4px 8px',
                backgroundColor: currentZoomIndex > 0 ? '#4a90e2' : '#666',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: currentZoomIndex > 0 ? 'pointer' : 'not-allowed'
              }}
              title="Zoom out (-)"
            >
              🔍−
            </button>
            <span style={{ fontSize: '11px', color: '#aaa', minWidth: '60px', textAlign: 'center' }}>
              {pixelsPerSecond}px/s
            </span>
            <button 
              onClick={zoomIn}
              disabled={currentZoomIndex === zoomLevels.length - 1}
              style={{ 
                fontSize: '12px', 
                padding: '4px 8px',
                backgroundColor: currentZoomIndex < zoomLevels.length - 1 ? '#4a90e2' : '#666',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: currentZoomIndex < zoomLevels.length - 1 ? 'pointer' : 'not-allowed'
              }}
              title="Zoom in (+)"
            >
              🔍+
            </button>
          </div>
          
          <button onClick={playback.isPlaying ? pause : play}>
            {playback.isPlaying ? '⏸️' : '▶️'}
          </button>
          <button onClick={stop}>⏹️</button>
          <span style={{ marginLeft: '10px', fontSize: '12px' }}>
            {formatTime(project.timeline.currentTime)} / {formatTime(project.timeline.duration)}
          </span>
          <input
            type="range"
            min="0"
            max={project.timeline.duration}
            step="0.1"
            value={project.timeline.currentTime}
            onChange={(e) => seek(parseFloat(e.target.value))}
            style={{ marginLeft: '10px', flex: 1 }}
          />
        </div>
      
      <div 
        className="timeline-tracks" 
        ref={timelineRef} 
        onClick={handleTimelineClick}
        onMouseDown={handleTimelineMouseDown}
        style={{ 
          position: 'relative',
          overflowX: 'auto',
          overflowY: 'visible',
          minWidth: `${100 + Math.max(project.timeline.duration * pixelsPerSecond, 1000)}px`
        }}
      >
        {/* Time ruler */}
        <div
          style={{
            position: 'relative',
            height: `${Math.max(40, (selectedClipIds.length > 0 || canvasSelectedClipId) ? getMaxKeyframeStackHeight() : 40)}px`,
            borderBottom: '1px solid #555',
            marginLeft: '100px',
            cursor: 'pointer',
            overflow: 'visible',
            minWidth: `${Math.max(project.timeline.duration * pixelsPerSecond, 1000)}px`
          }}
          onClick={(e) => {
            // Handle clicks on the time ruler to jump playhead (preserve selection)
            e.stopPropagation(); // Prevent bubbling to timeline click handler
            const rect = e.currentTarget.getBoundingClientRect();
            const scrollLeft = timelineRef.current?.scrollLeft || 0;
            const x = e.clientX - rect.left + scrollLeft;
            const time = Math.max(0, Math.min(x / pixelsPerSecond, project.timeline.duration));
            seek(time);
          }}
        >
          {renderTimeRuler()}
          {renderKeyframes()}
        </div>

        {/* Tracks */}
        {project.timeline.tracks.map((track, index) => {
          // Check if this is the last video track before audio tracks
          const isLastVideoBeforeAudio = track.type === 'video' && 
            index < project.timeline.tracks.length - 1 && 
            project.timeline.tracks[index + 1].type === 'audio';
          
          return (
            <div 
              key={track.id} 
              className="track"
              style={{
                borderBottom: isLastVideoBeforeAudio ? '3px solid #666' : '1px solid #333',
                display: 'block',
                position: 'relative',
                minWidth: `${100 + Math.max(project.timeline.duration * pixelsPerSecond, 1000)}px`
              }}
            >
            <div 
              className="track-label" 
              onClick={() => {
                setSelectedTrackId(track.id);
                selectClip(null);
                selectCanvasClip(null);
              }}
              style={{
                userSelect: 'none',
                WebkitUserSelect: 'none',
                MozUserSelect: 'none',
                msUserSelect: 'none',
                backgroundColor: selectedTrackId === track.id ? '#0066cc' : '#333',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
                border: selectedTrackId === track.id ? '2px solid #00aaff' : '2px solid transparent',
                position: 'absolute',
                left: '0',
                top: '0',
                width: '100px',
                height: '100%',
                zIndex: 10
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div>
                  {track.name}
                  <div style={{ fontSize: '10px', opacity: 0.7 }}>
                    {track.type.toUpperCase()}
                  </div>
                </div>
                <button
                  onClick={() => removeTrack(track.id)}
                  style={{
                    width: '20px',
                    height: '20px',
                    fontSize: '12px',
                    padding: 0,
                    backgroundColor: '#ff4444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  title={`Delete ${track.name} and all its clips`}
                >
                  🗑️
                </button>
              </div>
            </div>
            <div 
              className="track-content"
              onDrop={(e) => handleTrackDrop(e, track.id)}
              onDragOver={(e) => handleTrackDragOver(e, track.id)}
              style={{ 
                minHeight: '30px',
                border: '2px dashed transparent',
                transition: 'border-color 0.2s, background-color 0.2s',
                backgroundColor: selectedTrackId === track.id ? '#001122' : '#1a1a1a',
                marginLeft: '100px',
                minWidth: `${Math.max(project.timeline.duration * pixelsPerSecond, 1000)}px`,
                width: `${Math.max(project.timeline.duration * pixelsPerSecond, 1000)}px`
              }}
              onDragEnter={(e) => {
                const target = e.currentTarget;
                const dragAssetType = (window as any).currentDragAssetType;
                
                if (dragAssetType) {
                  const currentTrack = project.timeline.tracks.find(t => t.id === track.id);
                  
                  if (currentTrack) {
                    const isCompatible = 
                      (currentTrack.type === 'video' && (dragAssetType === 'video' || dragAssetType === 'image')) ||
                      (currentTrack.type === 'audio' && dragAssetType === 'audio');

                    // Only show drop zone for compatible tracks
                    if (isCompatible) {
                      target.className = 'track-content drag-compatible';
                    }
                    // Incompatible tracks get no visual feedback
                  }
                }
              }}
              onDragLeave={(e) => {
                const target = e.currentTarget;
                target.className = 'track-content';
                target.style.borderColor = 'transparent';
              }}
            >
              {track.clips.map((clip) => renderClip(clip, track.type))}
            </div>
          </div>
        );
        })}

        {/* Selection Rectangle */}
        {selectionDrag.isDragging && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(selectionDrag.startX, selectionDrag.currentX),
              top: Math.min(selectionDrag.startY, selectionDrag.currentY),
              width: Math.abs(selectionDrag.currentX - selectionDrag.startX),
              height: Math.abs(selectionDrag.currentY - selectionDrag.startY),
              border: '1px dashed #007acc',
              backgroundColor: 'rgba(0, 122, 204, 0.1)',
              pointerEvents: 'none',
              zIndex: 1000
            }}
          />
        )}

        {/* Playhead */}
        <div
          className="playhead"
          style={{
            left: 100 + project.timeline.currentTime * pixelsPerSecond,
            top: '40px', // Start after the time ruler
            height: `${project.timeline.tracks.length * 40}px`, // Height of all tracks
            cursor: playheadDrag.isDragging ? 'grabbing' : 'grab'
          }}
          onMouseDown={handlePlayheadMouseDown}
        />
      </div>
      </div>
    </div>
  );
};

export default Timeline; 