import React, { useState } from 'react';

interface Scene {
  id: string;
  narration: string;
  imagePrompt: string;
  imageUrl?: string;
  status: 'pending' | 'generating' | 'complete' | 'error';
}

interface StoryboardProps {
  storyPrompt: string;
  scenes: Scene[];
  onRegenerateScene: (index: number) => void;
  onEditScene: (index: number, scene: Scene) => void;
  onSendToEditor: (scenes: Scene[]) => void;
}

const Storyboard: React.FC<StoryboardProps> = ({
  storyPrompt,
  scenes,
  onRegenerateScene,
  onEditScene,
  onSendToEditor
}) => {
  const [selectedScenes, setSelectedScenes] = useState<Set<number>>(new Set());

  const toggleSelection = (index: number, event: React.MouseEvent) => {
    const newSelection = new Set(selectedScenes);
    
    if (event.ctrlKey || event.metaKey) {
      if (newSelection.has(index)) {
        newSelection.delete(index);
      } else {
        newSelection.add(index);
      }
    } else if (event.shiftKey && selectedScenes.size > 0) {
      const lastSelected = Math.max(...selectedScenes);
      const start = Math.min(lastSelected, index);
      const end = Math.max(lastSelected, index);
      for (let i = start; i <= end; i++) {
        newSelection.add(i);
      }
    } else {
      newSelection.clear();
      newSelection.add(index);
    }
    
    setSelectedScenes(newSelection);
  };

  const selectAll = () => {
    setSelectedScenes(new Set(scenes.map((_, i) => i)));
  };

  const clearSelection = () => {
    setSelectedScenes(new Set());
  };

  const handleSendToEditor = () => {
    const selectedSceneData = selectedScenes.size > 0
      ? Array.from(selectedScenes).sort((a, b) => a - b).map(i => scenes[i])
      : scenes;
    onSendToEditor(selectedSceneData);
  };

  if (scenes.length === 0) {
    return (
      <div className="storyboard-empty">
        <div className="empty-state">
          <span className="empty-icon">🎬</span>
          <h3>No Storyboard Yet</h3>
          <p>Go to "Prompting" tab to create your story and generate a storyboard.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="storyboard-container">
      <div className="storyboard-header">
        <div className="storyboard-info">
          <span className="story-preview">{storyPrompt.substring(0, 100)}...</span>
          {selectedScenes.size > 0 && (
            <span className="selection-info">{selectedScenes.size} scene(s) selected</span>
          )}
        </div>
        <div className="storyboard-actions">
          <button onClick={selectAll} className="btn-secondary">☑️ All</button>
          <button onClick={clearSelection} className="btn-secondary">✖️ Clear</button>
          <button onClick={handleSendToEditor} className="btn-primary">
            🎬 Send to Editor
          </button>
        </div>
      </div>

      <div className="storyboard-grid">
        {scenes.map((scene, index) => (
          <div
            key={scene.id}
            className={`storyboard-card ${selectedScenes.has(index) ? 'selected' : ''} ${scene.status}`}
            onClick={(e) => toggleSelection(index, e)}
          >
            <div className="card-header">
              <span className="scene-number">Scene {index + 1}</span>
              <div className="card-actions">
                <button
                  onClick={(e) => { e.stopPropagation(); onRegenerateScene(index); }}
                  title="Regenerate"
                  className="btn-icon"
                >
                  🔄
                </button>
              </div>
            </div>
            <div className="card-image">
              {scene.status === 'generating' ? (
                <div className="scene-loading">
                  <div className="spinner"></div>
                  <span>Generating...</span>
                </div>
              ) : scene.status === 'error' ? (
                <div className="scene-error">
                  <span>⚠️ Failed</span>
                  <button onClick={(e) => { e.stopPropagation(); onRegenerateScene(index); }}>
                    Retry
                  </button>
                </div>
              ) : scene.imageUrl ? (
                <img src={scene.imageUrl} alt={`Scene ${index + 1}`} />
              ) : (
                <div className="scene-placeholder">
                  <span>🖼️</span>
                </div>
              )}
            </div>
            <div className="card-content">
              <p className="scene-narration">{scene.narration}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="timeline-preview">
        <h4>Timeline Preview</h4>
        <div className="timeline-track">
          {scenes.map((scene, index) => (
            <div
              key={scene.id}
              className={`timeline-item ${selectedScenes.has(index) ? 'selected' : ''}`}
              style={{ backgroundImage: scene.imageUrl ? `url('${scene.imageUrl}')` : 'none' }}
              onClick={(e) => toggleSelection(index, e)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Storyboard;
