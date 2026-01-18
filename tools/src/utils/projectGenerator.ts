import { Project, Asset, Track, Clip } from '../types';
import { v4 as uuidv4 } from 'uuid';

export interface StoryboardScene {
  id: string;
  narration: string;
  imagePrompt: string;
  imageUrl?: string;
  duration?: number; // in frames
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

  // Create assets from scenes
  const assets: Asset[] = storyboard.scenes
    .filter(scene => scene.imageUrl)
    .map((scene, index) => ({
      id: `asset_scene_${index + 1}`,
      type: 'image' as const,
      src: scene.imageUrl!,
      name: `Scene ${index + 1}`,
      width: settings.canvasWidth,
      height: settings.canvasHeight
    }));

  // Create clips for each scene
  const clips: Clip[] = storyboard.scenes
    .filter(scene => scene.imageUrl)
    .map((scene, index) => {
      const duration = scene.duration || settings.defaultSceneDuration;
      const startFrame = storyboard.scenes
        .slice(0, index)
        .reduce((acc, s) => acc + (s.duration || settings.defaultSceneDuration), 0);

      return {
        id: `clip_scene_${index + 1}`,
        assetId: `asset_scene_${index + 1}`,
        start: startFrame,
        duration: duration,
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
