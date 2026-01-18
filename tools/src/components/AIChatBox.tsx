import React, { useState, useRef, useEffect } from 'react';
import { interpretVideoEditCommand, isAIAvailable } from '../ai/aiInterpreter';
import { useEditorStore } from '../store';

// Add speech recognition types
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface AIChatBoxProps {
  onProjectUpdate: (newProject: any) => void;
}

const AIChatBox: React.FC<AIChatBoxProps> = ({ onProjectUpdate }) => {
  const { project } = useEditorStore();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState<Array<{ text: string; type: 'user' | 'ai' | 'error' }>>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Initialize speech recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  // Auto-scroll messages to bottom
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);

    // Add user message to chat
    setMessages(prev => [...prev, { text: userMessage, type: 'user' }]);

    try {
            // Add timeout for better UX
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out after 120 seconds')), 120000)
      );
      
      // Send command to AI with timeout
      const result = await Promise.race([
        interpretVideoEditCommand(userMessage, project),
        timeoutPromise
      ]) as any;
      
      if (result) {
        // Update project with AI response
        onProjectUpdate(result);
        setMessages(prev => [...prev, { text: 'Project updated successfully!', type: 'ai' }]);
      } else {
        setMessages(prev => [...prev, { text: 'Sorry, I couldn\'t process that request. Please check the console for errors and try rephrasing.', type: 'error' }]);
      }
    } catch (error) {
      console.error('AI command error:', error);
      
      let errorMessage = 'An error occurred while processing your request.';
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          errorMessage = 'Request timed out. The AI might be overloaded - please try again.';
        } else if (error.message.includes('API key')) {
          errorMessage = 'API key issue. Please check your OpenAI API key.';
        } else if (error.message.includes('quota') || error.message.includes('limit')) {
          errorMessage = 'API quota exceeded. Please check your OpenAI usage limits.';
        }
      }
      
      setMessages(prev => [...prev, { text: errorMessage, type: 'error' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const startListening = () => {
    if (recognitionRef.current && !isListening) {
      setIsListening(true);
      recognitionRef.current.start();
    }
  };

  const stopListening = () => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  if (!isAIAvailable()) {
    return (
      <div style={{
        position: 'absolute',
        bottom: '10px',
        left: '10px',
        right: '10px',
        backgroundColor: '#2a2a2a',
        border: '1px solid #555',
        borderRadius: '8px',
        padding: '10px',
        color: '#aaa',
        fontSize: '12px',
        textAlign: 'center'
      }}>
        AI Assistant unavailable - Add your OpenAI API key to src/ai/aiInterpreter.ts
      </div>
    );
  }

  // Minimized to icon only
  if (isMinimized) {
    return (
      <div 
        style={{
          position: 'absolute',
          bottom: '10px',
          right: '10px',
          backgroundColor: '#2a2a2a',
          border: '1px solid #555',
          borderRadius: '8px',
          width: '48px',
          height: '48px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 1000,
          transition: 'all 0.3s ease'
        }}
        onClick={() => setIsMinimized(false)}
        title="Open AI Assistant"
      >
        <span style={{ fontSize: '20px' }}>🤖</span>
        {isLoading && (
          <div style={{
            position: 'absolute',
            top: '2px',
            right: '2px',
            width: '8px',
            height: '8px',
            backgroundColor: '#4a90e2',
            borderRadius: '50%',
            animation: 'pulse 1s infinite'
          }} />
        )}
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute',
      bottom: '10px',
      left: '10px',
      right: '10px',
      backgroundColor: '#2a2a2a',
      border: '1px solid #555',
      borderRadius: '8px',
      maxHeight: isExpanded ? '300px' : '50px',
      transition: 'max-height 0.3s ease',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 1000
    }}>
      {/* Header - only shown when expanded */}
      {isExpanded && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid #555'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12px',
            color: '#fff'
          }}>
            <span>🤖</span>
            <span>AI Assistant</span>
            {isLoading && <span style={{ color: '#4a90e2' }}>●</span>}
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            {messages.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearChat();
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#888',
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: '2px 4px'
                }}
                title="Clear chat"
              >
                🗑️
              </button>
            )}
            <button
              onClick={() => setIsMinimized(true)}
              style={{
                background: 'none',
                border: 'none',
                color: '#888',
                fontSize: '12px',
                cursor: 'pointer',
                padding: '2px 4px'
              }}
              title="Minimize to icon"
            >
              ➖
            </button>
            <button
              onClick={() => setIsExpanded(false)}
              style={{
                background: 'none',
                border: 'none',
                color: '#888',
                fontSize: '12px',
                cursor: 'pointer',
                padding: '2px 4px'
              }}
              title="Collapse"
            >
              ▲
            </button>
          </div>
        </div>
      )}

      {/* Messages - only shown when expanded */}
      {isExpanded && (
        <div
          ref={messagesRef}
          style={{
            flex: 1,
            padding: '8px 12px',
            overflowY: 'auto',
            maxHeight: '200px',
            minHeight: '60px'
          }}
        >
          {messages.length === 0 ? (
            <div style={{
              color: '#888',
              fontSize: '12px',
              textAlign: 'center',
              padding: '20px'
            }}>
              Ask me to edit your video! Try: "make the first clip fade in" or "slow down the music"
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={index}
                style={{
                  marginBottom: '8px',
                  padding: '4px 8px',
                  backgroundColor: message.type === 'user' ? '#4a90e2' : message.type === 'error' ? '#d32f2f' : '#333',
                  borderRadius: '4px',
                  fontSize: '12px',
                  color: '#fff'
                }}
              >
                <strong>{message.type === 'user' ? 'You' : message.type === 'error' ? 'Error' : 'AI'}:</strong> {message.text}
              </div>
            ))
          )}
        </div>
      )}

      {/* Input Form - always shown when not minimized */}
      <form onSubmit={handleSubmit} style={{
        display: 'flex',
        padding: '8px 12px',
        gap: '6px',
        alignItems: 'center',
        minHeight: '34px'
      }}>
        {/* Expand/Collapse button when not expanded */}
        {!isExpanded && (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            style={{
              padding: '4px 6px',
              backgroundColor: 'transparent',
              border: '1px solid #555',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '12px',
              cursor: 'pointer',
              minWidth: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Expand chat"
          >
            🤖
          </button>
        )}

        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isListening ? 'Listening...' : 'Ask me to edit your video...'}
          disabled={isLoading || isListening}
          style={{
            flex: 1,
            padding: '4px 6px',
            backgroundColor: '#1a1a1a',
            border: '1px solid #555',
            borderRadius: '3px',
            color: '#fff',
            fontSize: '11px',
            outline: 'none',
            minHeight: '18px'
          }}
        />
        
        {/* Speech button */}
        {recognitionRef.current && (
          <button
            type="button"
            onClick={isListening ? stopListening : startListening}
            disabled={isLoading}
            style={{
              padding: '4px 6px',
              backgroundColor: isListening ? '#d32f2f' : '#4a90e2',
              border: 'none',
              borderRadius: '3px',
              color: '#fff',
              fontSize: '10px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.6 : 1,
              minWidth: '24px',
              minHeight: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title={isListening ? 'Stop listening' : 'Start voice input'}
          >
            {isListening ? '🔴' : '🎤'}
          </button>
        )}
        
        {/* Send button */}
        <button
          type="submit"
          disabled={!input.trim() || isLoading || isListening}
          style={{
            padding: '4px 8px',
            backgroundColor: '#4a90e2',
            border: 'none',
            borderRadius: '3px',
            color: '#fff',
            fontSize: '10px',
            cursor: (!input.trim() || isLoading || isListening) ? 'not-allowed' : 'pointer',
            opacity: (!input.trim() || isLoading || isListening) ? 0.6 : 1,
            minHeight: '24px'
          }}
        >
          {isLoading ? '...' : '→'}
        </button>

        {/* Minimize button when not expanded */}
        {!isExpanded && (
          <button
            type="button"
            onClick={() => setIsMinimized(true)}
            style={{
              padding: '4px 6px',
              backgroundColor: 'transparent',
              border: '1px solid #555',
              borderRadius: '4px',
              color: '#888',
              fontSize: '10px',
              cursor: 'pointer',
              minWidth: '24px',
              minHeight: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Minimize to icon"
          >
            ➖
          </button>
        )}
      </form>
    </div>
  );
};

export default AIChatBox; 