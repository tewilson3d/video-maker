import React, { useRef, useState } from 'react';
import { useEditorStore } from '../store';
import { Asset } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { generateThumbnail } from '../utils/thumbnails';
import { generateWaveform } from '../utils/waveform';
import { interpolateWithEasing } from '../utils/easing';

const Toolbar: React.FC = () => {
  const { project, addAsset, addTrack, setProject, selectedClipIds, undo, redo, canUndo, canRedo, getClipTransform, getEffectiveDuration, saveInitialHistory, setFPS } = useEditorStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [videoQuality, setVideoQuality] = useState<'low' | 'medium' | 'high' | 'ultra'>('medium');

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      const url = URL.createObjectURL(file);
      const asset: Asset = {
        id: uuidv4(),
        type: getFileType(file.type),
        src: url,
        name: file.name,
      };

      // Load asset metadata
      if (asset.type === 'video') {
        const video = document.createElement('video');
        video.src = url;
        video.muted = true; // Mute video elements - audio is handled separately
        video.onloadedmetadata = async () => {
          asset.duration = video.duration;
          asset.width = video.videoWidth;
          asset.height = video.videoHeight;
          asset.element = video;
          
          try {
            asset.thumbnail = await generateThumbnail(video, 'video');
          } catch (error) {
            console.warn('Failed to generate video thumbnail:', error);
          }
          
          // Check if video has audio tracks
          const hasAudio = await checkVideoHasAudio(video);
          if (hasAudio) {
            // Check if corresponding audio asset already exists in the project
            const expectedAudioName = `${asset.name} (Audio)`;
            const existingAudioAsset = project.assets.find(a => 
              a.type === 'audio' && a.name === expectedAudioName
            );
            
            if (!existingAudioAsset) {
              console.log(`Video ${asset.name} has audio, creating audio asset`);
              try {
                // Create corresponding audio asset
                const audioAsset: Asset = {
                  id: uuidv4(),
                  type: 'audio',
                  src: url,
                  name: expectedAudioName,
                  duration: video.duration,
                  width: 0,
                  height: 0,
                  element: undefined, // Will be set when audio element is created
                  waveform: await generateWaveform(url)
                };
                
                // Create audio element
                const audio = document.createElement('audio');
                audio.src = url;
                audio.preload = 'metadata';
                audioAsset.element = audio;
                
                // Add both video and audio assets
                addAsset(asset);
                addAsset(audioAsset);
                
                console.log(`Created audio asset for ${asset.name}: ${audioAsset.waveform?.length} samples`);
              } catch (error) {
                console.warn('Failed to extract audio from video:', error);
                // Still add the video asset even if audio extraction fails
                addAsset(asset);
              }
            } else {
              console.log(`Audio asset already exists for ${asset.name}, skipping creation`);
              // Still add the video asset
              addAsset(asset);
            }
          } else {
            // No audio track, just add the video asset
            addAsset(asset);
          }
        };
      } else if (asset.type === 'image') {
        const img = document.createElement('img');
        img.src = url;
        img.onload = async () => {
          asset.width = img.naturalWidth;
          asset.height = img.naturalHeight;
          asset.element = img;
          
          try {
            asset.thumbnail = await generateThumbnail(img, 'image');
          } catch (error) {
            console.warn('Failed to generate image thumbnail:', error);
          }
          
          addAsset(asset);
        };
      } else if (asset.type === 'audio') {
        const audio = document.createElement('audio');
        audio.src = url;
        audio.preload = 'metadata';
        audio.onloadedmetadata = async () => {
          asset.duration = audio.duration;
          asset.element = audio;
          
          try {
            // Generate waveform data
            asset.waveform = await generateWaveform(url);
            console.log(`Generated waveform for ${asset.name} with ${asset.waveform.length} samples`);
          } catch (error) {
            console.warn('Failed to generate waveform:', error);
          }
          
          addAsset(asset);
        };
        // Load the audio element to trigger metadata loading
        audio.load();
      }
    });

    // Clear the file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const getFileType = (mimeType: string): 'video' | 'image' | 'audio' => {
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'image';
  };

  // Helper function to check if a video has audio tracks
  const checkVideoHasAudio = async (video: HTMLVideoElement): Promise<boolean> => {
    return new Promise((resolve) => {
      // Wait for the video to load enough metadata
      const checkAudio = () => {
        try {
          // Check if the video element has audio tracks
          if ('webkitAudioDecodedByteCount' in video && (video as any).webkitAudioDecodedByteCount > 0) {
            resolve(true);
            return;
          }
          
          // Alternative method: check for audio tracks using MediaStreams API
          if ('captureStream' in video) {
            try {
              const stream = (video as any).captureStream();
              const audioTracks = stream.getAudioTracks();
              resolve(audioTracks.length > 0);
              
              // Clean up the stream
              audioTracks.forEach((track: MediaStreamTrack) => track.stop());
              return;
            } catch (e) {
              // captureStream failed, continue to fallback
            }
          }
          
          // Fallback: assume videos have audio unless specifically known not to
          // This is a conservative approach since most mp4 videos do have audio
          resolve(true);
        } catch (error) {
          // If all methods fail, assume no audio
          console.warn('Could not determine if video has audio:', error);
          resolve(false);
        }
      };
      
      if (video.readyState >= 1) { // HAVE_METADATA
        checkAudio();
      } else {
        video.addEventListener('loadedmetadata', checkAudio, { once: true });
      }
    });
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleSave = () => {
    // Create a saveable version of the project without HTML elements
    const saveableProject = {
      ...project,
      assets: project.assets.map(asset => ({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        duration: asset.duration,
        width: asset.width,
        height: asset.height,
        fileName: asset.name, // Store the filename for recreation
      }))
    };
    
    const projectData = JSON.stringify(saveableProject, null, 2);
    const blob = new Blob([projectData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}.vproj`;
    a.click();
    URL.revokeObjectURL(url);
  };

    const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.vproj,.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const projectData = JSON.parse(event.target?.result as string);
            
            // Always process assets for metadata generation and file reloading
            if (projectData.assets && projectData.assets.length > 0) {
              console.log(`Loading project with ${projectData.assets.length} assets...`);
              
              // Check if assets have file references that might benefit from reloading
              const hasFileReferences = projectData.assets.some((asset: any) => 
                asset.fileName || (asset.src && !asset.src.startsWith('blob:'))
              );
              
              if (hasFileReferences) {
                // Show options to user immediately while we have user activation
                const choice = confirm(
                  `This project contains ${projectData.assets.length} assets.\n\n` +
                  'Click OK to select the folder containing your media files for best quality,\n' +
                  'or Cancel to load with automatic metadata generation.'
                );
                
                if (choice) {
                  // User wants to reload assets - trigger folder selection immediately
                  loadProjectWithAssetsFolder(projectData);
                } else {
                  // Load without assets but generate missing metadata
                  loadProjectWithoutAssets(projectData);
                }
              } else {
                // No file references, just process for missing metadata
                loadProjectWithoutAssets(projectData);
              }
            } else {
              // No assets, just set the project directly
              setProject(projectData);
              saveInitialHistory();
            }
          } catch (error) {
            console.error('Error loading project:', error);
            alert('Error loading project file');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const loadProjectWithAssetsFolder = (projectData: any) => {
    // Create folder input immediately while we have user activation
    const folderInput = document.createElement('input');
    folderInput.type = 'file';
    folderInput.webkitdirectory = true;
    folderInput.multiple = true;
    
    folderInput.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        await loadAssetsFromFiles(projectData, files);
      } else {
        // User cancelled folder selection, load without assets but generate missing metadata
        loadProjectWithoutAssets(projectData);
      }
    };
    
    // Trigger folder selection immediately
    folderInput.click();
  };

  const loadAssetsFromFiles = async (projectData: any, files: FileList) => {
    const { setAssetsLoading } = useEditorStore.getState();
    setAssetsLoading(true);
    
    console.log('🔄 Loading project with assets folder, processing files...');
    console.log(`Project has ${projectData.assets.length} assets, folder has ${files.length} files`);
    
    const recreatedAssets: Asset[] = [];
    
    for (const savedAsset of projectData.assets) {
      console.log(`Processing asset: ${savedAsset.name || savedAsset.fileName} (${savedAsset.type})`);
      
      // Find matching file by name
      const matchingFile = Array.from(files).find(file => 
        file.name === savedAsset.fileName || 
        file.name === savedAsset.name
      );
      
      if (matchingFile) {
        try {
          console.log(`Found matching file: ${matchingFile.name}`);
          const recreatedAsset = await createAssetFromFile(matchingFile, savedAsset.id);
          
          // Only preserve saved properties if they exist AND the new ones are missing
          // This prevents overwriting correct metadata with AI-generated placeholders
          if (savedAsset.duration && !recreatedAsset.duration) {
            recreatedAsset.duration = savedAsset.duration;
          }
          if (savedAsset.width && !recreatedAsset.width) {
            recreatedAsset.width = savedAsset.width;
          }
          if (savedAsset.height && !recreatedAsset.height) {
            recreatedAsset.height = savedAsset.height;
          }
          
          console.log(`Asset recreated with metadata: duration=${recreatedAsset.duration}, ${recreatedAsset.width}×${recreatedAsset.height}`);
          recreatedAssets.push(recreatedAsset);
        } catch (error) {
          console.warn(`Could not recreate asset: ${savedAsset.name}`, error);
          // Create a placeholder asset with original saved properties
          recreatedAssets.push({
            ...savedAsset,
            src: savedAsset.src || '',
            element: undefined, // Will be handled gracefully by Canvas
          });
        }
      } else {
        console.warn(`Asset file not found: ${savedAsset.name}`);
        // Create a placeholder asset with original saved properties
        recreatedAssets.push({
          ...savedAsset,
          src: savedAsset.src || '',
          element: undefined,
        });
      }
    }
    
    // Generate missing metadata for any assets that still need it
    console.log('🔍 Checking all assets for missing metadata...');
    const finalAssets = await Promise.all(
      recreatedAssets.map(async (asset) => {
        // Check if essential metadata is missing for any asset
        const needsMetadata = (
          (asset.type === 'video' && (!asset.duration || !asset.width || !asset.height)) ||
          (asset.type === 'audio' && (!asset.duration || !asset.waveform)) ||
          (asset.type === 'image' && (!asset.width || !asset.height)) ||
          !asset.thumbnail // Always try to generate thumbnails if missing
        );
        
        const assetIdentifier = (asset as any).fileName || asset.name || 'unknown';
        console.log(`Asset ${assetIdentifier}: type=${asset.type}, needsMetadata=${needsMetadata}`, {
          duration: asset.duration,
          width: asset.width, 
          height: asset.height,
          waveform: asset.waveform ? 'present' : 'missing',
          thumbnail: asset.thumbnail ? 'present' : 'missing',
          hasElement: !!asset.element
        });
        
        if (needsMetadata) {
          console.log(`Generating missing metadata for ${assetIdentifier}...`);
          try {
            const metadata = await generateAssetMetadata(asset as any);
            const updatedAsset = { ...asset, ...metadata };
            console.log(`Generated metadata for ${assetIdentifier}:`, metadata);
            return updatedAsset;
          } catch (error) {
            console.warn(`Failed to generate metadata for ${assetIdentifier}:`, error);
            
            // Provide fallback metadata even if generation fails
            const fallbackAsset = { ...asset };
            if (asset.type === 'video' && !asset.duration) {
              fallbackAsset.duration = 10; // Default 10 seconds
              fallbackAsset.width = fallbackAsset.width || 1920;
              fallbackAsset.height = fallbackAsset.height || 1080;
            } else if (asset.type === 'audio' && !asset.duration) {
              fallbackAsset.duration = 30; // Default 30 seconds
            } else if (asset.type === 'image') {
              fallbackAsset.width = fallbackAsset.width || 1920;
              fallbackAsset.height = fallbackAsset.height || 1080;
            }
            return fallbackAsset;
          }
        }
        
        return asset;
      })
    );
    
    console.log('✅ Project loaded with folder assets and metadata generation complete');
    console.log('Final processed assets:', finalAssets);
    
    // Set project with processed assets
    setProject({
      ...projectData,
      assets: finalAssets
    });
    
    // After setting the project, check for missing audio assets from videos
    await checkAndExtractMissingAudioAssets();
    
    // Mark assets as finished loading
    setAssetsLoading(false);
  };

  const loadProjectWithoutAssets = async (projectData: any) => {
    const { setAssetsLoading } = useEditorStore.getState();
    setAssetsLoading(true);
    
    console.log('🔄 Loading project without assets, checking for missing metadata...');
    console.log('Project data:', projectData);
    
    if (!projectData.assets || projectData.assets.length === 0) {
      console.log('No assets to process, setting project directly');
      setProject(projectData);
      saveInitialHistory();
      setAssetsLoading(false);
      return;
    }
    
    console.log(`Processing ${projectData.assets.length} assets for metadata generation...`);
    
    // Process assets and generate missing metadata
    const processedAssets = await Promise.all(
      projectData.assets.map(async (asset: any) => {
        const processedAsset = {
          ...asset,
          src: asset.src || '',
          element: undefined
        };
        
        // Check if essential metadata is missing
        const needsMetadata = (
          (asset.type === 'video' && (!asset.duration || !asset.width || !asset.height)) ||
          (asset.type === 'audio' && (!asset.duration || !asset.waveform)) ||
          (asset.type === 'image' && (!asset.width || !asset.height)) ||
          !asset.thumbnail // Always try to generate thumbnails if missing
        );
        
        console.log(`Asset ${asset.name || asset.fileName}: type=${asset.type}, needsMetadata=${needsMetadata}`, {
          duration: asset.duration,
          width: asset.width, 
          height: asset.height,
          waveform: asset.waveform ? 'present' : 'missing',
          thumbnail: asset.thumbnail ? 'present' : 'missing'
        });
        
        if (needsMetadata) {
          const assetIdentifier = asset.fileName || asset.name || 'unknown';
          console.log(`Generating missing metadata for ${assetIdentifier}...`);
          try {
            const metadata = await generateAssetMetadata(asset);
            Object.assign(processedAsset, metadata);
            console.log(`Generated metadata for ${assetIdentifier}:`, metadata);
          } catch (error) {
            console.warn(`Failed to generate metadata for ${assetIdentifier}:`, error);
            
            // Provide fallback metadata even if generation fails
            if (asset.type === 'video' && !asset.duration) {
              processedAsset.duration = 10; // Default 10 seconds
              processedAsset.width = processedAsset.width || 1920;
              processedAsset.height = processedAsset.height || 1080;
            } else if (asset.type === 'audio' && !asset.duration) {
              processedAsset.duration = 30; // Default 30 seconds
            } else if (asset.type === 'image') {
              processedAsset.width = processedAsset.width || 1920;
              processedAsset.height = processedAsset.height || 1080;
            }
          }
        }
        
        return processedAsset;
      })
    );
    
    console.log('✅ Project loaded with metadata generation complete');
    console.log('Final processed assets:', processedAssets);
    
    setProject({
      ...projectData,
      assets: processedAssets
    });
    
    // After setting the project, check for missing audio assets from videos
    await checkAndExtractMissingAudioAssets();
    
    saveInitialHistory();
    
    setAssetsLoading(false);
  };

  // Function to check and extract audio from video assets during project loading
  const checkAndExtractMissingAudioAssets = async () => {
    const { project: currentProject, addAsset, addTrack, addClipToTrack } = useEditorStore.getState();
    
    console.log('🔍 Checking for missing audio assets from videos...');
    
    const videoAssets = currentProject.assets.filter(asset => asset.type === 'video');
    const audioAssetsToCreate: Asset[] = [];
    const videoAssetsWithAudio: Asset[] = [];
    
    for (const videoAsset of videoAssets) {
      const expectedAudioName = `${videoAsset.name} (Audio)`;
      const existingAudioAsset = currentProject.assets.find(a => 
        a.type === 'audio' && a.name === expectedAudioName
      );
      
      // Check if we need to extract audio - either no asset exists OR the asset exists but has no valid audio element
      const needsAudioExtraction = !existingAudioAsset || !existingAudioAsset.element || !(existingAudioAsset.element instanceof HTMLAudioElement);
      
      if (needsAudioExtraction) {
        console.log(`Checking if video ${videoAsset.name} has embedded audio...`);
        
        try {
          // Create video element to check for audio
          const video = document.createElement('video');
          video.crossOrigin = 'anonymous';
          video.preload = 'metadata';
          video.muted = true;
          
          const hasAudio = await new Promise<boolean>((resolve) => {
            video.onloadedmetadata = async () => {
              const audioExists = await checkVideoHasAudio(video);
              resolve(audioExists);
            };
            
            video.onerror = () => {
              console.warn(`Failed to load video ${videoAsset.name} for audio check`);
              resolve(false);
            };
            
            // Try multiple possible sources
            const possibleSources = [
              videoAsset.src,
              (videoAsset as any).fileName ? `./${(videoAsset as any).fileName}` : null,
              videoAsset.name ? `./${videoAsset.name}` : null,
            ].filter(Boolean);
            
            const src = possibleSources[0];
            if (src) {
              video.src = src;
            } else {
              resolve(false);
            }
          });
          
          if (hasAudio) {
            console.log(`Video ${videoAsset.name} has embedded audio, ${existingAudioAsset ? 'updating existing' : 'creating new'} audio asset...`);
            
            let audioAsset: Asset;
            
            if (existingAudioAsset) {
              // Update existing audio asset with proper audio element
              audioAsset = {
                ...existingAudioAsset,
                src: videoAsset.src, // Ensure src is current
                duration: videoAsset.duration || existingAudioAsset.duration || 10,
                element: undefined,
                waveform: await generateWaveform(videoAsset.src)
              };
            } else {
              // Create new audio asset
              audioAsset = {
                id: uuidv4(),
                type: 'audio',
                src: videoAsset.src,
                name: expectedAudioName,
                duration: videoAsset.duration || 10,
                width: 0,
                height: 0,
                element: undefined,
                waveform: await generateWaveform(videoAsset.src)
              };
            }
            
            // Create audio element
            const audio = document.createElement('audio');
            audio.src = videoAsset.src;
            audio.preload = 'metadata';
            audioAsset.element = audio;
            
            audioAssetsToCreate.push(audioAsset);
            videoAssetsWithAudio.push(videoAsset);
            console.log(`Prepared audio asset for ${videoAsset.name}: ${audioAsset.waveform?.length} samples`);
          } else {
            console.log(`Video ${videoAsset.name} has no embedded audio, skipping`);
          }
        } catch (error) {
          console.warn(`Failed to check audio for video ${videoAsset.name}:`, error);
        }
      } else {
        console.log(`Audio asset already exists for ${videoAsset.name}, skipping`);
      }
    }
    
    // Add all the audio assets and create clips
    if (audioAssetsToCreate.length > 0) {
      console.log(`Processing ${audioAssetsToCreate.length} audio assets...`);
      
      // First, process all audio assets (add new ones or update existing ones)
      let clipsToCreate = 0;
      
      for (let i = 0; i < audioAssetsToCreate.length; i++) {
        const audioAsset = audioAssetsToCreate[i];
        const videoAsset = videoAssetsWithAudio[i];
        
        // Add or update the audio asset
        const expectedAudioName = `${videoAsset.name} (Audio)`;
        const existingAudioAsset = currentProject.assets.find((a: any) => 
          a.type === 'audio' && a.name === expectedAudioName
        );
        
        if (existingAudioAsset) {
          // Update existing asset in place
          const { setProject } = useEditorStore.getState();
          const currentProject = useEditorStore.getState().project;
          const updatedAssets = currentProject.assets.map((asset: any) => 
            asset.id === existingAudioAsset.id ? audioAsset : asset
          );
          setProject({
            ...currentProject,
            assets: updatedAssets
          });
          console.log(`Updated existing audio asset: ${audioAsset.name}`);
        } else {
          // Add new audio asset
          addAsset(audioAsset);
          console.log(`Added new audio asset: ${audioAsset.name}`);
        }
      }
      
      // Count how many clips we'll need to create
      const updatedProject = useEditorStore.getState().project;
      for (let i = 0; i < audioAssetsToCreate.length; i++) {
        const audioAsset = audioAssetsToCreate[i];
        const videoAsset = videoAssetsWithAudio[i];
        
        const videoClips = updatedProject.timeline.tracks
          .filter((track: any) => track.type === 'video')
          .flatMap((track: any) => track.clips)
          .filter((clip: any) => clip.assetId === videoAsset.id);
        
        // Count clips that don't already exist
        for (const videoClip of videoClips) {
          const existingAudioClip = updatedProject.timeline.tracks
            .filter((track: any) => track.type === 'audio')
            .flatMap((track: any) => track.clips)
            .find((clip: any) => 
              clip.assetId === audioAsset.id && 
              Math.abs(clip.start - videoClip.start) < 0.01 && 
              Math.abs(clip.duration - videoClip.duration) < 0.01
            );
          
          if (!existingAudioClip) {
            clipsToCreate++;
          }
        }
      }
      
      // Only create a new track if we have clips to create
      let extractedAudioTrack;
      if (clipsToCreate > 0) {
        console.log(`Creating new audio track for ${clipsToCreate} extracted audio clips...`);
        addTrack('audio');
        
        // Get the updated project state to find the new track
        const updatedProject = useEditorStore.getState().project;
        extractedAudioTrack = updatedProject.timeline.tracks.filter(track => track.type === 'audio').slice(-1)[0];
      }
      
              if (extractedAudioTrack) {
          console.log(`Created audio track: ${extractedAudioTrack.name} (${extractedAudioTrack.id})`);
          
          // Create corresponding clips for each video clip
          for (let i = 0; i < audioAssetsToCreate.length; i++) {
            const audioAsset = audioAssetsToCreate[i];
            const videoAsset = videoAssetsWithAudio[i];
            
            // Find all video clips that use this video asset
            const videoClips = updatedProject.timeline.tracks
              .filter((track: any) => track.type === 'video')
              .flatMap((track: any) => track.clips)
              .filter((clip: any) => clip.assetId === videoAsset.id);
            
            console.log(`Found ${videoClips.length} video clips using ${videoAsset.name}`);
            
            // Create corresponding audio clips for each video clip (only if they don't already exist)
            for (const videoClip of videoClips) {
              // Check if an audio clip already exists that matches this video clip
              const existingAudioClip = updatedProject.timeline.tracks
                .filter((track: any) => track.type === 'audio')
                .flatMap((track: any) => track.clips)
                .find((clip: any) => 
                  clip.assetId === audioAsset.id && 
                  Math.abs(clip.start - videoClip.start) < 0.01 && 
                  Math.abs(clip.duration - videoClip.duration) < 0.01
                );
              
              if (!existingAudioClip) {
                const audioClip = {
                  id: uuidv4(),
                  assetId: audioAsset.id,
                  start: videoClip.start,
                  duration: videoClip.duration,
                  // Copy trimming and playback properties from video clip
                  inPoint: videoClip.inPoint,
                  outPoint: videoClip.outPoint,
                  playbackSpeed: videoClip.playbackSpeed,
                  reversed: videoClip.reversed,
                  // Copy audio keyframes if they exist (for volume automation)
                  audioKeyframes: videoClip.audioKeyframes ? { ...videoClip.audioKeyframes } : undefined
                };
                
                addClipToTrack(extractedAudioTrack.id, audioClip);
                console.log(`Created audio clip in sync with video clip at ${videoClip.start}s, duration ${videoClip.duration}s`);
              } else {
                console.log(`Audio clip already exists for video clip at ${videoClip.start}s, skipping creation`);
              }
            }
          }
        
        console.log('✅ Successfully added missing audio assets and created synchronized audio clips');
      } else {
        console.warn('Failed to find the created audio track');
      }
    } else {
      console.log('No missing audio assets found');
    }
  };

  // Function to generate missing metadata for an asset
  const generateAssetMetadata = async (asset: any): Promise<Partial<Asset>> => {
    console.log(`Attempting to generate metadata for ${asset.type} asset:`, asset);
    
    return new Promise((resolve, reject) => {
      if (asset.type === 'video') {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.preload = 'metadata';
        video.muted = true; // Mute video elements - audio is handled separately
        
        video.onloadedmetadata = async () => {
          console.log(`Video metadata loaded successfully: ${video.duration}s, ${video.videoWidth}×${video.videoHeight}`);
          const metadata: Partial<Asset> = {
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
            element: video
          };
          
          // Generate thumbnail if missing
          if (!asset.thumbnail) {
            try {
              metadata.thumbnail = await generateThumbnail(video, 'video');
              console.log('Video thumbnail generated successfully');
            } catch (error) {
              console.warn('Failed to generate video thumbnail:', error);
            }
          }
          
          // Check if video has audio and create corresponding audio asset ONLY if it doesn't exist
          const hasAudio = await checkVideoHasAudio(video);
          if (hasAudio) {
            // Check if corresponding audio asset already exists in the project
            const { project: currentProject } = useEditorStore.getState();
            const expectedAudioName = `${asset.name || 'Video'} (Audio)`;
            const existingAudioAsset = currentProject.assets.find(a => 
              a.type === 'audio' && a.name === expectedAudioName
            );
            
            if (!existingAudioAsset) {
              console.log(`Video ${asset.name || 'unknown'} has audio, creating audio asset during project load`);
              try {
                const audioAsset: Asset = {
                  id: uuidv4(),
                  type: 'audio',
                  src: video.src,
                  name: expectedAudioName,
                  duration: video.duration,
                  width: 0,
                  height: 0,
                  element: undefined,
                  waveform: await generateWaveform(video.src)
                };
                
                const audio = document.createElement('audio');
                audio.src = video.src;
                audio.preload = 'metadata';
                audioAsset.element = audio;
                
                // Add the audio asset to the project
                const { addAsset } = useEditorStore.getState();
                addAsset(audioAsset);
                
                console.log(`Created audio asset during project load: ${audioAsset.waveform?.length} samples`);
              } catch (error) {
                console.warn('Failed to extract audio from video during project load:', error);
              }
            } else {
              console.log(`Audio asset already exists for ${asset.name || 'unknown'}, skipping creation`);
            }
          }
          
          resolve(metadata);
        };
        
        video.onerror = (e) => {
          console.warn(`Failed to load video for metadata generation:`, e);
          // If we can't load the video, provide reasonable defaults
          resolve({
            duration: asset.duration || 10,
            width: asset.width || 1920,
            height: asset.height || 1080,
            element: undefined
          });
        };
        
        // Try multiple possible src paths
        const possibleSources = [
          asset.src,
          asset.fileName ? `./${asset.fileName}` : null,
          asset.name ? `./${asset.name}` : null,
        ].filter(Boolean);
        
        console.log(`Trying video sources:`, possibleSources);
        const src = possibleSources[0];
        if (src) {
          video.src = src;
        } else {
          console.warn('No valid source found for video asset');
          resolve({
            duration: asset.duration || 10,
            width: asset.width || 1920,
            height: asset.height || 1080,
            element: undefined
          });
        }
        
      } else if (asset.type === 'audio') {
        const audio = document.createElement('audio');
        audio.crossOrigin = 'anonymous';
        audio.preload = 'metadata';
        
        audio.onloadedmetadata = async () => {
          console.log(`Audio metadata loaded successfully: ${audio.duration}s`);
          const metadata: Partial<Asset> = {
            duration: audio.duration,
            element: audio
          };
          
          // Generate waveform if missing
          if (!asset.waveform) {
            try {
              metadata.waveform = await generateWaveform(audio.src);
              console.log('Audio waveform generated successfully');
            } catch (error) {
              console.warn('Failed to generate waveform:', error);
            }
          }
          
          resolve(metadata);
        };
        
        audio.onerror = (e) => {
          console.warn(`Failed to load audio for metadata generation:`, e);
          // Provide reasonable defaults
          resolve({
            duration: asset.duration || 30,
            element: undefined
          });
        };
        
        // Try multiple possible src paths
        const possibleSources = [
          asset.src,
          asset.fileName ? `./${asset.fileName}` : null,
          asset.name ? `./${asset.name}` : null,
        ].filter(Boolean);
        
        console.log(`Trying audio sources:`, possibleSources);
        const src = possibleSources[0];
        if (src) {
          audio.src = src;
        } else {
          console.warn('No valid source found for audio asset');
          resolve({
            duration: asset.duration || 30,
            element: undefined
          });
        }
        
      } else if (asset.type === 'image') {
        const img = document.createElement('img');
        img.crossOrigin = 'anonymous';
        
        img.onload = async () => {
          console.log(`Image metadata loaded successfully: ${img.naturalWidth}×${img.naturalHeight}`);
          const metadata: Partial<Asset> = {
            width: img.naturalWidth,
            height: img.naturalHeight,
            duration: 5, // Images default to 5 seconds, but can be extended to 30 via trimming
            element: img
          };
          
          // Generate thumbnail if missing
          if (!asset.thumbnail) {
            try {
              metadata.thumbnail = await generateThumbnail(img, 'image');
              console.log('Image thumbnail generated successfully');
            } catch (error) {
              console.warn('Failed to generate image thumbnail:', error);
            }
          }
          
          resolve(metadata);
        };
        
        img.onerror = (e) => {
          console.warn(`Failed to load image for metadata generation:`, e);
          // Provide reasonable defaults
          resolve({
            width: asset.width || 1920,
            height: asset.height || 1080,
            duration: 5, // Images default to 5 seconds, but can be extended to 30 via trimming
            element: undefined
          });
        };
        
        // Try multiple possible src paths
        const possibleSources = [
          asset.src,
          asset.fileName ? `./${asset.fileName}` : null,
          asset.name ? `./${asset.name}` : null,
        ].filter(Boolean);
        
        console.log(`Trying image sources:`, possibleSources);
        const src = possibleSources[0];
        if (src) {
          img.src = src;
        } else {
          console.warn('No valid source found for image asset');
          resolve({
            width: asset.width || 1920,
            height: asset.height || 1080,
            element: undefined
          });
        }
        
      } else {
        resolve({});
      }
      
      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error('Metadata generation timeout'));
      }, 10000);
    });
  };

  const createAssetFromFile = async (file: File, assetId?: string): Promise<Asset> => {
    const type = getFileType(file.type);
    const url = URL.createObjectURL(file);
    
    return new Promise(async (resolve, reject) => {
      if (type === 'video') {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true; // Mute video elements - audio is handled separately
        video.onloadedmetadata = async () => {
          try {
            // Generate thumbnail for video
            const thumbnail = await generateThumbnail(video, 'video');
            
            // Check if video has audio and potentially create audio asset
            const hasAudio = await checkVideoHasAudio(video);
            
            const videoAsset: Asset = {
              id: assetId || crypto.randomUUID(),
              name: file.name,
              type: 'video',
              src: url,
              duration: video.duration,
              width: video.videoWidth,
              height: video.videoHeight,
              element: video,
              thumbnail,
            };
            
            // If video has audio, we'll resolve with the video asset
            // The audio asset will be created separately by the calling function
            resolve(videoAsset);
            
            // If video has audio, also create and add audio asset ONLY if it doesn't exist
            if (hasAudio) {
              // Check if corresponding audio asset already exists in the project
              const { project: currentProject } = useEditorStore.getState();
              const expectedAudioName = `${file.name} (Audio)`;
              const existingAudioAsset = currentProject.assets.find(a => 
                a.type === 'audio' && a.name === expectedAudioName
              );
              
              if (!existingAudioAsset) {
                try {
                  const audioAsset: Asset = {
                    id: uuidv4(),
                    type: 'audio',
                    src: url,
                    name: expectedAudioName,
                    duration: video.duration,
                    width: 0,
                    height: 0,
                    element: undefined,
                    waveform: await generateWaveform(url)
                  };
                  
                  const audio = document.createElement('audio');
                  audio.src = url;
                  audio.preload = 'metadata';
                  audioAsset.element = audio;
                  
                  // Add the audio asset to the project
                  const { addAsset } = useEditorStore.getState();
                  addAsset(audioAsset);
                  
                  console.log(`Created audio asset for ${file.name}: ${audioAsset.waveform?.length} samples`);
                } catch (error) {
                  console.warn('Failed to extract audio from video in createAssetFromFile:', error);
                }
              } else {
                console.log(`Audio asset already exists for ${file.name}, skipping creation`);
              }
            }
          } catch (error) {
            console.warn('Failed to generate video thumbnail:', error);
            // Still resolve with asset, just without thumbnail
            resolve({
              id: assetId || crypto.randomUUID(),
              name: file.name,
              type: 'video',
              src: url,
              duration: video.duration,
              width: video.videoWidth,
              height: video.videoHeight,
              element: video,
            });
          }
        };
        video.onerror = () => reject(new Error(`Failed to load video: ${file.name}`));
        video.src = url;
      } else if (type === 'audio') {
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        audio.crossOrigin = 'anonymous'; // Help with CORS issues
        audio.volume = 1.0; // Ensure volume is set
        audio.playbackRate = 1.0; // Ensure playback rate is normal
        
        // Add additional loading states for better debugging
        audio.onloadstart = () => console.log(`Audio loading started: ${file.name}`);
        audio.oncanplay = () => console.log(`Audio can play: ${file.name}`);
        
        audio.onloadedmetadata = async () => {
          console.log(`Audio metadata loaded: ${file.name}, duration: ${audio.duration}`);
          
          let waveformData: number[] | undefined;
          try {
            // Generate waveform data
            waveformData = await generateWaveform(url);
            console.log(`Generated waveform for ${file.name} with ${waveformData.length} samples`);
          } catch (error) {
            console.warn('Failed to generate waveform:', error);
          }
          
          // Wait for audio to be fully ready before resolving
          const waitForReady = () => {
            if (audio.readyState >= 2) { // HTMLMediaElement.HAVE_CURRENT_DATA or higher
              console.log(`Audio fully ready: ${file.name}, readyState: ${audio.readyState}`);
              resolve({
                id: assetId || crypto.randomUUID(),
                name: file.name,
                type: 'audio',
                src: url,
                duration: audio.duration,
                width: 0,
                height: 0,
                element: audio,
                waveform: waveformData,
              });
            } else {
              // Keep waiting for audio to be ready
              setTimeout(waitForReady, 50);
            }
          };
          
          // Give the audio a moment to settle, then check if ready
          setTimeout(waitForReady, 100);
        };
        
        audio.onerror = (e) => {
          console.error(`Failed to load audio: ${file.name}`, e);
          reject(new Error(`Failed to load audio: ${file.name}`));
        };
        
        audio.src = url;
      } else {
        const img = document.createElement('img');
        img.onload = async () => {
          try {
            // Generate thumbnail for image
            const thumbnail = await generateThumbnail(img, 'image');
            resolve({
              id: assetId || crypto.randomUUID(),
              name: file.name,
              type: 'image',
              src: url,
              duration: 5, // Images default to 5 seconds, but can be extended to 30 via trimming
              width: img.naturalWidth,
              height: img.naturalHeight,
              element: img,
              thumbnail,
            });
          } catch (error) {
            console.warn('Failed to generate image thumbnail:', error);
            // Still resolve with asset, just without thumbnail
            resolve({
              id: assetId || crypto.randomUUID(),
              name: file.name,
              type: 'image',
              src: url,
              duration: 5, // Images default to 5 seconds, but can be extended to 30 via trimming
              width: img.naturalWidth,
              height: img.naturalHeight,
              element: img,
            });
          }
        };
        img.onerror = () => reject(new Error(`Failed to load image: ${file.name}`));
        img.src = url;
      }
    });
  };

  const handleExport = async () => {
    setIsExporting(true);
    setExportProgress(0);

    try {
      await exportVideo();
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const exportVideo = async () => {
    // Create offscreen canvas for rendering
    const canvas = document.createElement('canvas');
    canvas.width = project.canvasWidth;
    canvas.height = project.canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');

    // Create media recorder
    const stream = canvas.captureStream(project.timeline.fps);
    
    // Setup audio context for mixing (only if there are audio clips)
    let audioContext: AudioContext | null = null;
    let destination: MediaStreamAudioDestinationNode | null = null;
    const audioSources: { element: HTMLAudioElement; source: MediaElementAudioSourceNode; clip: any; gainNode: GainNode; buffer?: AudioBuffer }[] = [];
    
    // Check if there are any audio clips
    const hasAudioClips = project.timeline.tracks.some(track => 
      track.type === 'audio' && track.clips.some(clip => 
        project.assets.find(a => a.id === clip.assetId)?.element
      )
    );
    
    if (hasAudioClips) {
      audioContext = new AudioContext();
      destination = audioContext.createMediaStreamDestination();
      // Resume audio context if it's suspended
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      // Create audio sources with scheduled playback - no frame-by-frame manipulation
      project.timeline.tracks.forEach(track => {
        if (track.type === 'audio') {
          track.clips.forEach(clip => {
            const asset = project.assets.find(a => a.id === clip.assetId);
            if (asset?.element) {
              const audioElement = asset.element as HTMLAudioElement;
              
              // Create a completely new audio element to ensure total independence
              const clonedAudio = new Audio();
              clonedAudio.src = audioElement.src;
              clonedAudio.volume = 1.0;
              clonedAudio.loop = false;
              clonedAudio.preload = 'auto';
              
              // Calculate the exact start time and source position
              const inPoint = clip.inPoint || 0;
              const outPoint = clip.outPoint || (asset.duration || clip.duration);
              
              // Don't set currentTime or playback rate here - that will be handled by frame-based seeking
              
              // Add debugging attributes for each clip instance
              clonedAudio.setAttribute('data-clip-id', clip.id);
              clonedAudio.setAttribute('data-timeline-start', clip.start.toString());
              clonedAudio.setAttribute('data-inpoint', inPoint.toString());
              clonedAudio.setAttribute('data-outpoint', outPoint.toString());
              
              const source = audioContext!.createMediaElementSource(clonedAudio);
              const gainNode = audioContext!.createGain();
              
              // Start with gain at 0 - it will be controlled by frame-based activation
              gainNode.gain.setValueAtTime(0, audioContext!.currentTime);
              
              console.log(`Setup clip ${clip.id.slice(-4)}: timeline[${clip.start}s-${(clip.start + clip.duration).toFixed(1)}s] source[${inPoint.toFixed(1)}s-${outPoint.toFixed(1)}s]`);
              
              source.connect(gainNode);
              gainNode.connect(destination!);
              
              // Store for cleanup later
              audioSources.push({ 
                element: clonedAudio, 
                source, 
                clip, 
                gainNode 
              });
            }
          });
        }
      });
      
            // DON'T start audio elements immediately - they will be started when recording begins
      // This prevents interference with preview audio

      // Combine video and audio streams
      const audioTracks = destination.stream.getAudioTracks();
      audioTracks.forEach(track => stream.addTrack(track));
    }

    // Try MP4 with appropriate codecs (with/without audio)
    let mimeType = 'video/mp4';
    let fileExtension = 'mp4';
    
    if (hasAudioClips) {
      // Test different MP4 audio codec combinations
      if (MediaRecorder.isTypeSupported('video/mp4;codecs=h264,aac')) {
        mimeType = 'video/mp4;codecs=h264,aac';
      } else if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')) {
        mimeType = 'video/mp4;codecs=avc1,mp4a.40.2'; // H.264 + AAC
      } else if (MediaRecorder.isTypeSupported('video/mp4')) {
        mimeType = 'video/mp4';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
        mimeType = 'video/webm;codecs=vp9,opus';
        fileExtension = 'webm';
      } else if (MediaRecorder.isTypeSupported('video/webm')) {
        mimeType = 'video/webm';
        fileExtension = 'webm';
      } else {
        throw new Error('No supported video format found');
      }
    } else {
      // No audio clips, try video-only codecs
      if (MediaRecorder.isTypeSupported('video/mp4;codecs=h264')) {
        mimeType = 'video/mp4;codecs=h264';
      } else if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')) {
        mimeType = 'video/mp4;codecs=avc1';
      } else if (MediaRecorder.isTypeSupported('video/mp4')) {
        mimeType = 'video/mp4';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
        mimeType = 'video/webm;codecs=vp9';
        fileExtension = 'webm';
      } else if (MediaRecorder.isTypeSupported('video/webm')) {
        mimeType = 'video/webm';
        fileExtension = 'webm';
      } else {
        throw new Error('No supported video format found');
      }
    }

    // Configure quality settings based on user selection
    const getQualityConfig = (quality: typeof videoQuality) => {
      const baseConfig = { mimeType } as any;
      
      switch (quality) {
        case 'low':
          baseConfig.videoBitsPerSecond = 1000000; // 1 Mbps
          if (hasAudioClips) baseConfig.audioBitsPerSecond = 64000; // 64 kbps
          break;
        case 'medium':
          baseConfig.videoBitsPerSecond = 3000000; // 3 Mbps
          if (hasAudioClips) baseConfig.audioBitsPerSecond = 128000; // 128 kbps
          break;
        case 'high':
          baseConfig.videoBitsPerSecond = 8000000; // 8 Mbps
          if (hasAudioClips) baseConfig.audioBitsPerSecond = 192000; // 192 kbps
          break;
        case 'ultra':
          baseConfig.videoBitsPerSecond = 20000000; // 20 Mbps
          if (hasAudioClips) baseConfig.audioBitsPerSecond = 320000; // 320 kbps
          break;
        default:
          baseConfig.videoBitsPerSecond = 3000000; // Default to medium
          if (hasAudioClips) baseConfig.audioBitsPerSecond = 128000;
      }
      
      return baseConfig;
    };

    const recordingConfig = getQualityConfig(videoQuality);
    console.log(`Exporting with format: ${mimeType}, quality: ${videoQuality}, video bitrate: ${recordingConfig.videoBitsPerSecond}${recordingConfig.audioBitsPerSecond ? `, audio bitrate: ${recordingConfig.audioBitsPerSecond}` : ''}`);
    const mediaRecorder = new MediaRecorder(stream, recordingConfig);

    const chunks: Blob[] = [];
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    // Render frames with proper timing
    const fps = project.timeline.fps;
    const frameDuration = 1000 / fps; // milliseconds per frame
    const totalFrames = Math.ceil(project.timeline.duration * fps);
    let currentFrame = 0;
    
    // Use precise timing with requestAnimationFrame for better accuracy
    const startTime = performance.now();
    console.log(`Starting export: ${totalFrames} frames at ${fps}fps for ${project.timeline.duration}s duration`);

    return new Promise<void>((resolve, reject) => {
      // Pre-calculate all frame data to avoid timing issues during recording
      const allFrameData: Array<{
        time: number;
        clipsToRender: Array<{
          clip: any;
          asset: Asset;
          relativeTime: number;
        }>;
        videosToSync: Array<{
          video: HTMLVideoElement;
          targetTime: number;
        }>;
      }> = [];

      // Pre-calculate all frames
      for (let frame = 0; frame < totalFrames; frame++) {
        const currentTime = frame / fps;
        const clipsToRender: any[] = [];
        const videosToSync: any[] = [];

        // Process tracks in reverse order (like canvas rendering)
        const tracksToRender = [...project.timeline.tracks].reverse();
        tracksToRender.forEach(track => {
          if (!track.visible) return;

          track.clips.forEach(clip => {
            const clipEndTime = clip.start + getEffectiveDuration(clip);
            if (currentTime >= clip.start && currentTime <= clipEndTime) {
              const asset = project.assets.find(a => a.id === clip.assetId);
              if (asset?.element) {
                const relativeTime = currentTime - clip.start;
                
                if (asset.type === 'video') {
                  const video = asset.element as HTMLVideoElement;
                  const inPoint = clip.inPoint || 0;
                  const outPoint = clip.outPoint || (asset.duration || clip.duration);
                  
                  // Calculate target time based on whether clip is reversed and playback speed
                  let targetTime;
                  const playbackSpeed = clip.playbackSpeed || 1;
                  
                  if (clip.reversed) {
                    // For reversed clips, map timeline position to reversed source time
                    const clipProgress = relativeTime / getEffectiveDuration(clip); // 0 to 1
                    const reversedProgress = 1 - clipProgress; // 1 to 0
                    targetTime = inPoint + (reversedProgress * (outPoint - inPoint));
                  } else {
                    // Account for playback speed when calculating target time
                    const adjustedRelativeTime = relativeTime * playbackSpeed;
                    targetTime = adjustedRelativeTime + inPoint;
                  }
                  
                  videosToSync.push({ video, targetTime });
                  clipsToRender.push({ clip, asset, relativeTime });
                } else if (asset.type === 'image') {
                  clipsToRender.push({ clip, asset, relativeTime });
                }
                // Audio sync will be handled in the frame rendering loop
              }
            }
          });
        });

        allFrameData.push({
          time: currentTime,
          clipsToRender,
          videosToSync
        });
      }

      // Track which clips have been activated to avoid duplicate seeks (moved outside renderFrame)
      const activatedClips = new Set<string>();
      // Track which clips are currently active
      const activeClips = new Set<string>();
      
      const renderFrame = () => {
        if (currentFrame >= totalFrames) {
          console.log(`Export complete: ${currentFrame} frames rendered in ${((performance.now() - startTime) / 1000).toFixed(2)}s`);
          mediaRecorder.stop();
          return;
        }

        // Start recording and audio on first frame for precise timing
        if (currentFrame === 0) {
          mediaRecorder.start();
          
          if (audioSources.length > 0) {
            console.log(`Starting ${audioSources.length} audio clips with Web Audio scheduling...`);
            audioSources.forEach(({ element, clip }) => {
              element.play().catch(e => console.log(`Audio play failed for clip ${clip.id}:`, e));
            });
          }
        }

        const frameData = allFrameData[currentFrame];
        
        // Unified sync - control both seeking and gain for precise timing with volume keyframes
        const syncAudioAtActivation = () => {
          const currentTime = currentFrame / fps;
          
          audioSources.forEach(({ element, clip, gainNode }) => {
            const clipStart = clip.start;
            const clipEnd = clip.start + getEffectiveDuration(clip);
            const isActive = currentTime >= clipStart && currentTime <= clipEnd;
            const wasActive = activeClips.has(clip.id);
            const wasActivated = activatedClips.has(clip.id);
            
            if (isActive && !wasActivated) {
              // Clip is becoming active for the first time - seek and enable audio
              const asset = project.assets.find(a => a.id === clip.assetId);
              if (asset) {
                const inPoint = clip.inPoint || 0;
                const outPoint = clip.outPoint || (asset.duration || clip.duration);
                
                try {
                  const audioSpeed = clip.playbackSpeed || 1;
                  
                  if (!clip.reversed) {
                    element.currentTime = inPoint;
                    element.playbackRate = audioSpeed;
                  } else {
                    element.currentTime = outPoint;
                    element.playbackRate = -audioSpeed; // Negative speed for reversed playback
                  }
                  
                  // Calculate volume based on keyframes for this time
                  const relativeTime = currentTime - clipStart;
                  const volume = calculateAudioVolumeAtTime(clip, relativeTime);
                  gainNode.gain.setValueAtTime(volume, audioContext!.currentTime);
                  
                  activatedClips.add(clip.id);
                  activeClips.add(clip.id);
                  console.log(`Activated clip ${clip.id.slice(-4)} at timeline ${currentTime.toFixed(2)}s, seeking to source ${element.currentTime.toFixed(2)}s, volume: ${volume.toFixed(2)}`);
                } catch (e) {
                  console.log(`Failed to seek clip ${clip.id} on activation:`, e);
                }
              }
            } else if (isActive && !wasActive) {
              // Clip is becoming active again - apply current volume based on keyframes
              const relativeTime = currentTime - clipStart;
              const volume = calculateAudioVolumeAtTime(clip, relativeTime);
              gainNode.gain.setValueAtTime(volume, audioContext!.currentTime);
              activeClips.add(clip.id);
              console.log(`Re-activated clip ${clip.id.slice(-4)} at timeline ${currentTime.toFixed(2)}s, volume: ${volume.toFixed(2)}`);
            } else if (isActive && wasActive) {
              // Clip is active and was active - update volume based on keyframes for smooth animation
              const relativeTime = currentTime - clipStart;
              const volume = calculateAudioVolumeAtTime(clip, relativeTime);
              gainNode.gain.setValueAtTime(volume, audioContext!.currentTime);
            } else if (!isActive && wasActive) {
              // Clip is becoming inactive - disable audio immediately
              gainNode.gain.setValueAtTime(0, audioContext!.currentTime);
              activeClips.delete(clip.id);
              console.log(`Deactivated clip ${clip.id.slice(-4)} at timeline ${currentTime.toFixed(2)}s`);
            }
          });
        };
        
        // Sync videos for this frame
        const syncVideoFrame = () => {
          let videosReady = 0;
          const totalVideos = frameData.videosToSync.length;

          if (totalVideos === 0) {
            // No videos to sync, render immediately
            renderFrameContent();
            return;
          }

          const checkVideosReady = () => {
            videosReady++;
            if (videosReady >= totalVideos) {
              // All videos are ready, render the frame
              renderFrameContent();
            }
          };

          // Sync all videos for this frame
          frameData.videosToSync.forEach(({ video, targetTime }) => {
            const frameTolerance = 1 / fps; // One frame tolerance (0.033s for 30fps)
            if (Math.abs(video.currentTime - targetTime) > frameTolerance) {
              const handleSeeked = () => {
                video.removeEventListener('seeked', handleSeeked);
                checkVideosReady();
              };
              video.addEventListener('seeked', handleSeeked);
              video.currentTime = targetTime;
            } else {
              checkVideosReady();
            }
          });
        };

        const renderFrameContent = () => {
          // Clear canvas
          ctx.fillStyle = project.backgroundColor;
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Minimal audio sync - only seek when clips become active
          syncAudioAtActivation();

          // Render all clips for this frame
          frameData.clipsToRender.forEach(({ clip, asset, relativeTime }) => {
            if (asset.type === 'video' || asset.type === 'image') {
              renderClipToCanvas(ctx, clip, asset, relativeTime, canvas.width, canvas.height);
            }
          });

          // Update progress
          setExportProgress((currentFrame / totalFrames) * 100);
          
          currentFrame++;
          
          // Schedule next frame with precise timing
          const expectedTime = startTime + (currentFrame * frameDuration);
          const currentTime = performance.now();
          const delay = Math.max(0, expectedTime - currentTime);
          
          setTimeout(renderFrame, delay);
        };

        // Start video sync for this frame
        syncVideoFrame();
      };

      mediaRecorder.onstop = () => {
        // Thoroughly clean up all export audio sources
        audioSources.forEach(({ element, source, gainNode }) => {
          // Stop and reset audio element
          element.pause();
          element.currentTime = 0;
          element.playbackRate = 1; // Reset playback rate
          
          // Disconnect Web Audio nodes
          try {
            source.disconnect();
            gainNode.disconnect();
          } catch (e) {
            console.log('Error disconnecting audio nodes:', e);
          }
          
          // Remove the cloned element from memory
          element.remove();
        });
        
        // Clear the audioSources array
        audioSources.length = 0;
        
        // Close audio context if it was created
        if (audioContext) {
          audioContext.close().catch(e => console.log('Error closing audio context:', e));
        }
        
        const blob = new Blob(chunks, { type: mimeType });
        const actualDuration = blob.size > 0 ? 'exported' : 'empty';
        console.log(`Export finished: ${actualDuration} blob, expected ${project.timeline.duration}s`);
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.name}.${fileExtension}`;
        a.click();
        URL.revokeObjectURL(url);
        resolve();
      };

      mediaRecorder.onerror = (error) => {
        // Clean up audio sources on error too
        audioSources.forEach(({ element, source, gainNode }) => {
          element.pause();
          element.currentTime = 0;
          element.playbackRate = 1;
          try {
            source.disconnect();
            gainNode.disconnect();
          } catch (e) {
            console.log('Error disconnecting audio nodes during cleanup:', e);
          }
          element.remove();
        });
        audioSources.length = 0;
        
        if (audioContext) {
          audioContext.close().catch(e => console.log('Error closing audio context:', e));
        }
        
        reject(error);
      };

      // Start rendering immediately for precise timing
      renderFrame();
    });
  };

  // Helper function to calculate audio volume at a specific time using keyframes
  const calculateAudioVolumeAtTime = (clip: any, relativeTime: number): number => {
    if (!clip.audioKeyframes?.volume || clip.audioKeyframes.volume.length === 0) {
      return 1.0; // Default volume
    }

    const keyframes = clip.audioKeyframes.volume;
    const sortedKeyframes = [...keyframes].sort((a, b) => a.time - b.time);

    // If time is before first keyframe, return first keyframe value
    if (relativeTime <= sortedKeyframes[0].time) {
      return sortedKeyframes[0].value;
    }

    // If time is after last keyframe, return last keyframe value
    if (relativeTime >= sortedKeyframes[sortedKeyframes.length - 1].time) {
      return sortedKeyframes[sortedKeyframes.length - 1].value;
    }

    // Find surrounding keyframes for interpolation
    for (let i = 0; i < sortedKeyframes.length - 1; i++) {
      if (relativeTime >= sortedKeyframes[i].time && relativeTime <= sortedKeyframes[i + 1].time) {
        const prevKeyframe = sortedKeyframes[i];
        const nextKeyframe = sortedKeyframes[i + 1];
        
        // Interpolate with easing
        const t = (relativeTime - prevKeyframe.time) / (nextKeyframe.time - prevKeyframe.time);
        const easing = nextKeyframe.easing || 'linear';
        return interpolateWithEasing(prevKeyframe.value, nextKeyframe.value, t, easing);
      }
    }

    return 1.0; // Fallback
  };

  const renderClipToCanvas = (
    ctx: CanvasRenderingContext2D,
    clip: any,
    asset: Asset,
    relativeTime: number,
    canvasWidth: number,
    canvasHeight: number
  ) => {
    ctx.save();

    // Calculate transform using keyframes
    const transform = getClipTransform(clip.id, relativeTime) || {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    };

    // Apply opacity
    ctx.globalAlpha = transform.opacity;

    // Apply transforms: translate to center, then apply position, rotation, and scale
    ctx.translate(canvasWidth / 2, canvasHeight / 2);
    ctx.translate(transform.x, transform.y);
    ctx.rotate(transform.rotation * Math.PI / 180);
    ctx.scale(transform.scaleX, transform.scaleY);

    try {
      if (asset.type === 'video') {
        const video = asset.element as HTMLVideoElement;
        // Video synchronization is already handled in the main render loop
        ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2);
      } else if (asset.type === 'image') {
        const img = asset.element as HTMLImageElement;
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      }
    } catch (error) {
      console.warn('Failed to render clip to canvas during export:', error);
    }

    ctx.restore();
  };

  const handleDimensionChange = (width: number, height: number) => {
    setProject({
      ...project,
      canvasWidth: width,
      canvasHeight: height,
    });
  };

  const handleDurationChange = (duration: number) => {
    setProject({
      ...project,
      timeline: {
        ...project.timeline,
        duration: duration,
      },
    });
  };

  const handleAdoptDimensions = () => {
    // Find the first selected clip with valid dimensions
    let selectedAsset = null;
    
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (selectedClipIds.includes(clip.id)) {
          const asset = project.assets.find(a => a.id === clip.assetId);
          if (asset && asset.width && asset.height && (asset.type === 'video' || asset.type === 'image')) {
            selectedAsset = asset;
            break;
          }
        }
      }
      if (selectedAsset) break;
    }
    
    if (selectedAsset) {
      handleDimensionChange(selectedAsset.width!, selectedAsset.height!);
    }
  };

  const getSelectedMediaWithDimensions = () => {
    // Find the first selected clip with valid dimensions
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (selectedClipIds.includes(clip.id)) {
          const asset = project.assets.find(a => a.id === clip.assetId);
          if (asset && asset.width && asset.height && (asset.type === 'video' || asset.type === 'image')) {
            return asset;
          }
        }
      }
    }
    return null;
  };

  return (
    <div className="toolbar">
      <button onClick={handleImportClick}>Import</button>
      
      <button 
        onClick={undo}
        disabled={!canUndo()}
        style={{ 
          opacity: canUndo() ? 1 : 0.5,
          cursor: canUndo() ? 'pointer' : 'not-allowed'
        }}
        title="Undo (Ctrl+Z)"
      >
        ↶ Undo
      </button>
      
      <button 
        onClick={redo}
        disabled={!canRedo()}
        style={{ 
          opacity: canRedo() ? 1 : 0.5,
          cursor: canRedo() ? 'pointer' : 'not-allowed'
        }}
        title="Redo (Ctrl+Y)"
      >
        ↷ Redo
      </button>
      
      <button onClick={() => setShowSettings(!showSettings)}>Settings</button>
      <button 
        onClick={handleExport} 
        disabled={isExporting}
        style={{ 
          backgroundColor: isExporting ? '#666' : '#ff4444',
          color: 'white'
        }}
      >
        {isExporting ? `Exporting... ${exportProgress.toFixed(0)}%` : `Export MP4 (${videoQuality.charAt(0).toUpperCase() + videoQuality.slice(1)})`}
      </button>
      
      <button 
        onClick={() => {
          const { setShowPNGViewer } = useEditorStore.getState();
          setShowPNGViewer(true);
        }}
        style={{ 
          backgroundColor: '#4a90e2',
          color: 'white'
        }}
        title="PNG Flipbook Viewer - Load and view PNG sequences"
      >
        🎞️ PNG Flipbook
      </button>
      
      {showSettings && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: '0',
          background: '#2a2a2a',
          border: '1px solid #555',
          padding: '15px',
          borderRadius: '4px',
          zIndex: 1000,
          minWidth: '250px'
        }}>
          <h4 style={{ marginBottom: '10px' }}>Project Settings</h4>
          
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px' }}>
              Dimensions:
            </label>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="number"
                value={project.canvasWidth}
                onChange={(e) => handleDimensionChange(parseInt(e.target.value) || 1920, project.canvasHeight)}
                style={{ width: '80px', padding: '4px', background: '#3a3a3a', border: '1px solid #555', color: 'white' }}
              />
              <span>×</span>
              <input
                type="number"
                value={project.canvasHeight}
                onChange={(e) => handleDimensionChange(project.canvasWidth, parseInt(e.target.value) || 1080)}
                style={{ width: '80px', padding: '4px', background: '#3a3a3a', border: '1px solid #555', color: 'white' }}
              />
              <button
                onClick={handleAdoptDimensions}
                disabled={!getSelectedMediaWithDimensions()}
                style={{
                  padding: '4px 8px',
                  fontSize: '10px',
                  background: getSelectedMediaWithDimensions() ? '#4a90e2' : '#666',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: getSelectedMediaWithDimensions() ? 'pointer' : 'not-allowed',
                  opacity: getSelectedMediaWithDimensions() ? 1 : 0.6,
                }}
                title={getSelectedMediaWithDimensions() 
                  ? `Adopt dimensions from ${getSelectedMediaWithDimensions()?.name} (${getSelectedMediaWithDimensions()?.width}×${getSelectedMediaWithDimensions()?.height})`
                  : 'Select a video or image clip to adopt its dimensions'
                }
              >
                📐
              </button>
            </div>
            <div style={{ fontSize: '10px', color: '#aaa', marginTop: '5px' }}>
              Common: 1920×1080 (HD), 1280×720 (720p), 640×360 (360p)
            </div>
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px' }}>
              Duration (seconds):
            </label>
            <input
              type="number"
              min="1"
              max="3600"
              value={project.timeline.duration}
              onChange={(e) => handleDurationChange(parseFloat(e.target.value) || 30)}
              style={{ width: '80px', padding: '4px', background: '#3a3a3a', border: '1px solid #555', color: 'white' }}
            />
            <div style={{ fontSize: '10px', color: '#aaa', marginTop: '5px' }}>
              Timeline length (1-3600 seconds)
            </div>
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px' }}>
              Frame Rate (FPS):
            </label>
            <input
              type="number"
              min="1"
              max="240"
              value={project.timeline.fps}
              onChange={(e) => {
                const fps = parseInt(e.target.value) || 30;
                if (fps >= 1 && fps <= 240) {
                  setFPS(fps);
                }
              }}
              style={{ 
                width: '100px', 
                padding: '4px', 
                background: '#3a3a3a', 
                border: '1px solid #555', 
                color: 'white',
                borderRadius: '3px',
                textAlign: 'center'
              }}
            />
                         <div style={{ fontSize: '10px', color: '#aaa', marginTop: '5px' }}>
               Frame duration: {(1000/project.timeline.fps).toFixed(1)}ms<br/>
               Common: 24 (cinema), 30 (NTSC), 60 (smooth)
             </div>
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px' }}>
              Project Name:
            </label>
            <input
              type="text"
              value={project.name}
              onChange={(e) => setProject({ ...project, name: e.target.value })}
              style={{ width: '100%', padding: '4px', background: '#3a3a3a', border: '1px solid #555', color: 'white' }}
            />
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px' }}>
              Export Quality:
            </label>
            <select
              value={videoQuality}
              onChange={(e) => setVideoQuality(e.target.value as 'low' | 'medium' | 'high' | 'ultra')}
              style={{ 
                width: '100%', 
                padding: '4px', 
                background: '#3a3a3a', 
                border: '1px solid #555', 
                color: 'white',
                borderRadius: '3px'
              }}
            >
              <option value="low">Low (1 Mbps - Fast, smaller files)</option>
              <option value="medium">Medium (3 Mbps - Balanced quality)</option>
              <option value="high">High (8 Mbps - Better quality)</option>
              <option value="ultra">Ultra (20 Mbps - Best quality, larger files)</option>
            </select>
            <div style={{ fontSize: '10px', color: '#aaa', marginTop: '4px' }}>
              Higher quality = better video but larger file size
            </div>
          </div>

          <div style={{ marginBottom: '10px', padding: '10px', background: '#1a1a1a', borderRadius: '4px' }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '5px' }}>Export Format:</div>
            <div style={{ fontSize: '11px', color: '#aaa' }}>
              • Video: MP4 (H.264)<br/>
              • Audio: AAC (industry standard)<br/>
              • Quality: {videoQuality.charAt(0).toUpperCase() + videoQuality.slice(1)} setting
            </div>
          </div>

          <button 
            onClick={() => setShowSettings(false)}
            style={{ marginTop: '10px' }}
          >
            Close
          </button>
        </div>
      )}
      
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*,image/*"
        multiple
        onChange={handleFileImport}
        className="file-input"
      />
    </div>
  );
};

export default Toolbar; 