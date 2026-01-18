export interface Asset {
  id: string;
  type: 'video' | 'image' | 'audio';
  src: string;
  name: string;
  duration?: number;
  width?: number;
  height?: number;
  element?: HTMLVideoElement | HTMLImageElement | HTMLAudioElement;
  thumbnail?: string; // Base64 data URL for thumbnail
  waveform?: number[]; // Array of amplitude values for audio waveform
}

export interface Keyframe {
  time: number;
  value: any;
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

export interface TransformKeyframes {
  position?: Keyframe[];
  rotation?: Keyframe[];
  scale?: Keyframe[];
  opacity?: Keyframe[];
}

export interface AudioKeyframes {
  volume?: Keyframe[];
}

export interface Clip {
  id: string;
  assetId: string;
  start: number;
  duration: number;
  inPoint?: number;
  outPoint?: number;
  reversed?: boolean;
  playbackSpeed?: number; // Default 1.0 = normal speed, 0.5 = half speed, 2.0 = double speed
  keyframes?: TransformKeyframes;
  audioKeyframes?: AudioKeyframes;
}

export interface Track {
  id: string;
  type: 'video' | 'audio';
  name: string;
  clips: Clip[];
  visible: boolean;
  locked: boolean;
}

export interface Timeline {
  tracks: Track[];
  currentTime: number;
  duration: number;
  fps: number;
  zoom: number;
}

export interface Project {
  id: string;
  name: string;
  assets: Asset[];
  timeline: Timeline;
  canvasWidth: number;
  canvasHeight: number;
  backgroundColor: string;
}

export interface Transform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  fps: number;
}

export interface PNGFile {
  id: string;
  name: string;
  src: string;
  file: File;
  selected: boolean;
}

export interface FlipbookState {
  isPlaying: boolean;
  currentFrame: number;
  fps: number;
  loop: boolean;
} 