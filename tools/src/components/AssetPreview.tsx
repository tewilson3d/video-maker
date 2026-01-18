import React, { useRef, useEffect, useState } from 'react';
import { Asset } from '../types';
import { renderWaveform } from '../utils/waveform';

interface AssetPreviewProps {
  asset: Asset | null;
  isOpen: boolean;
  onClose: () => void;
}

const AssetPreview: React.FC<AssetPreviewProps> = ({ asset, isOpen, onClose }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Reset state when asset changes
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [asset]);

  // Handle media events
  useEffect(() => {
    if (!asset || !isOpen) return;

    const mediaElement = asset.type === 'video' ? videoRef.current : audioRef.current;
    if (!mediaElement) return;

    const handleLoadedMetadata = () => {
      setDuration(mediaElement.duration);
      setCurrentTime(0);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(mediaElement.currentTime);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      mediaElement.currentTime = 0;
    };

    mediaElement.addEventListener('loadedmetadata', handleLoadedMetadata);
    mediaElement.addEventListener('timeupdate', handleTimeUpdate);
    mediaElement.addEventListener('play', handlePlay);
    mediaElement.addEventListener('pause', handlePause);
    mediaElement.addEventListener('ended', handleEnded);

    // Load the media
    if (asset.src && mediaElement.src !== asset.src) {
      mediaElement.src = asset.src;
    }

    return () => {
      mediaElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
      mediaElement.removeEventListener('timeupdate', handleTimeUpdate);
      mediaElement.removeEventListener('play', handlePlay);
      mediaElement.removeEventListener('pause', handlePause);
      mediaElement.removeEventListener('ended', handleEnded);
    };
  }, [asset, isOpen]);

  // Render waveform for audio
  useEffect(() => {
    if (asset?.type === 'audio' && asset.waveform && waveformCanvasRef.current) {
      const canvas = waveformCanvasRef.current;
      renderWaveform(
        canvas,
        asset.waveform,
        0,
        asset.waveform.length,
        400,
        60,
        '#00ff88'
      );
    }
  }, [asset]);

  // Handle mouse events on document when dragging
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDragging || !timelineRef.current || duration === 0 || !asset) return;
      
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const progress = clickX / rect.width;
      const newTime = progress * duration;
      
      setCurrentTime(newTime);
      
      const mediaElement = asset.type === 'video' ? videoRef.current : audioRef.current;
      if (mediaElement) {
        mediaElement.currentTime = newTime;
      }
    };

    const handleGlobalMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, duration, asset]);

  if (!isOpen || !asset) return null;

  const togglePlayPause = () => {
    const mediaElement = asset.type === 'video' ? videoRef.current : audioRef.current;
    if (!mediaElement) return;

    if (isPlaying) {
      mediaElement.pause();
    } else {
      mediaElement.play();
    }
  };

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!timelineRef.current || duration === 0) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const progress = clickX / rect.width;
    const newTime = progress * duration;
    
    setCurrentTime(newTime);
    
    const mediaElement = asset.type === 'video' ? videoRef.current : audioRef.current;
    if (mediaElement) {
      mediaElement.currentTime = newTime;
    }
  };

  const handleTimelineMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    handleTimelineClick(e); // Immediately seek to clicked position
  };

  const handleTimelineMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !timelineRef.current || duration === 0) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const progress = clickX / rect.width;
    const newTime = progress * duration;
    
    setCurrentTime(newTime);
    
    const mediaElement = asset.type === 'video' ? videoRef.current : audioRef.current;
    if (mediaElement) {
      mediaElement.currentTime = newTime;
    }
  };

  const handleTimelineMouseUp = () => {
    setIsDragging(false);
  };



  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * 30); // Use 30fps for asset preview
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  };

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#2a2a2a',
          borderRadius: '8px',
          padding: '20px',
          minWidth: '500px',
          maxWidth: '800px',
          maxHeight: '90vh',
          overflow: 'auto',
          border: '1px solid #555',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '20px' 
        }}>
          <h3 style={{ color: 'white', margin: 0 }}>{asset.name}</h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'white',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0',
              width: '30px',
              height: '30px',
            }}
          >
            ×
          </button>
        </div>

        {/* Preview Area */}
        <div style={{ 
          backgroundColor: '#1a1a1a', 
          borderRadius: '4px', 
          padding: '10px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '200px'
        }}>
          {asset.type === 'image' && (
            <img
              src={asset.src}
              alt={asset.name}
              style={{
                maxWidth: '100%',
                maxHeight: '400px',
                objectFit: 'contain',
              }}
            />
          )}

          {asset.type === 'video' && (
            <video
              ref={videoRef}
              style={{
                maxWidth: '100%',
                maxHeight: '400px',
                backgroundColor: '#000',
              }}
              controls={false}
              muted={false} // Keep audio enabled in preview - this is a standalone preview
            />
          )}

          {asset.type === 'audio' && (
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center',
              gap: '20px',
              width: '100%'
            }}>
              <div style={{
                fontSize: '48px',
                color: '#666',
              }}>
                🎵
              </div>
              
              {/* Waveform */}
              {asset.waveform && (
                <div style={{ position: 'relative', width: '400px', height: '60px' }}>
                  <canvas
                    ref={waveformCanvasRef}
                    style={{
                      width: '100%',
                      height: '100%',
                      border: '1px solid #555',
                      borderRadius: '4px',
                    }}
                  />
                  {/* Progress overlay */}
                  {duration > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: `${(currentTime / duration) * 100}%`,
                        height: '100%',
                        backgroundColor: 'rgba(255, 255, 255, 0.3)',
                        pointerEvents: 'none',
                        borderRadius: '4px',
                      }}
                    />
                  )}
                </div>
              )}
              
              <audio ref={audioRef} />
            </div>
          )}
        </div>

        {/* Controls for video and audio */}
        {(asset.type === 'video' || asset.type === 'audio') && (
          <div style={{ color: 'white' }}>
            {/* Play/Pause Button */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '15px',
              marginBottom: '15px' 
            }}>
              <button
                onClick={togglePlayPause}
                style={{
                  backgroundColor: '#4a90e2',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                {isPlaying ? '⏸️ Pause' : '▶️ Play'}
              </button>
              
              <span style={{ fontSize: '14px', color: '#ccc' }}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            {/* Timeline */}
            <div 
              ref={timelineRef}
              onMouseDown={handleTimelineMouseDown}
              onMouseMove={handleTimelineMouseMove}
              onMouseUp={handleTimelineMouseUp}
              style={{
                width: '100%',
                height: '8px',
                backgroundColor: '#444',
                borderRadius: '4px',
                cursor: isDragging ? 'grabbing' : 'pointer',
                position: 'relative',
                userSelect: 'none',
              }}
            >
              {/* Progress */}
              <div
                style={{
                  width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%',
                  height: '100%',
                  backgroundColor: '#4a90e2',
                  borderRadius: '4px',
                  transition: 'width 0.1s ease',
                }}
              />
              
              {/* Playhead */}
              <div
                style={{
                  position: 'absolute',
                  left: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '12px',
                  height: '12px',
                  backgroundColor: '#ffffff',
                  borderRadius: '50%',
                  border: '2px solid #4a90e2',
                }}
              />
            </div>
          </div>
        )}

        {/* Asset Info */}
        <div style={{ 
          marginTop: '20px', 
          fontSize: '12px', 
          color: '#aaa',
          borderTop: '1px solid #444',
          paddingTop: '15px'
        }}>
          <div>Type: {asset.type.toUpperCase()}</div>
          {asset.duration && (
            <div>Duration: {formatTime(asset.duration)}</div>
          )}
          {asset.width && asset.height && (
            <div>Dimensions: {asset.width} × {asset.height}</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AssetPreview; 