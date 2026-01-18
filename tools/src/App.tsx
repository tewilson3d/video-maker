import React, { useEffect, useState } from 'react';
import Toolbar from './components/Toolbar';
import AssetBrowser from './components/AssetBrowser';
import Canvas from './components/Canvas';
import Timeline from './components/Timeline';
import Prompting from './components/Prompting';
import Storyboard from './components/Storyboard';
import ProjectControls from './components/ProjectControls';
import { useEditorStore } from './store';
import { Project } from './types';
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
  const handleSendToEditor = (scenes: StoryboardScene[]) => {
    // Create a storyboard with only selected scenes
    const selectedStoryboard: StoryboardData = {
      ...storyboardData,
      scenes: scenes
    };

    // Generate the project from storyboard
    const generatedProject = generateProjectFromStoryboard(selectedStoryboard);
    
    // Load into editor
    setProject(generatedProject);
    
    // Save project JSON
    if (projectPath) {
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
  const handleLoadProject = (data: { project?: Project; storyboard?: StoryboardData }) => {
    if (data.storyboard) {
      setStoryboardData(data.storyboard);
      // If storyboard has scenes with images, go to storyboard tab
      if (data.storyboard.scenes.some(s => s.imageUrl)) {
        setActiveTab('storyboard');
      }
    }
    if (data.project) {
      setProject(data.project);
      setActiveTab('editing');
    }
  };

  // Save project handler
  const handleSaveProject = async () => {
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
