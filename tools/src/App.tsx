import React, { useEffect, useState } from 'react';
import Toolbar from './components/Toolbar';
import AssetBrowser from './components/AssetBrowser';
import Canvas from './components/Canvas';
import Timeline from './components/Timeline';
import Prompting from './components/Prompting';
import Storyboard from './components/Storyboard';
import ProjectControls from './components/ProjectControls';
import { useEditorStore } from './store';
import { Project, Asset, Clip } from './types';
import { 
  generateProjectFromStoryboard, 
  exportStoryboardJSON, 
  downloadJSON,
  StoryboardData,
  StoryboardScene 
} from './utils/projectGenerator';

// Main tabs for the unified app
type MainTab = 'prompting' | 'storyboard' | 'editing';

// Check if we're embedded in an iframe
const isEmbedded = window.self !== window.top;

function App() {
  // When embedded, always show editing tab
  const [activeTab, setActiveTab] = useState<MainTab>(isEmbedded ? 'editing' : 'prompting');
  const [storyboardData, setStoryboardData] = useState<StoryboardData>({
    storyPrompt: '',
    characters: [],
    scenes: [],
    settings: {
      fps: 30,
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultSceneDuration: 120
    }
  });
  
  const { 
    project, 
    selectedTool,
    setSelectedTool,
    currentTime,
    setCurrentTime,
    isPlaying,
    setIsPlaying,
    playbackSpeed,
    setPlaybackSpeed,
    showOnionSkin,
    setShowOnionSkin,
    onionSkinFrames,
    setOnionSkinFrames,
    brushSettings,
    setBrushSettings,
    setProject,
    undo,
    redo,
    canUndo,
    canRedo
  } = useEditorStore();

  const [showAssetPreview, setShowAssetPreview] = useState<{
    show: boolean;
    assetType: string;
    assetData: any;
    position: { x: number; y: number };
  }>({ show: false, assetType: '', assetData: null, position: { x: 0, y: 0 } });

  // Gemini API Key (stored in localStorage)
  const [geminiApiKey, setGeminiApiKey] = useState(() => {
    return localStorage.getItem('geminiApiKey') || '';
  });

  // Project path for saving
  const [projectPath, setProjectPath] = useState(() => {
    return localStorage.getItem('projectPath') || '';
  });

  // Generate storyboard from prompts
  const handleGenerateStoryboard = async (data: {
    storyPrompt: string;
    characters: { index: number; description: string }[];
    keyframes: { index: number; description: string }[];
  }) => {
    // Create initial scenes with pending status
    const scenes: StoryboardScene[] = data.keyframes.map((kf, i) => ({
      id: `scene_${i + 1}`,
      narration: kf.description,
      imagePrompt: kf.description,
      imageUrl: undefined,
      status: 'pending' as const,
      duration: 120 // 4 seconds at 30fps
    }));

    const newStoryboardData: StoryboardData = {
      storyPrompt: data.storyPrompt,
      characters: data.characters.map(c => ({ ...c, imageUrl: undefined })),
      scenes,
      settings: storyboardData.settings
    };

    setStoryboardData(newStoryboardData);

    // Switch to storyboard tab
    setActiveTab('storyboard');

    // Auto-generate project path if not set
    if (!projectPath) {
      const newPath = `/home/exedev/video-maker/projects/project-${Date.now()}`;
      setProjectPath(newPath);
      localStorage.setItem('projectPath', newPath);
    }

    // Generate images for each scene
    for (let i = 0; i < scenes.length; i++) {
      // Update status to generating
      setStoryboardData(prev => ({
        ...prev,
        scenes: prev.scenes.map((s, idx) => 
          idx === i ? { ...s, status: 'generating' as const } : s
        )
      }));

      try {
        const imageUrl = await generateSceneImage(
          scenes[i].narration,
          data.storyPrompt,
          data.characters.map(c => c.description)
        );

        // Update with generated image
        setStoryboardData(prev => {
          const updated = {
            ...prev,
            scenes: prev.scenes.map((s, idx) => 
              idx === i ? { ...s, imageUrl, status: 'complete' as const } : s
            )
          };
          
          // Auto-save storyboard JSON after each scene
          saveStoryboardToServer(updated);
          
          return updated;
        });

        // Auto-save keyframe image to server
        await saveKeyframeToServer(i + 1, imageUrl);

      } catch (error) {
        console.error(`Failed to generate scene ${i + 1}:`, error);
        setStoryboardData(prev => ({
          ...prev,
          scenes: prev.scenes.map((s, idx) => 
            idx === i ? { ...s, status: 'error' as const } : s
          )
        }));
      }
    }
  };

  // Save storyboard JSON to server
  const saveStoryboardToServer = async (data: StoryboardData) => {
    if (!projectPath) return;
    
    try {
      await fetch('/api/save-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          storyPrompt: data.storyPrompt,
          characters: data.characters,
          scenes: data.scenes.map(s => ({
            id: s.id,
            narration: s.narration,
            imagePrompt: s.imagePrompt,
            imageUrl: s.imageUrl,
            duration: s.duration
          })),
          settings: data.settings
        })
      });
      console.log('Storyboard saved to:', projectPath);
    } catch (error) {
      console.error('Failed to save storyboard:', error);
    }
  };

  // Generate scene image using Gemini API
  const generateSceneImage = async (
    sceneDescription: string,
    storyContext: string,
    characterDescriptions: string[]
  ): Promise<string> => {
    if (!geminiApiKey) {
      throw new Error('Gemini API key not configured. Click ⚙️ to set it.');
    }

    const prompt = `Generate a cinematic storyboard frame image for a video scene.

Scene description: ${sceneDescription}

Story context: ${storyContext}

${characterDescriptions.length > 0 ? `Characters:\n${characterDescriptions.map((c, i) => `- Character ${i+1}: ${c}`).join('\n')}` : ''}

Style: Cinematic, high-quality, suitable for video/animation storyboard. Aspect ratio 16:9, dramatic lighting, professional composition.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["image", "text"] }
        })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to generate image');
    }

    const data = await response.json();
    
    if (data.candidates?.[0]?.content?.parts) {
      for (const part of data.candidates[0].content.parts) {
        if (part.inlineData?.mimeType?.startsWith('image/')) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
    }
    
    throw new Error('No image in response');
  };

  // Save keyframe to server
  const saveKeyframeToServer = async (sceneIndex: number, imageData: string) => {
    if (!projectPath) return;
    
    try {
      await fetch('/api/save-keyframe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, sceneIndex, imageData })
      });
    } catch (error) {
      console.error('Failed to save keyframe:', error);
    }
  };

  // Regenerate a single scene
  const handleRegenerateScene = async (index: number) => {
    const scene = storyboardData.scenes[index];
    
    setStoryboardData(prev => ({
      ...prev,
      scenes: prev.scenes.map((s, idx) => 
        idx === index ? { ...s, status: 'generating' as const } : s
      )
    }));

    try {
      const imageUrl = await generateSceneImage(
        scene.narration,
        storyboardData.storyPrompt,
        storyboardData.characters.map(c => c.description)
      );

      setStoryboardData(prev => {
        const updated = {
          ...prev,
          scenes: prev.scenes.map((s, idx) => 
            idx === index ? { ...s, imageUrl, status: 'complete' as const } : s
          )
        };
        saveStoryboardToServer(updated);
        return updated;
      });

      await saveKeyframeToServer(index + 1, imageUrl);

    } catch (error) {
      console.error(`Failed to regenerate scene ${index + 1}:`, error);
      setStoryboardData(prev => ({
        ...prev,
        scenes: prev.scenes.map((s, idx) => 
          idx === index ? { ...s, status: 'error' as const } : s
        )
      }));
    }
  };

  // Edit scene
  const handleEditScene = (index: number, scene: StoryboardScene) => {
    setStoryboardData(prev => {
      const updated = {
        ...prev,
        scenes: prev.scenes.map((s, idx) => idx === index ? scene : s)
      };
      saveStoryboardToServer(updated);
      return updated;
    });
  };

  // Send scenes to editor - generates proper Project JSON
  const handleSendToEditor = async (scenes: StoryboardScene[]) => {
    console.log('=== SEND TO EDITOR ===');
    console.log('Scenes received:', scenes.length);
    scenes.forEach((s, i) => {
      console.log(`Scene ${i+1}: videoUrl=${s.videoUrl ? 'YES' : 'NO'}, imageUrl=${s.imageUrl ? 'YES' : 'NO'}`);
    });

    // Create a storyboard with only selected scenes
    const selectedStoryboard: StoryboardData = {
      ...storyboardData,
      scenes: scenes
    };

    // Generate the project from storyboard
    const generatedProject = generateProjectFromStoryboard(selectedStoryboard);
    
    console.log('Generated project assets:', generatedProject.assets.length);
    
    // Load video/image elements for each asset
    const assetsWithElements = await Promise.all(
      generatedProject.assets.map(async (asset) => {
        if (!asset.src) {
          console.warn(`Asset ${asset.name} has no src`);
          return asset;
        }
        
        if (asset.type === 'video') {
          return new Promise<typeof asset>((resolve) => {
            const video = document.createElement('video');
            video.crossOrigin = 'anonymous';
            video.preload = 'auto';
            video.muted = true;
            
            video.onloadedmetadata = () => {
              console.log(`Video loaded: ${asset.name}, ${video.duration}s, ${video.videoWidth}x${video.videoHeight}`);
              resolve({
                ...asset,
                element: video,
                duration: video.duration * 30, // Convert to frames at 30fps
                width: video.videoWidth,
                height: video.videoHeight,
              });
            };
            
            video.onerror = (e) => {
              console.error(`Failed to load video ${asset.name}:`, e);
              resolve(asset); // Return asset without element
            };
            
            video.src = asset.src;
          });
        } else if (asset.type === 'image') {
          return new Promise<typeof asset>((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            img.onload = () => {
              console.log(`Image loaded: ${asset.name}, ${img.naturalWidth}x${img.naturalHeight}`);
              resolve({
                ...asset,
                element: img,
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
            };
            
            img.onerror = (e) => {
              console.error(`Failed to load image ${asset.name}:`, e);
              resolve(asset);
            };
            
            img.src = asset.src;
          });
        }
        
        return asset;
      })
    );
    
    generatedProject.assets = assetsWithElements;
    
    console.log('Assets with elements loaded:', assetsWithElements.length);
    assetsWithElements.forEach((a, i) => {
      console.log(`Asset ${i+1}: type=${a.type}, hasElement=${!!a.element}, src=${a.src?.substring(0, 50)}...`);
    });
    console.log('======================');
    
    // Load into editor
    setProject(generatedProject);
    
    // Save project JSON - skip for local projects
    if (projectPath && !projectPath.startsWith('[LOCAL]')) {
      saveProjectToServer(generatedProject);
    }

    // Switch to editing tab
    setActiveTab('editing');
  };

  // Save full project to server
  const saveProjectToServer = async (proj: typeof project) => {
    if (!projectPath) return;
    
    try {
      await fetch('/api/save-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          project: proj,
          storyPrompt: storyboardData.storyPrompt,
          characters: storyboardData.characters,
          scenes: storyboardData.scenes,
          settings: storyboardData.settings
        })
      });
      console.log('Project saved to:', projectPath);
    } catch (error) {
      console.error('Failed to save project:', error);
    }
  };

  // Download storyboard as JSON
  const handleDownloadStoryboard = () => {
    const json = exportStoryboardJSON(storyboardData);
    downloadJSON(json, 'storyboard.json');
  };

  // Load project handler
  const handleLoadProject = (data: { project?: Project; storyboard?: StoryboardData; localFolderHandle?: FileSystemDirectoryHandle }) => {
    if (data.storyboard) {
      setStoryboardData(data.storyboard);
      // If storyboard has scenes with images or videos, go to storyboard tab
      if (data.storyboard.scenes.some(s => s.imageUrl || s.videoUrl)) {
        setActiveTab('storyboard');
      }
    }
    if (data.project) {
      setProject(data.project);
      setActiveTab('editing');
    }
    // Store localFolderHandle for later use (saving back to local folder)
    if (data.localFolderHandle) {
      (window as any).__localFolderHandle = data.localFolderHandle;
    }
  };

  // Save project handler
  const handleSaveProject = async () => {
    const isLocal = projectPath?.startsWith('[LOCAL]');
    const localFolderHandle = (window as any).__localFolderHandle as FileSystemDirectoryHandle | undefined;

    // If it's a local project, save to local filesystem
    if (isLocal && localFolderHandle) {
      try {
        // Prepare the project data - strip blob URLs since they won't persist
        const saveData = {
          storyPrompt: storyboardData.storyPrompt,
          characters: storyboardData.characters.map(c => ({
            index: c.index,
            description: c.description,
            // Don't save blob imageUrl
          })),
          scenes: storyboardData.scenes.map(s => ({
            id: s.id,
            narration: s.narration,
            imagePrompt: s.imagePrompt,
            // Preserve original filenames from the loaded project
            imageFile: s.imageFile || undefined,
            videoFile: s.videoFile || undefined,
            duration: s.duration,
            status: s.status,
          })),
          settings: storyboardData.settings,
          projectPath: localFolderHandle.name,
          savedAt: new Date().toISOString(),
        };

        // Request write permission if needed
        const permission = await (localFolderHandle as any).requestPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
          alert('Write permission denied. Cannot save to local folder.');
          return;
        }

        // Write project.json
        const fileHandle = await localFolderHandle.getFileHandle('project.json', { create: true });
        const writable = await (fileHandle as any).createWritable();
        await writable.write(JSON.stringify(saveData, null, 2));
        await writable.close();

        alert(`Project saved locally to ${localFolderHandle.name}/project.json`);
        console.log('Saved local project:', saveData);
      } catch (error: any) {
        console.error('Failed to save local project:', error);
        alert(`Failed to save locally: ${error.message}`);
      }
      return;
    }

    // Otherwise save to server
    let path = projectPath;
    if (!path) {
      path = prompt('Enter project path:', '/home/exedev/video-maker/projects/my-project') || '';
      if (!path) return;
      setProjectPath(path);
      localStorage.setItem('projectPath', path);
    }

    try {
      // Save storyboard data
      await fetch('/api/save-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: path,
          storyPrompt: storyboardData.storyPrompt,
          characters: storyboardData.characters,
          scenes: storyboardData.scenes,
          settings: storyboardData.settings,
          project: project
        })
      });
      alert(`Project saved to ${path}`);
    } catch (error) {
      alert(`Failed to save: ${error}`);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // Listen for messages from parent window (when embedded in iframe)
  useEffect(() => {
    if (!isEmbedded) return;

    const handleMessage = (event: MessageEvent) => {
      console.log('Editor received message:', event.data?.type);
      
      if (event.data?.type === 'loadProject' && event.data?.project) {
        console.log('Loading project from parent:', event.data.project);
        setProject(event.data.project);
      } else if (event.data?.type === 'loadStoryboard' && event.data?.storyboard) {
        console.log('Loading storyboard from parent:', event.data.storyboard);
        const storyboard = event.data.storyboard;
        
        // Import videos like the Import button does - with true duration and audio extraction
        (async () => {
          const { addAsset, addTrack, addClipToTrack, setProject } = useEditorStore.getState();
          const { generateWaveform } = await import('./utils/waveform');
          const { generateThumbnail } = await import('./utils/thumbnails');
          
          // Get scenes with video URLs
          const scenesWithVideo = storyboard.scenes.filter((s: any) => s.videoUrl);
          
          if (scenesWithVideo.length === 0) {
            console.warn('No video clips to import');
            return;
          }
          
          // Create a fresh project
          const fps = storyboard.settings?.fps || 30;
          const newProject: Project = {
            id: crypto.randomUUID(),
            name: storyboard.storyPrompt?.substring(0, 50) || 'Imported Project',
            assets: [],
            timeline: {
              tracks: [
                { id: 'track_video_1', type: 'video', name: 'Video 1', clips: [], visible: true, locked: false },
                { id: 'track_audio_1', type: 'audio', name: 'Audio 1', clips: [], visible: true, locked: false }
              ],
              currentTime: 0,
              duration: 30, // Will be updated
              fps: fps,
              zoom: 1
            },
            canvasWidth: storyboard.settings?.canvasWidth || 1920,
            canvasHeight: storyboard.settings?.canvasHeight || 1080,
            backgroundColor: '#000000'
          };
          
          let currentTime = 0; // Track position in seconds
          
          for (let i = 0; i < scenesWithVideo.length; i++) {
            const scene = scenesWithVideo[i];
            const videoUrl = scene.videoUrl;
            
            console.log(`Importing video ${i + 1}: ${videoUrl}`);
            
            // Load video and get metadata
            const videoData = await new Promise<{video: HTMLVideoElement, duration: number, width: number, height: number}>((resolve, reject) => {
              const video = document.createElement('video');
              video.crossOrigin = 'anonymous';
              video.preload = 'auto';
              video.muted = true;
              
              video.onloadedmetadata = () => {
                resolve({
                  video,
                  duration: video.duration,
                  width: video.videoWidth,
                  height: video.videoHeight
                });
              };
              
              video.onerror = () => reject(new Error(`Failed to load video ${i + 1}`));
              video.src = videoUrl;
            });
            
            console.log(`Video ${i + 1} loaded: ${videoData.duration}s, ${videoData.width}x${videoData.height}`);
            
            // Create video asset
            const videoAssetId = crypto.randomUUID();
            const videoAsset: Asset = {
              id: videoAssetId,
              type: 'video',
              src: videoUrl,
              name: `Scene ${i + 1}`,
              duration: videoData.duration,
              width: videoData.width,
              height: videoData.height,
              element: videoData.video
            };
            
            // Generate thumbnail
            try {
              videoAsset.thumbnail = await generateThumbnail(videoData.video, 'video');
            } catch (e) {
              console.warn('Failed to generate thumbnail:', e);
            }
            
            newProject.assets.push(videoAsset);
            
            // Create video clip with true duration
            // Note: start and duration are in SECONDS for timeline positioning
            const videoClip: Clip = {
              id: crypto.randomUUID(),
              assetId: videoAssetId,
              start: currentTime, // In seconds
              duration: videoData.duration, // True duration in seconds
              inPoint: 0,
              outPoint: videoData.duration, // True duration in seconds
              keyframes: {
                position: [{ time: 0, value: { x: 0, y: 0 }, easing: 'linear' as const }],
                scale: [{ time: 0, value: { x: 1, y: 1 }, easing: 'linear' as const }],
                rotation: [{ time: 0, value: 0, easing: 'linear' as const }],
                opacity: [{ time: 0, value: 1, easing: 'linear' as const }]
              }
            };
            
            newProject.timeline.tracks[0].clips.push(videoClip);
            
            // Try to extract audio
            try {
              const waveform = await generateWaveform(videoUrl);
              if (waveform && waveform.length > 0) {
                const audioAssetId = crypto.randomUUID();
                const audio = document.createElement('audio');
                audio.src = videoUrl;
                audio.preload = 'metadata';
                
                const audioAsset: Asset = {
                  id: audioAssetId,
                  type: 'audio',
                  src: videoUrl,
                  name: `Scene ${i + 1} (Audio)`,
                  duration: videoData.duration,
                  width: 0,
                  height: 0,
                  element: audio,
                  waveform: waveform
                };
                
                newProject.assets.push(audioAsset);
                
                // Create audio clip
                // Note: start and duration are in SECONDS
                const audioClip: Clip = {
                  id: crypto.randomUUID(),
                  assetId: audioAssetId,
                  start: currentTime,
                  duration: videoData.duration,
                  inPoint: 0,
                  outPoint: videoData.duration
                };
                
                newProject.timeline.tracks[1].clips.push(audioClip);
                console.log(`Audio extracted for Scene ${i + 1}`);
              }
            } catch (e) {
              console.warn(`No audio or failed to extract for Scene ${i + 1}:`, e);
            }
            
            currentTime += videoData.duration;
          }
          
          // Update timeline duration (in seconds)
          newProject.timeline.duration = currentTime;
          
          // Set canvas size from first video
          if (newProject.assets.length > 0) {
            const firstVideo = newProject.assets.find(a => a.type === 'video');
            if (firstVideo && firstVideo.width && firstVideo.height) {
              newProject.canvasWidth = firstVideo.width;
              newProject.canvasHeight = firstVideo.height;
            }
          }
          
          console.log('Imported project:', newProject);
          console.log(`Total duration: ${currentTime}s, ${newProject.assets.length} assets`);
          
          setProject(newProject);
        })();
      } else if (event.data?.type === 'getEditorState') {
        // Parent is requesting editor state for saving
        console.log('Parent requested editor state for saving');
        const { project } = useEditorStore.getState();
        
        // Create a saveable version without HTML elements
        const saveableProject = {
          ...project,
          assets: project.assets.map(asset => ({
            id: asset.id,
            type: asset.type,
            src: asset.src,
            name: asset.name,
            duration: asset.duration,
            width: asset.width,
            height: asset.height,
            thumbnail: asset.thumbnail,
            waveform: asset.waveform,
            // Don't save element - it's a DOM object
          })),
          savedAt: new Date().toISOString()
        };
        
        // Send back to parent
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'editorState',
            project: saveableProject
          }, '*');
          console.log('Sent editor state to parent:', saveableProject);
        }
      } else if (event.data?.type === 'loadEditorProject' && event.data?.project) {
        // Load a saved editor project (from videoedit.vproj)
        console.log('Loading editor project from parent:', event.data.project);
        const editorProject = event.data.project;
        
        // Recreate video/audio elements for each asset
        (async () => {
          const { generateWaveform } = await import('./utils/waveform');
          const { generateThumbnail } = await import('./utils/thumbnails');
          
          const assetsWithElements = await Promise.all(
            editorProject.assets.map(async (asset: Asset) => {
              if (!asset.src) {
                console.warn(`Asset ${asset.name} has no src`);
                return asset;
              }
              
              if (asset.type === 'video') {
                return new Promise<Asset>((resolve) => {
                  const video = document.createElement('video');
                  video.crossOrigin = 'anonymous';
                  video.preload = 'auto';
                  video.muted = true;
                  
                  video.onloadedmetadata = async () => {
                    console.log(`Video loaded: ${asset.name}, ${video.duration}s`);
                    const loadedAsset: Asset = {
                      ...asset,
                      element: video,
                      duration: asset.duration || video.duration,
                      width: asset.width || video.videoWidth,
                      height: asset.height || video.videoHeight,
                    };
                    
                    // Generate thumbnail if missing
                    if (!loadedAsset.thumbnail) {
                      try {
                        loadedAsset.thumbnail = await generateThumbnail(video, 'video');
                      } catch (e) {
                        console.warn('Failed to generate thumbnail');
                      }
                    }
                    
                    resolve(loadedAsset);
                  };
                  
                  video.onerror = () => {
                    console.error(`Failed to load video: ${asset.name}`);
                    resolve(asset);
                  };
                  
                  video.src = asset.src;
                });
              } else if (asset.type === 'audio') {
                return new Promise<Asset>((resolve) => {
                  const audio = document.createElement('audio');
                  audio.crossOrigin = 'anonymous';
                  audio.preload = 'metadata';
                  
                  audio.onloadedmetadata = async () => {
                    console.log(`Audio loaded: ${asset.name}, ${audio.duration}s`);
                    const loadedAsset: Asset = {
                      ...asset,
                      element: audio,
                      duration: asset.duration || audio.duration,
                    };
                    
                    // Generate waveform if missing
                    if (!loadedAsset.waveform) {
                      try {
                        loadedAsset.waveform = await generateWaveform(asset.src);
                      } catch (e) {
                        console.warn('Failed to generate waveform');
                      }
                    }
                    
                    resolve(loadedAsset);
                  };
                  
                  audio.onerror = () => {
                    console.error(`Failed to load audio: ${asset.name}`);
                    resolve(asset);
                  };
                  
                  audio.src = asset.src;
                });
              } else if (asset.type === 'image') {
                return new Promise<Asset>((resolve) => {
                  const img = new Image();
                  img.crossOrigin = 'anonymous';
                  
                  img.onload = async () => {
                    console.log(`Image loaded: ${asset.name}`);
                    const loadedAsset: Asset = {
                      ...asset,
                      element: img,
                      width: asset.width || img.naturalWidth,
                      height: asset.height || img.naturalHeight,
                    };
                    
                    if (!loadedAsset.thumbnail) {
                      try {
                        loadedAsset.thumbnail = await generateThumbnail(img, 'image');
                      } catch (e) {
                        console.warn('Failed to generate thumbnail');
                      }
                    }
                    
                    resolve(loadedAsset);
                  };
                  
                  img.onerror = () => {
                    console.error(`Failed to load image: ${asset.name}`);
                    resolve(asset);
                  };
                  
                  img.src = asset.src;
                });
              }
              
              return asset;
            })
          );
          
          editorProject.assets = assetsWithElements;
          console.log('Editor project loaded with elements:', editorProject);
          setProject(editorProject);
        })();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setProject]);

  // Settings modal
  const handleOpenSettings = () => {
    const key = prompt('Enter Gemini API Key:', geminiApiKey);
    if (key !== null) {
      setGeminiApiKey(key);
      localStorage.setItem('geminiApiKey', key);
    }
    
    const path = prompt('Enter Project Path:', projectPath || '/home/exedev/video-maker/projects/my-project');
    if (path !== null) {
      setProjectPath(path);
      localStorage.setItem('projectPath', path);
    }
  };

  return (
    <div className={`app-container ${isEmbedded ? 'embedded' : ''}`}>
      {/* Header with tabs - hidden when embedded */}
      {!isEmbedded && (
        <header className="app-header">
          <div className="app-brand">
            <h1>🎬 Video Editor</h1>
          </div>
          <ProjectControls
            onLoadProject={handleLoadProject}
            onSaveProject={handleSaveProject}
            projectPath={projectPath}
            setProjectPath={(path) => {
              setProjectPath(path);
              localStorage.setItem('projectPath', path);
            }}
          />
          <nav className="app-tabs">
            <button
              className={`tab-btn ${activeTab === 'prompting' ? 'active' : ''}`}
              onClick={() => setActiveTab('prompting')}
            >
              ✍️ Prompting
            </button>
            <button
              className={`tab-btn ${activeTab === 'storyboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('storyboard')}
            >
              🎬 Storyboard
            </button>
            <button
              className={`tab-btn ${activeTab === 'editing' ? 'active' : ''}`}
              onClick={() => setActiveTab('editing')}
            >
              🎞️ Editing
            </button>
          </nav>
          <div className="app-actions">
            {activeTab === 'storyboard' && storyboardData.scenes.length > 0 && (
              <button className="btn-download" onClick={handleDownloadStoryboard}>
                📥 Download JSON
              </button>
            )}
            <button className="btn-settings" onClick={handleOpenSettings}>
              ⚙️
            </button>
          </div>
        </header>
      )}

      {/* Tab Content */}
      <main className="app-content">
        {activeTab === 'prompting' && (
          <Prompting onGenerateStoryboard={handleGenerateStoryboard} />
        )}

        {activeTab === 'storyboard' && (
          <Storyboard
            storyPrompt={storyboardData.storyPrompt}
            scenes={storyboardData.scenes}
            onRegenerateScene={handleRegenerateScene}
            onEditScene={handleEditScene}
            onSendToEditor={handleSendToEditor}
          />
        )}

        {activeTab === 'editing' && (
          <div className="editor-layout">
            <Toolbar
              selectedTool={selectedTool}
              setSelectedTool={setSelectedTool}
              brushSettings={brushSettings}
              setBrushSettings={setBrushSettings}
              showOnionSkin={showOnionSkin}
              setShowOnionSkin={setShowOnionSkin}
              onionSkinFrames={onionSkinFrames}
              setOnionSkinFrames={setOnionSkinFrames}
              currentTime={currentTime}
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
              playbackSpeed={playbackSpeed}
              setPlaybackSpeed={setPlaybackSpeed}
              undo={undo}
              redo={redo}
              canUndo={canUndo()}
              canRedo={canRedo()}
            />
            <div className="editor-main">
              <AssetBrowser 
                onAssetHover={(assetType, assetData, position) => {
                  if (assetType && assetData) {
                    setShowAssetPreview({ show: true, assetType, assetData, position });
                  } else {
                    setShowAssetPreview(prev => ({ ...prev, show: false }));
                  }
                }}
              />
              <Canvas
                selectedTool={selectedTool}
                brushSettings={brushSettings}
                currentTime={currentTime}
                showOnionSkin={showOnionSkin}
                onionSkinFrames={onionSkinFrames}
              />
            </div>
            <Timeline
              currentTime={currentTime}
              setCurrentTime={setCurrentTime}
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
              playbackSpeed={playbackSpeed}
            />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
