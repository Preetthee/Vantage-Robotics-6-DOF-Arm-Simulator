/**
 * useVoiceControl — Orchestrator for voice-controlled arm movement.
 *
 * Combines speech recognition → Fireworks AI LLM parsing →
 * MotionPipeline execution in a single reactive hook.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import type { MotionPipeline } from '../motion/MotionPipeline';
import type { VoiceCommand } from '../voice/parseCommand';
import { parseWithLLM } from '../voice/parseCommand';
import { useSpeechRecognition } from './useSpeechRecognition';

// ─── Key positions used by goto_key ─────────────────────────────────
const KEY_CONFIG: Record<string, { x: number; y: number; z: number }> = {
  '1': { x: 0.500, y: 0.050, z: 0.050 },
  '2': { x: 0.550, y: 0.050, z: 0.050 },
  '3': { x: 0.600, y: 0.050, z: 0.050 },
  '4': { x: 0.500, y: -0.050, z: 0.050 },
  '5': { x: 0.550, y: -0.050, z: 0.050 },
  '6': { x: 0.600, y: -0.050, z: 0.050 },
};

export interface VoiceControlState {
  /** Most recent transcribed text */
  transcript: string;
  /** Whether the microphone is listening */
  isListening: boolean;
  /** Whether the LLM is currently processing the transcript */
  isParsing: boolean;
  /** Whether the arm is currently animating in response to a voice command */
  isExecuting: boolean;
  /** The last parsed command (human-readable) */
  lastCommand: string | null;
  /** Error message if something failed */
  error: string | null;
  /** Whether the browser supports speech recognition */
  isSupported: boolean;
}

export interface VoiceControlActions {
  /** Toggle microphone on/off */
  toggleListening: () => void;
  /** Force-process the current transcript (useful if auto-processing didn't trigger) */
  processTranscript: (text: string) => Promise<void>;
  /** Clear the transcript and any errors */
  clear: () => void;
}

export function useVoiceControl(pipeline: MotionPipeline | null): VoiceControlState & VoiceControlActions {
  const [isParsing, setIsParsing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pipelineRef = useRef(pipeline);
  pipelineRef.current = pipeline;
  const lastTranscriptRef = useRef('');

  // ── Speech recognition ─────────────────────────────────────────────
  const handleSpeechResult = useCallback((text: string) => {
    lastTranscriptRef.current = text;
    // Automatically process finalised speech results
    processTranscript(text);
  }, []);

  const speech = useSpeechRecognition({
    language: 'en-US',
    continuous: true,
    interimResults: false,
    onResult: handleSpeechResult,
    onError: (msg) => setError(msg),
  });

  // ── Execute a parsed command via the pipeline ───────────────────────
  const executeCommand = useCallback(async (command: VoiceCommand) => {
    const p = pipelineRef.current;
    if (!p) {
      setError('Motion pipeline not ready');
      return;
    }

    setIsExecuting(true);
    setError(null);

    try {
      switch (command.type) {
        case 'move_relative': {
          const delta = new THREE.Vector3(
            command.axis === 'x' ? command.value : 0,
            command.axis === 'y' ? command.value : 0,
            command.axis === 'z' ? command.value : 0,
          );
          const result = p.jog(delta);
          if (!result.success) {
            setError(`Could not move: ${result.reason || 'unknown'}`);
          }
          setLastCommand(`Move ${command.axis} ${(command.value * 1000).toFixed(0)}mm`);
          break;
        }

        case 'goto': {
          const target = new THREE.Vector3(command.x, command.y, command.z);
          const result = p.moveToTarget(target, { duration: 600 });
          if (!result.success) {
            setError(`Could not reach target: ${result.reason || 'unknown'}`);
          }
          setLastCommand(`Go to (${command.x.toFixed(3)}, ${command.y.toFixed(3)}, ${command.z.toFixed(3)})`);
          break;
        }

        case 'goto_key': {
          const config = KEY_CONFIG[String(command.key)];
          if (!config) {
            setError(`Key ${command.key} not found in config`);
            break;
          }
          // Convert URDF (Z-up) to Three.js (Y-up): (x, z, -y)
          const keyPos = new THREE.Vector3(config.x, config.z, -config.y);
          const result = p.moveToTarget(keyPos, { duration: 500 });
          if (!result.success) {
            setError(`Could not reach key ${command.key}: ${result.reason || 'unknown'}`);
          }
          setLastCommand(`Go to key ${command.key}`);
          break;
        }

        case 'rotate_joint': {
          setError('Joint rotation via voice not yet implemented (use IK mode)');
          setLastCommand(`Rotate joint ${command.joint} ${command.degrees}° (not supported)`);
          break;
        }

        case 'reset': {
          // Cancel any existing animation
          p.cancel();
          // We can't directly reset joints from here, but the ControlDashboard
          // has a reset button. Signal via an error-like message.
          setLastCommand('Reset (use Reset Pose button)');
          break;
        }

        case 'unknown': {
          setError(command.explanation || 'Command not understood');
          setLastCommand(`Unknown: ${command.explanation}`);
          break;
        }
      }
    } catch (e: any) {
      setError(e.message || 'Error executing command');
    } finally {
      setIsExecuting(false);
    }
  }, []);

  // ── Process transcript with LLM ────────────────────────────────────
  const processTranscript = useCallback(async (text: string) => {
    if (!text.trim()) return;

    setIsParsing(true);
    setError(null);

    try {
      const result = await parseWithLLM(text);
      setLastCommand(
        result.command.type !== 'unknown'
          ? `${text} → ${result.command.type}`
          : text,
      );
      await executeCommand(result.command);
    } catch (e: any) {
      setError(e.message || 'Failed to parse command');
    } finally {
      setIsParsing(false);
    }
  }, [executeCommand]);

  // ── Actions ──────────────────────────────────────────────────────
  const toggleListening = useCallback(() => {
    if (speech.isListening) {
      speech.stopListening();
      // If we have a final transcript, process it
      if (lastTranscriptRef.current) {
        processTranscript(lastTranscriptRef.current);
      }
    } else {
      speech.clearTranscript();
      setError(null);
      setLastCommand(null);
      speech.startListening();
    }
  }, [speech, processTranscript]);

  const clear = useCallback(() => {
    speech.clearTranscript();
    setError(null);
    setLastCommand(null);
  }, [speech]);

  return {
    // State
    transcript: speech.transcript,
    isListening: speech.isListening,
    isParsing,
    isExecuting,
    lastCommand,
    error: error || speech.error,
    isSupported: speech.isSupported,

    // Actions
    toggleListening,
    processTranscript,
    clear,
  };
}