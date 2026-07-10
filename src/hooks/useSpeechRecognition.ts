/**
 * useSpeechRecognition — Web Speech API hook.
 *
 * Returns microphone controls and transcribed text from the browser's
 * built-in SpeechRecognition (webkitSpeechRecognition).
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export interface SpeechRecognitionState {
  /** Most recent transcribed text */
  transcript: string;
  /** Whether the microphone is currently listening */
  isListening: boolean;
  /** Is the browser currently processing speech? */
  isProcessing: boolean;
  /** Error message if something went wrong */
  error: string | null;
  /** Whether the browser supports the Web Speech API */
  isSupported: boolean;
}

export interface SpeechRecognitionActions {
  /** Start listening (request microphone permission) */
  startListening: () => void;
  /** Stop listening and finalise the current transcript */
  stopListening: () => void;
  /** Clear the transcript */
  clearTranscript: () => void;
}

type SpeechRecognitionHook = SpeechRecognitionState & SpeechRecognitionActions;

/**
 * Check browser support for SpeechRecognition
 */
function checkSupport(): boolean {
  return (
    typeof window !== 'undefined' &&
    (!!(window as any).SpeechRecognition ||
      !!(window as any).webkitSpeechRecognition)
  );
}

export function useSpeechRecognition(
  options?: {
    /** Language code (default 'en-US') */
    language?: string;
    /** Called when a final transcript is available */
    onResult?: (transcript: string) => void;
    /** Called when an error occurs */
    onError?: (error: string) => void;
    /** Continuous mode — keep listening after a result (default true) */
    continuous?: boolean;
    /** Interim results (default false — only return finalised text) */
    interimResults?: boolean;
  },
): SpeechRecognitionHook {
  const {
    language = 'en-US',
    onResult,
    onError,
    continuous = true,
    interimResults = false,
  } = options ?? {};

  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSupported] = useState(checkSupport);

  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef('');

  // Build recognition instance
  const createRecognition = useCallback(() => {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition ??
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) return null;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = language;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;

    return recognition;
  }, [language, continuous, interimResults]);

  // Handle results
  useEffect(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    const handleResult = (event: any) => {
      setIsProcessing(true);
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        }
      }

      if (finalText) {
        finalTranscriptRef.current += (finalTranscriptRef.current ? ' ' : '') + finalText;
        setTranscript(finalTranscriptRef.current);
        onResult?.(finalText);
      }

      setIsProcessing(false);
    };

    const handleError = (event: any) => {
      const msg = event.error || 'Unknown speech recognition error';
      setError(msg);
      setIsListening(false);
      setIsProcessing(false);
      onError?.(msg);
    };

    const handleEnd = () => {
      // Recognition ended — only set to false if we're not in continuous mode
      // In continuous mode the browser restarts automatically
    };

    recognition.addEventListener('result', handleResult);
    recognition.addEventListener('error', handleError);
    recognition.addEventListener('end', handleEnd);

    return () => {
      recognition.removeEventListener('result', handleResult);
      recognition.removeEventListener('error', handleError);
      recognition.removeEventListener('end', handleEnd);
    };
  }, [recognitionRef.current, onResult, onError]);

  const startListening = useCallback(() => {
    setError(null);
    setTranscript('');
    finalTranscriptRef.current = '';

    let recognition = recognitionRef.current;
    if (!recognition) {
      recognition = createRecognition();
      recognitionRef.current = recognition;
    }
    if (!recognition) {
      setError('Speech recognition not available');
      return;
    }

    try {
      recognition.start();
      setIsListening(true);
    } catch (e: any) {
      // Already started is fine
      if (e.name !== 'InvalidStateError') {
        setError(e.message || 'Failed to start recognition');
      }
    }
  }, [createRecognition]);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // Ignore — recognition may already be stopped
      }
    }
    setIsListening(false);
    setIsProcessing(false);
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript('');
    finalTranscriptRef.current = '';
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.stop();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return {
    transcript,
    isListening,
    isProcessing,
    error,
    isSupported,
    startListening,
    stopListening,
    clearTranscript,
  };
}