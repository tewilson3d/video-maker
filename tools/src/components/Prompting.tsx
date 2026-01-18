import React, { useState } from 'react';

interface Character {
  index: number;
  description: string;
  imageUrl?: string;
}

interface Keyframe {
  index: number;
  description: string;
}

interface PromptingProps {
  onGenerateStoryboard: (data: {
    storyPrompt: string;
    characters: Character[];
    keyframes: Keyframe[];
  }) => void;
}

const Prompting: React.FC<PromptingProps> = ({ onGenerateStoryboard }) => {
  const [storyPrompt, setStoryPrompt] = useState('');
  const [characters, setCharacters] = useState<Character[]>([{ index: 1, description: '' }]);
  const [shotSequence, setShotSequence] = useState('');
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [showKeyframes, setShowKeyframes] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const addCharacter = () => {
    setCharacters([...characters, { index: characters.length + 1, description: '' }]);
  };

  const removeCharacter = (index: number) => {
    if (characters.length > 1) {
      const updated = characters.filter((_, i) => i !== index);
      setCharacters(updated.map((c, i) => ({ ...c, index: i + 1 })));
    }
  };

  const updateCharacter = (index: number, description: string) => {
    const updated = [...characters];
    updated[index].description = description;
    setCharacters(updated);
  };

  const parseShots = () => {
    const lines = shotSequence.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map((line, i) => ({
        index: i + 1,
        description: line.replace(/^[\d]+[.)\-:]?\s*|^[-*•]\s*/g, '').trim()
      }));
    setKeyframes(lines);
    setShowKeyframes(true);
  };

  const addKeyframe = () => {
    setKeyframes([...keyframes, { index: keyframes.length + 1, description: '' }]);
  };

  const removeKeyframe = (index: number) => {
    if (keyframes.length > 1) {
      const updated = keyframes.filter((_, i) => i !== index);
      setKeyframes(updated.map((k, i) => ({ ...k, index: i + 1 })));
    }
  };

  const updateKeyframe = (index: number, description: string) => {
    const updated = [...keyframes];
    updated[index].description = description;
    setKeyframes(updated);
  };

  const handleGenerate = async () => {
    if (!storyPrompt.trim()) {
      alert('Please enter a story prompt');
      return;
    }
    if (keyframes.length === 0) {
      alert('Please add at least one keyframe');
      return;
    }

    setIsGenerating(true);
    try {
      await onGenerateStoryboard({
        storyPrompt,
        characters: characters.filter(c => c.description.trim()),
        keyframes: keyframes.filter(k => k.description.trim())
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="prompting-container">
      <div className="prompting-grid">
        {/* Left Column */}
        <div className="prompting-column">
          {/* Story Prompt */}
          <div className="prompt-section">
            <h3>📝 Story Prompt</h3>
            <textarea
              value={storyPrompt}
              onChange={(e) => setStoryPrompt(e.target.value)}
              placeholder="Describe your story... e.g., 'A brave knight discovers a hidden dragon's lair in the mountains and must decide whether to fight or befriend the ancient creature.'"
              rows={6}
            />
            <span className="hint">Include setting, mood, conflict, and key events.</span>
          </div>

          {/* Characters */}
          <div className="prompt-section">
            <h3>👤 Characters</h3>
            <div className="character-list">
              {characters.map((char, i) => (
                <div key={i} className="character-card">
                  <div className="character-header">
                    <span>Character {char.index}</span>
                    {characters.length > 1 && (
                      <button onClick={() => removeCharacter(i)} className="btn-remove">✕</button>
                    )}
                  </div>
                  <textarea
                    value={char.description}
                    onChange={(e) => updateCharacter(i, e.target.value)}
                    placeholder="e.g., 'Elena - A fierce warrior with long silver hair...'"
                    rows={3}
                  />
                </div>
              ))}
            </div>
            <button onClick={addCharacter} className="btn-add">+ Add Character</button>
          </div>
        </div>

        {/* Right Column */}
        <div className="prompting-column">
          {/* Shot Sequence / Keyframes */}
          <div className="prompt-section">
            <h3>🎬 Storyboard Keyframes</h3>
            
            {!showKeyframes ? (
              <div className="shot-sequence-input">
                <textarea
                  value={shotSequence}
                  onChange={(e) => setShotSequence(e.target.value)}
                  placeholder={`Enter your shot sequence, one per line:

1. Wide shot of the castle at dawn
2. Close-up of the knight's face
3. The knight draws his sword
4. Dragon emerges from cave
5. Epic confrontation`}
                  rows={10}
                />
                <button onClick={parseShots} className="btn-parse">🎬 Break Into Keyframes</button>
              </div>
            ) : (
              <div className="keyframe-list">
                {keyframes.map((kf, i) => (
                  <div key={i} className="keyframe-card">
                    <div className="keyframe-header">
                      <span>Scene {kf.index}</span>
                      {keyframes.length > 1 && (
                        <button onClick={() => removeKeyframe(i)} className="btn-remove">✕</button>
                      )}
                    </div>
                    <textarea
                      value={kf.description}
                      onChange={(e) => updateKeyframe(i, e.target.value)}
                      placeholder="Describe this scene..."
                      rows={2}
                    />
                  </div>
                ))}
                <div className="keyframe-actions">
                  <button onClick={addKeyframe} className="btn-add">+ Add Keyframe</button>
                  <button onClick={() => setShowKeyframes(false)} className="btn-reset">↺ Reset</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Generate Button */}
      <div className="generate-section">
        <button 
          onClick={handleGenerate} 
          className="btn-generate"
          disabled={isGenerating}
        >
          {isGenerating ? 'Generating...' : '🎬 Generate Storyboard'}
        </button>
      </div>
    </div>
  );
};

export default Prompting;
