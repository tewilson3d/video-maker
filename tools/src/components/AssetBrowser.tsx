import React, { useState } from 'react';
import { useEditorStore } from '../store';
import { v4 as uuidv4 } from 'uuid';
import { Asset } from '../types';
import AssetPreview from './AssetPreview';

const AssetBrowser: React.FC = () => {
  const { project, selectedAssetId, selectAsset, addClipToTrack } = useEditorStore();
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const handleAssetSelect = (assetId: string) => {
    selectAsset(assetId === selectedAssetId ? null : assetId);
  };

  const handleAssetDoubleClick = (assetId: string) => {
    const asset = project.assets.find(a => a.id === assetId);
    if (!asset) return;

    // Open preview modal instead of adding to timeline
    setPreviewAsset(asset);
    setShowPreview(true);
  };

  const handleAddToTimeline = (assetId: string) => {
    const asset = project.assets.find(a => a.id === assetId);
    if (!asset) return;

    // Find the first track that matches the asset type
    const targetTrack = project.timeline.tracks.find(track => 
      (asset.type === 'video' || asset.type === 'image') && track.type === 'video' ||
      asset.type === 'audio' && track.type === 'audio'
    );

    if (targetTrack) {
      const clip = {
        id: uuidv4(),
        assetId: asset.id,
        start: project.timeline.currentTime,
        duration: asset.duration || 5, // Default 5 seconds for all media types
      };

      addClipToTrack(targetTrack.id, clip);
      
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
            const { addTrack } = useEditorStore.getState();
            addTrack('audio');
            audioTrack = project.timeline.tracks.find(track => track.type === 'audio');
          }
          
          if (audioTrack) {
            const audioClip = {
              id: uuidv4(),
              assetId: correspondingAudioAsset.id,
              start: project.timeline.currentTime, // Same start time as video
              duration: correspondingAudioAsset.duration || asset.duration || 5,
            };
            
            addClipToTrack(audioTrack.id, audioClip);
            console.log(`Added synchronized audio clip for ${asset.name}`);
          }
        }
      }
    }
  };

  const closePreview = () => {
    setShowPreview(false);
    setPreviewAsset(null);
  };

  const handleDragStart = (e: React.DragEvent, asset: any) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'asset',
      assetId: asset.id,
    }));
    // Store the asset type globally for drag compatibility checks
    (window as any).currentDragAssetType = asset.type;
  };

  const handleDragEnd = () => {
    // Clean up global drag state
    (window as any).currentDragAssetType = null;
  };

  return (
    <>
      <div style={{ padding: '10px' }}>
        <h3 style={{ marginBottom: '10px', fontSize: '14px' }}>Assets</h3>
        <div style={{ marginBottom: '10px', fontSize: '11px', color: '#aaa', fontStyle: 'italic' }}>
          💡 Double-click to preview • Drag to timeline • + to add<br/>
          🎬 MP4 videos with audio will create both video and audio tracks automatically
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {project.assets.map((asset) => (
            <div
              key={asset.id}
              className={`asset-item ${selectedAssetId === asset.id ? 'selected' : ''}`}
              onClick={() => handleAssetSelect(asset.id)}
              onDoubleClick={() => handleAssetDoubleClick(asset.id)}
              draggable
              onDragStart={(e) => handleDragStart(e, asset)}
              onDragEnd={handleDragEnd}
              style={{
                backgroundColor: selectedAssetId === asset.id ? '#007acc' : '#3a3a3a',
                cursor: 'grab',
                userSelect: 'none',
                position: 'relative'
              }}
              title={`Double-click to preview, drag to timeline, or use + button to add`}
            >
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                padding: '6px 8px',
                fontSize: '11px',
                height: '30px',
                position: 'relative'
              }}>
                {/* Asset type icon */}
                <span style={{ marginRight: '6px', fontSize: '12px' }}>
                  {asset.type === 'video' && '🎬'}
                  {asset.type === 'audio' && '🔊'}
                  {asset.type === 'image' && '🖼️'}
                </span>
                
                {/* Asset name */}
                <span style={{ 
                  flex: 1, 
                  overflow: 'hidden', 
                  textOverflow: 'ellipsis', 
                  whiteSpace: 'nowrap' 
                }}>
                  {asset.name}
                </span>
                
                {/* Audio indicator for videos with audio */}
                {asset.type === 'video' && project.assets.some(a => 
                  a.type === 'audio' && a.name === `${asset.name} (Audio)`
                ) && (
                  <span 
                    style={{ 
                      marginLeft: '4px', 
                      fontSize: '10px',
                      backgroundColor: '#00cc66',
                      color: 'white',
                      padding: '1px 3px',
                      borderRadius: '2px',
                      fontWeight: 'bold'
                    }}
                    title="This video has audio that will be added automatically"
                  >
                    🔊
                  </span>
                )}
                
                {/* Duration display */}
                {asset.duration && (
                  <span style={{ 
                    marginLeft: '4px', 
                    fontSize: '9px', 
                    color: '#aaa' 
                  }}>
                    {Math.round(asset.duration)}s
                  </span>
                )}
              </div>
              
              {/* Add to Timeline Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddToTimeline(asset.id);
                }}
                style={{
                  position: 'absolute',
                  top: '6px',
                  right: '6px',
                  width: '24px',
                  height: '24px',
                  borderRadius: '6px',
                  backgroundColor: '#00cc66',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0.8,
                  fontWeight: 'bold'
                }}
                title="Add to timeline at current time"
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '1';
                  e.currentTarget.style.transform = 'scale(1.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '0.8';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                +
              </button>
            </div>
          ))}
          {project.assets.length === 0 && (
            <div style={{ 
              padding: '20px', 
              textAlign: 'center', 
              color: '#666', 
              fontSize: '12px' 
            }}>
              No assets imported yet.<br />
              Use the Import button to add media files.
            </div>
          )}
        </div>
      </div>
      
      {/* Asset Preview Modal */}
      <AssetPreview
        asset={previewAsset}
        isOpen={showPreview}
        onClose={closePreview}
      />
    </>
  );
};

export default AssetBrowser; 