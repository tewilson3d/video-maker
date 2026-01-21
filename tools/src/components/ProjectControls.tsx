import React, { useRef } from 'react';
import { Project } from '../types';
import { StoryboardData } from '../utils/projectGenerator';

interface ProjectControlsProps {
  onLoadProject: (data: { project?: Project; storyboard?: StoryboardData }) => void;
  onSaveProject: () => void;
  projectPath: string;
  setProjectPath: (path: string) => void;
}

const ProjectControls: React.FC<ProjectControlsProps> = ({
  onLoadProject,
  onSaveProject,
  projectPath,
  setProjectPath
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load from server path
  const handleLoadFromServer = async () => {
    const path = prompt('Enter project path to load:', projectPath || '/home/exedev/video-maker/projects/my-project');
    if (!path) return;

    try {
      const response = await fetch(`/api/load-project?path=${encodeURIComponent(path)}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      
      const data = await response.json();
      setProjectPath(path);
      localStorage.setItem('projectPath', path);
      
      // Convert loaded data to our format
      const storyboard: StoryboardData = {
        storyPrompt: data.storyPrompt || '',
        characters: data.characters || [],
        scenes: (data.scenes || []).map((s: any, i: number) => ({
          id: s.id || `scene_${i + 1}`,
          narration: s.narration || '',
          imagePrompt: s.imagePrompt || '',
          imageUrl: s.imageUrl || null,
          duration: s.duration || 120,
          status: s.imageUrl ? 'complete' : 'pending'
        })),
        settings: data.settings || {
          fps: 30,
          canvasWidth: 1920,
          canvasHeight: 1080,
          defaultSceneDuration: 120
        }
      };

      onLoadProject({ storyboard });
      alert(`Project loaded from ${path}`);
    } catch (error) {
      alert(`Failed to load project: ${error}`);
    }
  };

  // Load from JSON file
  const handleLoadFromFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Check if it's a full project or storyboard
      if (data.timeline && data.assets) {
        // It's a full editor project
        onLoadProject({ project: data as Project });
      } else if (data.scenes || data.storyPrompt) {
        // It's a storyboard
        const storyboard: StoryboardData = {
          storyPrompt: data.storyPrompt || '',
          characters: data.characters || [],
          scenes: (data.scenes || []).map((s: any, i: number) => ({
            id: s.id || `scene_${i + 1}`,
            narration: s.narration || '',
            imagePrompt: s.imagePrompt || '',
            imageUrl: s.imageUrl || null,
            duration: s.duration || 120,
            status: s.imageUrl ? 'complete' : 'pending'
          })),
          settings: data.settings
        };
        onLoadProject({ storyboard });
      }

      alert(`Loaded ${file.name}`);
    } catch (error) {
      alert(`Failed to load file: ${error}`);
    }

    // Reset input
    e.target.value = '';
  };

  return (
    <div className="project-controls">
      <button onClick={handleLoadFromServer} className="btn-project" title="Load from server">
        📂 Load
      </button>
      <button onClick={handleLoadFromFile} className="btn-project" title="Load JSON file">
        📄 JSON
      </button>
      <button onClick={onSaveProject} className="btn-project" title="Save project">
        💾 Save
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </div>
  );
};

export default ProjectControls;
