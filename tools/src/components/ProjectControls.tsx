import React, { useRef, useState } from 'react';
import { Project } from '../types';
import { StoryboardData } from '../utils/projectGenerator';

// Extend window for File System Access API
declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }
}

interface ProjectControlsProps {
  onLoadProject: (data: { project?: Project; storyboard?: StoryboardData; localFolderHandle?: FileSystemDirectoryHandle }) => void;
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
  const [isLoading, setIsLoading] = useState(false);

  // Load from LOCAL folder using File System Access API
  const handleLoadLocalFolder = async () => {
    if (!window.showDirectoryPicker) {
      alert('Your browser does not support the File System Access API. Please use Chrome or Edge.');
      return;
    }

    try {
      setIsLoading(true);
      
      // Let user pick their local project folder
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
      const folderName = dirHandle.name;
      
      // Try to read project.json from the folder
      let projectData: any = null;
      try {
        const projectFile = await dirHandle.getFileHandle('project.json');
        const file = await projectFile.getFile();
        const text = await file.text();
        projectData = JSON.parse(text);
      } catch (e) {
        alert('Could not find project.json in the selected folder');
        setIsLoading(false);
        return;
      }

      // Try to get videos and images directories
      let videosDir: FileSystemDirectoryHandle | null = null;
      let imagesDir: FileSystemDirectoryHandle | null = null;
      let keyframesDir: FileSystemDirectoryHandle | null = null;
      
      try {
        videosDir = await dirHandle.getDirectoryHandle('videos');
      } catch (e) { /* videos folder may not exist */ }
      
      try {
        imagesDir = await dirHandle.getDirectoryHandle('images');
      } catch (e) { /* images folder may not exist */ }
      
      try {
        keyframesDir = await dirHandle.getDirectoryHandle('keyframes');
      } catch (e) { /* keyframes folder may not exist */ }

      // Process scenes - load images and videos as blob URLs
      const scenes = await Promise.all(
        (projectData.scenes || []).map(async (s: any, i: number) => {
          let imageUrl: string | null = null;
          let videoUrl: string | null = null;

          // Try to load image
          const imageFilename = s.imageFile || `scene_${i + 1}.png`;
          try {
            // Try keyframes folder first, then images
            let imgFile: File | null = null;
            if (keyframesDir) {
              try {
                const handle = await keyframesDir.getFileHandle(imageFilename);
                imgFile = await handle.getFile();
              } catch (e) { /* not in keyframes */ }
            }
            if (!imgFile && imagesDir) {
              try {
                const handle = await imagesDir.getFileHandle(imageFilename);
                imgFile = await handle.getFile();
              } catch (e) { /* not in images */ }
            }
            if (imgFile) {
              imageUrl = URL.createObjectURL(imgFile);
            }
          } catch (e) { /* image not found */ }

          // Try to load video
          const videoFilename = s.videoFile || `scene_${i + 1}.mp4`;
          if (videosDir) {
            try {
              const handle = await videosDir.getFileHandle(videoFilename);
              const vidFile = await handle.getFile();
              videoUrl = URL.createObjectURL(vidFile);
            } catch (e) { /* video not found */ }
          }

          return {
            id: s.id || `scene_${i + 1}`,
            narration: s.narration || '',
            imagePrompt: s.imagePrompt || '',
            imageUrl,
            videoUrl,
            imageFile: s.imageFile || null,  // Preserve original filename
            videoFile: s.videoFile || null,  // Preserve original filename
            duration: s.duration || 120,
            status: imageUrl ? 'complete' : 'pending'
          };
        })
      );

      // Create storyboard data
      const storyboard: StoryboardData = {
        storyPrompt: projectData.storyPrompt || '',
        characters: projectData.characters || [],
        scenes,
        settings: projectData.settings || {
          fps: 30,
          canvasWidth: 1920,
          canvasHeight: 1080,
          defaultSceneDuration: 120
        }
      };

      // Update project path to show it's local
      const localPath = `[LOCAL] ${folderName}`;
      setProjectPath(localPath);
      localStorage.setItem('projectPath', localPath);
      localStorage.setItem('isLocalProject', 'true');

      // Debug: log what we loaded
      console.log('=== LOCAL PROJECT LOAD ===' );
      console.log('Folder:', folderName);
      console.log('videosDir found:', !!videosDir);
      console.log('Scenes loaded:', scenes.length);
      scenes.forEach((s, i) => {
        console.log(`Scene ${i+1}: imageUrl=${s.imageUrl ? 'YES' : 'NO'}, videoUrl=${s.videoUrl ? 'YES' : 'NO'}`);
        if (s.videoUrl) console.log(`  videoUrl: ${s.videoUrl.substring(0, 50)}...`);
      });
      console.log('Full storyboard:', storyboard);
      console.log('=========================');

      // Pass the folder handle so we can save back to it later
      onLoadProject({ storyboard, localFolderHandle: dirHandle });
      
      const videoCount = scenes.filter(s => s.videoUrl).length;
      const imageCount = scenes.filter(s => s.imageUrl).length;
      alert(`Loaded local project: ${folderName}\n${scenes.length} scenes (${imageCount} images, ${videoCount} videos)`);
      
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        alert(`Failed to load local project: ${error.message}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Load from server path
  const handleLoadFromServer = async () => {
    const path = prompt('Enter project path to load:', projectPath || '/home/exedev/video-maker/projects/my-project');
    if (!path) return;

    try {
      setIsLoading(true);
      const response = await fetch(`/api/load-project?path=${encodeURIComponent(path)}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      
      const data = await response.json();
      setProjectPath(path);
      localStorage.setItem('projectPath', path);
      localStorage.setItem('isLocalProject', 'false');
      
      // Convert loaded data to our format
      const storyboard: StoryboardData = {
        storyPrompt: data.storyPrompt || '',
        characters: data.characters || [],
        scenes: (data.scenes || []).map((s: any, i: number) => ({
          id: s.id || `scene_${i + 1}`,
          narration: s.narration || '',
          imagePrompt: s.imagePrompt || '',
          imageUrl: s.imageUrl || null,
          videoUrl: s.videoUrl || null,
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
      alert(`Project loaded from server: ${path}`);
    } catch (error) {
      alert(`Failed to load project: ${error}`);
    } finally {
      setIsLoading(false);
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
            videoUrl: s.videoUrl || null,
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
      <button 
        onClick={handleLoadLocalFolder} 
        className="btn-project btn-local" 
        title="Load project from local folder"
        disabled={isLoading}
      >
        💻 Local
      </button>
      <button 
        onClick={handleLoadFromServer} 
        className="btn-project" 
        title="Load from server"
        disabled={isLoading}
      >
        📂 Server
      </button>
      <button 
        onClick={handleLoadFromFile} 
        className="btn-project" 
        title="Load JSON file"
        disabled={isLoading}
      >
        📄 JSON
      </button>
      <button 
        onClick={onSaveProject} 
        className="btn-project" 
        title="Save project"
        disabled={isLoading}
      >
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
