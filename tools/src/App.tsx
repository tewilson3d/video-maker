import React, { useEffect, useState, useRef } from 'react';
import Toolbar from './components/Toolbar';
import AssetBrowser from './components/AssetBrowser';
import Canvas from './components/Canvas';
import Timeline from './components/Timeline';
import PNGFlipbookViewer from './components/PNGFlipbookViewer';
import Prompting from './components/Prompting';
import Storyboard from './components/Storyboard';
import { useEditorStore } from './store';

// Main tabs for the unified app
type MainTab = 'prompting' | 'storyboard' | 'editing';

interface Scene {
  id: string;
  narration: string;
  imagePrompt: string;
  imageUrl?: string;
  status: 'pending' | 'generating' | 'complete' | 'error';
}

interface StoryboardData {
  storyPrompt: string;
  characters: { index: number; description: string; imageUrl?: string }[];
  scenes: Scene[];
}

function App() {
  const [activeTab, setActiveTab] = useState<MainTab>('prompting');
  const [storyboardData, setStoryboardData] = useState<StoryboardData>({
    storyPrompt: '',
    characters: [],
    scenes: []
  });
  
  const { 
    project, 
    selectedTool,
    setSelectedTool,
    clearCanvasSelection,
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
    canvasSelectedClipId,
    setCanvasSelectedClipId,
    selectedClipIds,
    setSelectedClipIds,
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

  // Generate storyboard from prompts
  const handleGenerateStoryboard = async (data: {
    storyPrompt: string;
    characters: { index: number; description: string }[];
    keyframes: { index: number; description: string }[];
  }) => {
    // Create initial scenes with pending status
    const scenes: Scene[] = data.keyframes.map((kf, i) => ({
      id: `scene_${i + 1}`,
      narration: kf.description,
      imagePrompt: kf.description,
      imageUrl: undefined,
      status: 'pending' as const
    }));

    setStoryboardData({
      storyPrompt: data.storyPrompt,
      characters: data.characters.map(c => ({ ...c, imageUrl: undefined })),
      scenes
    });

    // Switch to storyboard tab
    setActiveTab('storyboard');

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
        setStoryboardData(prev => ({
          ...prev,
          scenes: prev.scenes.map((s, idx) => 
            idx === i ? { ...s, imageUrl, status: 'complete' as const } : s
          )
        }));

        // Auto-save keyframe to server
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

  // Generate scene image using Gemini API
  const generateSceneImage = async (
    sceneDescription: string,
    storyContext: string,
    characterDescriptions: string[]
  ): Promise<string> => {
    if (!geminiApiKey) {
      throw new Error('Gemini API key not configured');
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
      throw new Error('Failed to generate image');
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
    const projectPath = localStorage.getItem('projectPath') || `/home/exedev/video-maker/projects/project-${Date.now()}`;
    
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

      setStoryboardData(prev => ({
        ...prev,
        scenes: prev.scenes.map((s, idx) => 
          idx === index ? { ...s, imageUrl, status: 'complete' as const } : s
        )
      }));

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
  const handleEditScene = (index: number, scene: Scene) => {
    setStoryboardData(prev => ({
      ...prev,
      scenes: prev.scenes.map((s, idx) => idx === index ? scene : s)
    }));
  };

  // Send scenes to editor
  const handleSendToEditor = (scenes: Scene[]) => {
    // Add scenes as clips to the timeline
    const newClips = scenes.map((scene, i) => ({
      id: `clip_${Date.now()}_${i}`,
      type: 'image' as const,
      name: `Scene ${i + 1}`,
      startFrame: i * 120, // 4 seconds each at 30fps
      duration: 120,
      src: scene.imageUrl || '',
      transform: {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1
      }
    }));

    // Add to project timeline
    setProject({
      ...project,
      timeline: {
        ...project.timeline,
        tracks: [
          {
            ...project.timeline.tracks[0],
            clips: [...project.timeline.tracks[0].clips, ...newClips]
          },
          ...project.timeline.tracks.slice(1)
        ]
      }
    });

    setActiveTab('editing');
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

  return (
    <div className="app-container">
      {/* Header with tabs */}
      <header className="app-header">
        <div className="app-brand">
          <h1>🎬 Video Editor</h1>
        </div>
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
          <button 
            className="btn-settings"
            onClick={() => {
              const key = prompt('Enter Gemini API Key:', geminiApiKey);
              if (key !== null) {
                setGeminiApiKey(key);
                localStorage.setItem('geminiApiKey', key);
              }
            }}
          >
            ⚙️
          </button>
        </div>
      </header>

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
