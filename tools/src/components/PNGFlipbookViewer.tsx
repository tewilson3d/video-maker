import React, { useRef, useState } from 'react';
import { useEditorStore } from '../store';

const PNGFlipbookViewer: React.FC = () => {
  const {
    pngFiles,
    flipbookState,
    loadPNGFiles,
    togglePNGSelection,
    selectAllPNGs,
    clearPNGSelection,
    playFlipbook,
    pauseFlipbook,
    stopFlipbook,
    setFlipbookFrame,
    setFlipbookFPS,
    setFlipbookLoop,
    setShowPNGViewer,
  } = useEditorStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [thumbnailSize, setThumbnailSize] = useState(100); // Default 100px for larger window
  const [outputFolder, setOutputFolder] = useState<any>(null); // File System Access API directory handle
  const [outputFolderName, setOutputFolderName] = useState<string>(''); // Display name for selected folder
  const [isCopying, setIsCopying] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: 1600, height: 1000 });
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number }>({ startX: 0, startY: 0, startWidth: 0, startHeight: 0 });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      loadPNGFiles(files);
    }
  };

  const handleChooseFiles = () => {
    fileInputRef.current?.click();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      loadPNGFiles(files);
    }
  };

  const selectedFiles = pngFiles.filter(f => f.selected);
  const currentImage = selectedFiles[flipbookState.currentFrame];

  const handleFrameSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const frame = parseInt(e.target.value);
    setFlipbookFrame(frame);
  };

  const handleSelectOutputFolder = async () => {
    try {
      // Use the modern File System Access API if available
      if ('showDirectoryPicker' in window) {
        const directoryHandle = await (window as any).showDirectoryPicker();
        setOutputFolder(directoryHandle);
        setOutputFolderName(directoryHandle.name);
      } else {
        alert('Folder selection is not supported in this browser. Please use Chrome/Edge 86+ for this feature.');
      }
    } catch (error) {
      console.log('User cancelled folder selection or error occurred:', error);
    }
  };

  const handleCopyImages = async () => {
    if (!outputFolder) {
      alert('Please select an output folder first.');
      return;
    }

    const selectedFiles = pngFiles.filter(f => f.selected);
    if (selectedFiles.length === 0) {
      alert('Please select some PNG files to copy.');
      return;
    }

    setIsCopying(true);

    try {
      let successCount = 0;
      let failCount = 0;

      for (const pngFile of selectedFiles) {
        try {
          // Fetch the file data
          const response = await fetch(pngFile.src);
          const blob = await response.blob();

          // Create a new file in the output folder
          const fileHandle = await outputFolder.getFileHandle(pngFile.name, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();

          successCount++;
        } catch (error) {
          console.error(`Failed to copy ${pngFile.name}:`, error);
          failCount++;
        }
      }

      // Show result message
      if (failCount === 0) {
        alert(`✅ Successfully copied ${successCount} files to "${outputFolderName}"`);
      } else {
        alert(`⚠️ Copied ${successCount} files successfully, ${failCount} files failed to copy.`);
      }

    } catch (error) {
      console.error('Copy operation failed:', error);
      alert('❌ Failed to copy files. Please try again.');
    } finally {
      setIsCopying(false);
    }
  };

  const handleResizeStart = (e: React.MouseEvent, direction: string) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: windowSize.width,
      startHeight: windowSize.height
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      const deltaX = e.clientX - resizeRef.current.startX;
      const deltaY = e.clientY - resizeRef.current.startY;
      
      let newWidth = resizeRef.current.startWidth;
      let newHeight = resizeRef.current.startHeight;
      
      if (direction.includes('right')) newWidth += deltaX;
      if (direction.includes('left')) newWidth -= deltaX;
      if (direction.includes('bottom')) newHeight += deltaY;
      if (direction.includes('top')) newHeight -= deltaY;
      
      // Constrain minimum and maximum size
      newWidth = Math.max(1000, Math.min(newWidth, window.innerWidth - 20));
      newHeight = Math.max(800, Math.min(newHeight, window.innerHeight - 20));
      
      setWindowSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleClose = () => {
    // Stop playback and close viewer
    if (flipbookState.isPlaying) {
      pauseFlipbook();
    }
    setShowPNGViewer(false);
  };

  return (
    <div 
      className="png-flipbook-viewer"
      style={{ 
        width: `${windowSize.width}px`, 
        height: `${windowSize.height}px`,
        maxWidth: '95vw',
        maxHeight: '95vh'
      }}
    >
      {/* Resize Handles */}
      <div className="resize-handle resize-handle-top" onMouseDown={(e) => handleResizeStart(e, 'top')} />
      <div className="resize-handle resize-handle-right" onMouseDown={(e) => handleResizeStart(e, 'right')} />
      <div className="resize-handle resize-handle-bottom" onMouseDown={(e) => handleResizeStart(e, 'bottom')} />
      <div className="resize-handle resize-handle-left" onMouseDown={(e) => handleResizeStart(e, 'left')} />
      <div className="resize-handle resize-handle-corner-tl" onMouseDown={(e) => handleResizeStart(e, 'top-left')} />
      <div className="resize-handle resize-handle-corner-tr" onMouseDown={(e) => handleResizeStart(e, 'top-right')} />
      <div className="resize-handle resize-handle-corner-bl" onMouseDown={(e) => handleResizeStart(e, 'bottom-left')} />
      <div className="resize-handle resize-handle-corner-br" onMouseDown={(e) => handleResizeStart(e, 'bottom-right')} />
      
      <div className="png-viewer-header">
        <h2>🎞️ PNG Flipbook Viewer</h2>
        <button onClick={handleClose} className="close-button">×</button>
      </div>

      {pngFiles.length === 0 ? (
        <div 
          className={`file-drop-zone ${dragOver ? 'drag-over' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="drop-zone-content">
            <div className="drop-zone-icon">📁</div>
            <h3>Load PNG Files</h3>
            <p>Drag and drop PNG files here or click to browse</p>
            <button onClick={handleChooseFiles} className="choose-files-btn">
              Choose Files
            </button>
            <p className="help-text">
              Select multiple PNG files from your output folder to create a flipbook animation
            </p>
          </div>
        </div>
      ) : (
        <div className="png-viewer-main">
          {/* Controls Bar */}
          <div className="controls-bar">
            <div className="controls-section">
              <h3>PNG Files ({pngFiles.length})</h3>
              <div className="file-controls">
                <button onClick={selectAllPNGs} className="select-btn">Select All</button>
                <button onClick={clearPNGSelection} className="select-btn">Clear</button>
                <button onClick={handleChooseFiles} className="load-more-btn">Load More</button>
              </div>
            </div>
            
            <div className="controls-section">
              <div className="thumbnail-size-control">
                <label>Size:</label>
                <input
                  type="range"
                  min="50"
                  max="200"
                  value={thumbnailSize}
                  onChange={(e) => setThumbnailSize(parseInt(e.target.value))}
                  className="size-slider"
                />
                <span className="size-value">{thumbnailSize}px</span>
              </div>
            </div>

            <div className="controls-section">
              <div className="output-folder-control-horizontal">
                <button 
                  onClick={handleSelectOutputFolder} 
                  className="folder-select-btn"
                  title="Select destination folder for copying images"
                >
                  📁 {outputFolderName ? `${outputFolderName}` : 'Select Output Folder'}
                </button>
                
                <button 
                  onClick={handleCopyImages}
                  disabled={!outputFolder || pngFiles.filter(f => f.selected).length === 0 || isCopying}
                  className="copy-btn"
                  title="Copy selected images to output folder"
                >
                  {isCopying ? '📋 Copying...' : `📋 Copy (${pngFiles.filter(f => f.selected).length})`}
                </button>
              </div>
            </div>
          </div>

          {/* File Grid Area */}
          <div className="file-grid-area">
            <div className="file-grid">
              {pngFiles.map((file, index) => (
                <div 
                  key={file.id}
                  className={`file-grid-item ${file.selected ? 'selected' : ''}`}
                  onClick={() => togglePNGSelection(file.id)}
                >
                  <img 
                    src={file.src} 
                    alt={file.name} 
                    className="file-grid-thumbnail"
                    style={{ 
                      width: `${thumbnailSize}px`, 
                      height: `${thumbnailSize}px` 
                    }}
                  />
                  <div className="file-grid-info">
                    <div className="file-grid-name" title={file.name}>
                      {file.name}
                    </div>
                    <div className="file-grid-index">#{index + 1}</div>
                  </div>
                  {file.selected && <div className="selection-indicator">✓</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Playback Footer */}
          <div className="playback-footer">
            {selectedFiles.length === 0 ? (
              <div className="no-selection-footer">
                <span>🖼️ Select PNG files to start viewing the flipbook</span>
              </div>
            ) : (
              <div className="playback-controls-footer">
                <div className="current-image-display">
                  {currentImage ? (
                    <img 
                      src={currentImage.src} 
                      alt={currentImage.name}
                      className="footer-preview-image"
                    />
                  ) : (
                    <div className="footer-no-image">No frame</div>
                  )}
                </div>

                <div className="playback-controls-main">
                  <div className="control-row">
                    <button 
                      onClick={flipbookState.isPlaying ? pauseFlipbook : playFlipbook}
                      className="play-pause-btn"
                    >
                      {flipbookState.isPlaying ? '⏸️' : '▶️'}
                    </button>
                    <button onClick={stopFlipbook} className="stop-btn">⏹️</button>
                    
                    <div className="fps-control">
                      <label>FPS:</label>
                      <input
                        type="number"
                        min="1"
                        max="60"
                        value={flipbookState.fps}
                        onChange={(e) => setFlipbookFPS(parseInt(e.target.value))}
                        className="fps-input"
                      />
                    </div>
                    
                    <div className="loop-control">
                      <label>
                        <input
                          type="checkbox"
                          checked={flipbookState.loop}
                          onChange={(e) => setFlipbookLoop(e.target.checked)}
                        />
                        Loop
                      </label>
                    </div>
                  </div>
                  
                  <div className="frame-control">
                    <label>Frame: {flipbookState.currentFrame + 1} / {selectedFiles.length}</label>
                    <input
                      type="range"
                      min="0"
                      max={Math.max(0, selectedFiles.length - 1)}
                      value={flipbookState.currentFrame}
                      onChange={handleFrameSliderChange}
                      className="frame-slider"
                    />
                  </div>
                </div>

                <div className="frame-info-footer">
                  {currentImage && (
                    <div className="current-file-info">
                      <div className="current-file-name">{currentImage.name}</div>
                      <div className="current-file-index">
                        {flipbookState.currentFrame + 1} of {selectedFiles.length} selected
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png"
        multiple
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />
    </div>
  );
};

export default PNGFlipbookViewer;
