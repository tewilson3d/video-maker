export const generateWaveform = async (audioSrc: string, samples: number = 2400): Promise<number[]> => {
  try {
    // Create audio context
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Fetch and decode audio data
    const response = await fetch(audioSrc);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // Get audio data from first channel
    const channelData = audioBuffer.getChannelData(0);
    const samplesPerBucket = Math.floor(channelData.length / samples);
    const waveform: number[] = [];
    
    // Process audio data into waveform buckets
    for (let i = 0; i < samples; i++) {
      const start = i * samplesPerBucket;
      const end = start + samplesPerBucket;
      
      let sum = 0;
      let max = 0;
      
      // Calculate RMS (root mean square) for better waveform representation
      for (let j = start; j < end && j < channelData.length; j++) {
        const sample = Math.abs(channelData[j]);
        sum += sample * sample;
        max = Math.max(max, sample);
      }
      
      // Use RMS value, normalized to 0-1 range
      const rms = Math.sqrt(sum / samplesPerBucket);
      waveform.push(rms);
    }
    
    // Normalize waveform to 0-1 range
    const maxValue = Math.max(...waveform);
    if (maxValue > 0) {
      return waveform.map(value => value / maxValue);
    }
    
    return waveform;
  } catch (error) {
    console.error('Error generating waveform:', error);
    return new Array(samples).fill(0);
  }
};

export const renderWaveform = (
  canvas: HTMLCanvasElement,
  waveform: number[],
  startSample: number,
  endSample: number,
  width: number,
  height: number,
  color: string = '#00ff88'
) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  // Set canvas size with proper pixel ratio
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  
  // Scale context for high DPI
  ctx.scale(pixelRatio, pixelRatio);
  
  // Clear canvas
  ctx.clearRect(0, 0, width, height);
  
  // Calculate which portion of waveform to show
  const visibleWaveform = waveform.slice(
    Math.floor(startSample),
    Math.ceil(endSample)
  );
  
  if (visibleWaveform.length === 0) return;
  
  // Set drawing style
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.7;
  
  // Calculate optimal bar density based on available width
  const maxBars = Math.min(visibleWaveform.length, width * 4); // Maximum 4 bars per pixel for more detail
  const samplesPerBar = visibleWaveform.length / maxBars;
  const barWidth = width / maxBars;
  const centerY = height / 2;
  
  // Draw waveform bars with proper spacing
  for (let i = 0; i < maxBars; i++) {
    const sampleStart = Math.floor(i * samplesPerBar);
    const sampleEnd = Math.floor((i + 1) * samplesPerBar);
    
    // Calculate average amplitude for this bar
    let maxAmplitude = 0;
    for (let j = sampleStart; j < sampleEnd && j < visibleWaveform.length; j++) {
      maxAmplitude = Math.max(maxAmplitude, visibleWaveform[j]);
    }
    
    const barHeight = maxAmplitude * height * 0.8; // Use 80% of height
    const x = i * barWidth;
    const y = centerY - barHeight / 2;
    
    // Ensure minimum bar width and add small gap for clarity
    const actualBarWidth = Math.max(0.5, barWidth - 0.25);
    
    ctx.fillRect(x, y, actualBarWidth, barHeight);
  }
}; 