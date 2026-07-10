/**
 * VoiceControl — UI for voice-controlled arm movement.
 *
 * Shows a microphone toggle button, the transcribed text, the parsed
 * command, and any errors. Designed to sit inside the ControlDashboard
 * when voice mode is active.
 */

import type { VoiceControlState, VoiceControlActions } from '../hooks/useVoiceControl';

interface VoiceControlProps {
  voice: VoiceControlState & VoiceControlActions;
}

export default function VoiceControl({ voice }: VoiceControlProps) {
  const {
    transcript,
    isListening,
    isParsing,
    isExecuting,
    lastCommand,
    error,
    isSupported,
    toggleListening,
    clear,
  } = voice;

  if (!isSupported) {
    return (
      <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 space-y-3">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          <span className="text-sm font-medium text-destructive">Speech Not Supported</span>
        </div>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Your browser doesn't support the Web Speech API. Try Chrome, Edge, or Safari.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Status & mic button */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggleListening}
          disabled={isParsing || isExecuting}
          className={`relative flex items-center justify-center w-12 h-12 rounded-full transition-all duration-200 active:scale-[0.92] ${
            isListening
              ? 'bg-destructive text-white shadow-lg shadow-destructive/30 animate-pulse'
              : 'bg-surface text-foreground/70 hover:text-foreground border border-border hover:border-primary/40'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          aria-label={isListening ? 'Stop listening' : 'Start listening'}
          title={isListening ? 'Tap to stop' : 'Tap to start voice control'}
        >
          {isListening ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="3" width="12" height="18" rx="2" ry="2" />
              <line x1="9" y1="9" x2="15" y2="15" />
              <line x1="15" y1="9" x2="9" y2="15" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
          {/* Live dot when listening */}
          {isListening && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-destructive rounded-full" />
          )}
        </button>

        {/* Status text */}
        <div className="flex-1 min-w-0">
          {isListening && (
            <p className="text-[11px] text-foreground/50 font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-destructive rounded-full animate-pulse" />
              Listening...
              <span className="text-foreground/30 font-normal ml-1">tap mic to stop</span>
            </p>
          )}
          {isParsing && (
            <p className="text-[11px] text-foreground/70 font-medium flex items-center gap-1.5">
              <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Parsing with AI...
            </p>
          )}
          {isExecuting && (
            <p className="text-[11px] text-success font-medium flex items-center gap-1.5">
              <span className="w-3 h-3 border-2 border-success border-t-transparent rounded-full animate-spin" />
              Moving arm...
            </p>
          )}
          {!isListening && !isParsing && !isExecuting && (
            <p className="text-[11px] text-foreground/40">
              Say something like <span className="text-primary/70 italic">"move up 2cm"</span> or <span className="text-primary/70 italic">"go to key 3"</span>
            </p>
          )}
        </div>

        {/* Clear button */}
        {(transcript || error) && !isListening && (
          <button
            onClick={clear}
            className="p-1.5 rounded-lg text-foreground/40 hover:text-foreground transition-colors"
            aria-label="Clear"
            title="Clear transcript"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Transcript */}
      {transcript && (
        <div className="px-3 py-2 rounded-lg bg-surface/60 border border-border/40">
          <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1 font-medium">
            You said
          </p>
          <p className="text-sm text-foreground/90 font-medium italic">
            "{transcript}"
          </p>
        </div>
      )}

      {/* Parsed command */}
      {lastCommand && (
        <div className="px-3 py-2 rounded-lg bg-primary/5 border border-primary/15">
          <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1 font-medium">
            Command
          </p>
          <p className="text-xs text-foreground/80 font-mono">
            {lastCommand}
          </p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-xs text-foreground/70 leading-relaxed">{error}</p>
        </div>
      )}
    </div>
  );
}