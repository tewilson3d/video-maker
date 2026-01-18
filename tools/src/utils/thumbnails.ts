export const generateThumbnail = (
  element: HTMLVideoElement | HTMLImageElement,
  type: 'video' | 'image'
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      reject(new Error('Could not get canvas context'));
      return;
    }

    // Set thumbnail size (maintain aspect ratio)
    const maxSize = 80;
    let width, height;

    if (type === 'video') {
      const video = element as HTMLVideoElement;
      const aspectRatio = video.videoWidth / video.videoHeight;
      
      if (video.videoWidth > video.videoHeight) {
        width = maxSize;
        height = maxSize / aspectRatio;
      } else {
        height = maxSize;
        width = maxSize * aspectRatio;
      }
    } else {
      const img = element as HTMLImageElement;
      const aspectRatio = img.naturalWidth / img.naturalHeight;
      
      if (img.naturalWidth > img.naturalHeight) {
        width = maxSize;
        height = maxSize / aspectRatio;
      } else {
        height = maxSize;
        width = maxSize * aspectRatio;
      }
    }

    canvas.width = width;
    canvas.height = height;

    try {
      if (type === 'video') {
        const video = element as HTMLVideoElement;
        // Seek to 1 second or 10% of duration, whichever is smaller
        const seekTime = Math.min(1, video.duration * 0.1);
        
        const handleSeeked = () => {
          try {
            ctx.drawImage(video, 0, 0, width, height);
            const dataURL = canvas.toDataURL('image/jpeg', 0.8);
            video.removeEventListener('seeked', handleSeeked);
            video.removeEventListener('error', handleError);
            resolve(dataURL);
          } catch (error) {
            video.removeEventListener('seeked', handleSeeked);
            video.removeEventListener('error', handleError);
            reject(error);
          }
        };
        
        const handleError = () => {
          video.removeEventListener('seeked', handleSeeked);
          video.removeEventListener('error', handleError);
          reject(new Error('Video seek failed'));
        };
        
        video.addEventListener('seeked', handleSeeked);
        video.addEventListener('error', handleError);
        video.currentTime = seekTime;
      } else {
        const img = element as HTMLImageElement;
        ctx.drawImage(img, 0, 0, width, height);
        const dataURL = canvas.toDataURL('image/jpeg', 0.8);
        resolve(dataURL);
      }
    } catch (error) {
      reject(error);
    }
  });
}; 