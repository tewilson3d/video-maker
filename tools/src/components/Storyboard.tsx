import React, { useState } from 'react';
import { StoryboardScene } from '../utils/projectGenerator';

interface StoryboardProps {
  storyPrompt: string;
  scenes: (StoryboardScene & { status?: string })[];
  onRegenerateScene: (index: number) => void;
  onEditScene: (index: number, scene: StoryboardScene) => void;
  onSendToEditor: (scenes: StoryboardScene[]) => void;
}

const Storyboard: React.FC<StoryboardProps> = ({
  storyPrompt,
  scenes,
  onRegenerateScene,
  onEditScene,
  onSendToEditor
}) => {
  const [selectedScenes, setSelectedScenes] = useState<Set<number>>(new Set());
  const [editingScene, setEditingScene] = useState<number | null>(null);

  const toggleSelection = (index: number, event: React.MouseEvent) => {
    event.stopPropagation();
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
      : scenes.filter(s => s.imageUrl); // Only send scenes with images
    
    if (selectedSceneData.length === 0) {
      alert('No scenes with images to send to editor');
      return;
    }
    
    onSendToEditor(selectedSceneData);
  };

  const handleEditNarration = (index: number, narration: string) => {
    const scene = scenes[index];
    onEditScene(index, { ...scene, narration });
  };

  const handleEditDuration = (index: number, duration: number) => {
    const scene = scenes[index];
    onEditScene(index, { ...scene, duration });
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

  const completedCount = scenes.filter(s => s.status === 'complete' || s.imageUrl).length;
  const generatingCount = scenes.filter(s => s.status === 'generating').length;

  return (
    <div className="storyboard-container">
      <div className="storyboard-header">
        <div className="storyboard-info">
          <span className="story-preview">{storyPrompt.substring(0, 100)}...</span>
          <div className="storyboard-stats">
            <span>{completedCount}/{scenes.length} scenes generated</span>
            {generatingCount > 0 && <span className="generating">({generatingCount} generating...)</span>}
            {selectedScenes.size > 0 && (
              <span className="selection-info">{selectedScenes.size} selected</span>
            )}
          </div>
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
            className={`storyboard-card ${selectedScenes.has(index) ? 'selected' : ''} status-${scene.status || 'pending'}`}
            onClick={(e) => toggleSelection(index, e)}
          >
            <div className="card-header">
              <span className="scene-number">Scene {index + 1}</span>
              <div className="card-actions">
                <button
                  onClick={(e) => { e.stopPropagation(); setEditingScene(editingScene === index ? null : index); }}
                  title="Edit"
                  className="btn-icon"
                >
                  ✏️
                </button>
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
                  <span>Pending</span>
                </div>
              )}
            </div>
            <div className="card-content">
              {editingScene === index ? (
                <div className="scene-edit">
                  <textarea
                    value={scene.narration}
                    onChange={(e) => handleEditNarration(index, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    rows={3}
                  />
                  <div className="duration-edit">
                    <label>Duration (frames):</label>
                    <input
                      type="number"
                      value={scene.duration || 120}
                      onChange={(e) => handleEditDuration(index, parseInt(e.target.value) || 120)}
                      onClick={(e) => e.stopPropagation()}
                      min={1}
                    />
                    <span className="duration-hint">
                      ({((scene.duration || 120) / 30).toFixed(1)}s at 30fps)
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <p className="scene-narration">{scene.narration}</p>
                  <span className="scene-duration">
                    {((scene.duration || 120) / 30).toFixed(1)}s
                  </span>
                </>
              )}
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
              className={`timeline-item ${selectedScenes.has(index) ? 'selected' : ''} ${scene.imageUrl ? '' : 'empty'}`}
              style={{ 
                backgroundImage: scene.imageUrl ? `url('${scene.imageUrl}')` : 'none',
                width: `${(scene.duration || 120) / 2}px`
              }}
              onClick={(e) => toggleSelection(index, e)}
              title={`Scene ${index + 1}: ${scene.narration.substring(0, 50)}...`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Storyboard;
