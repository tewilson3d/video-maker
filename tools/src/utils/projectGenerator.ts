import { Project, Asset, Track, Clip } from '../types';
import { v4 as uuidv4 } from 'uuid';

export interface StoryboardScene {
  id: string;
  narration: string;
  imagePrompt: string;
  imageUrl?: string;
  videoUrl?: string;           // URL to video clip if generated
  imageFile?: string | null;   // Original image filename (e.g., "keyframe1.png")
  videoFile?: string | null;   // Original video filename (e.g., "keyframe1_variant1.mp4")
  duration?: number;           // Legacy: in frames
  generationDuration?: number; // How long Veo generates (5 or 8 seconds)
  editDuration?: number;       // How long clip appears in final edit (seconds)
  status?: string;             // 'pending' | 'generating' | 'complete' | 'error'
}

export interface StoryboardData {
  storyPrompt: string;
  characters: { index: number; description: string; imageUrl?: string }[];
  scenes: StoryboardScene[];
  settings?: {
    fps: number;
    canvasWidth: number;
    canvasHeight: number;
    defaultSceneDuration: number; // in frames
  };
}

export function generateProjectFromStoryboard(storyboard: StoryboardData): Project {
  const settings = storyboard.settings || {
    fps: 30,
    canvasWidth: 1920,
    canvasHeight: 1080,
    defaultSceneDuration: 120 // 4 seconds at 30fps
  };

  // Helper to convert edit duration (seconds) to frames
  const secondsToFrames = (seconds: number) => Math.round(seconds * settings.fps);
  
  // Helper to get clip duration in frames
  // Priority: editDuration (seconds) > duration (seconds) > default
  const getClipDuration = (scene: StoryboardScene) => {
    if (scene.editDuration !== undefined) {
      return secondsToFrames(scene.editDuration);
    }
    // duration is in seconds (from project.json), convert to frames
    if (scene.duration !== undefined) {
      return secondsToFrames(scene.duration);
    }
    return settings.defaultSceneDuration;
  };

  // Create assets from scenes - prefer video over image
  const assets: Asset[] = storyboard.scenes
    .filter(scene => scene.videoUrl || scene.imageUrl)
    .map((scene, index) => {
      const hasVideo = !!scene.videoUrl;
      return {
        id: `asset_scene_${index + 1}`,
        type: hasVideo ? 'video' as const : 'image' as const,
        src: hasVideo ? scene.videoUrl! : scene.imageUrl!,
        name: `Scene ${index + 1}`,
        width: settings.canvasWidth,
        height: settings.canvasHeight,
        // For videos, store the generation duration for reference
        duration: hasVideo && scene.generationDuration 
          ? secondsToFrames(scene.generationDuration) 
          : undefined
      };
    });

  // Create clips for each scene using editDuration
  let currentFrame = 0;
  const clips: Clip[] = storyboard.scenes
    .filter(scene => scene.videoUrl || scene.imageUrl)
    .map((scene, index) => {
      const clipDuration = getClipDuration(scene);
      const startFrame = currentFrame;
      currentFrame += clipDuration;

      // Get edit duration in seconds for inPoint/outPoint (video trimming uses seconds)
      const editDurationSeconds = scene.editDuration || (scene.duration ? scene.duration : settings.defaultSceneDuration / settings.fps);
      
      return {
        id: `clip_scene_${index + 1}`,
        assetId: `asset_scene_${index + 1}`,
        start: startFrame,
        duration: clipDuration,
        // inPoint/outPoint are in SECONDS for video trimming
        inPoint: 0,
        outPoint: editDurationSeconds,
        keyframes: {
          position: [{ time: 0, value: { x: 0, y: 0 }, easing: 'linear' as const }],
          scale: [{ time: 0, value: { x: 1, y: 1 }, easing: 'linear' as const }],
          rotation: [{ time: 0, value: 0, easing: 'linear' as const }],
          opacity: [{ time: 0, value: 1, easing: 'linear' as const }]
        }
      };
    });

  // Calculate total duration
  const totalDuration = clips.reduce((acc, clip) => Math.max(acc, clip.start + clip.duration), 0);

  // Create the project
  const project: Project = {
    id: uuidv4(),
    name: storyboard.storyPrompt.substring(0, 50) || 'Untitled Project',
    assets: assets,
    timeline: {
      tracks: [
        {
          id: 'track_video_1',
          type: 'video',
          name: 'Video 1',
          clips: clips,
          visible: true,
          locked: false
        },
        {
          id: 'track_audio_1',
          type: 'audio',
          name: 'Audio 1',
          clips: [],
          visible: true,
          locked: false
        }
      ],
      currentTime: 0,
      duration: totalDuration,
      fps: settings.fps,
      zoom: 1
    },
    canvasWidth: settings.canvasWidth,
    canvasHeight: settings.canvasHeight,
    backgroundColor: '#000000'
  };

  return project;
}

export function exportStoryboardJSON(storyboard: StoryboardData): string {
  return JSON.stringify(storyboard, null, 2);
}

export function exportProjectJSON(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function downloadJSON(data: string, filename: string) {
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
