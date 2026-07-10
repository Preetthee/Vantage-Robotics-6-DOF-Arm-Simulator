import { useState, useCallback, useRef } from 'react';
import * as THREE from 'three';
import type { MotionPipeline } from '../motion/MotionPipeline';
import { parseFreeSpeech, type VoiceAction, type VoicePlan, type Vector3 } from '../voice/parseCommand';
import { useSpeechRecognition } from './useSpeechRecognition';

const PANEL_POSITIONS: Vector3[] = [
  { x: 0.500, y: 0.050, z: -0.050 }, { x: 0.550, y: 0.050, z: -0.050 }, { x: 0.600, y: 0.050, z: -0.050 },
  { x: 0.500, y: 0.050, z: 0.050 }, { x: 0.550, y: 0.050, z: 0.050 }, { x: 0.600, y: 0.050, z: 0.050 },
];

export interface VoiceControlState {
  transcript: string;
  isListening: boolean;
  isParsing: boolean;
  isExecuting: boolean;
  lastCommand: string | null;
  error: string | null;
  isSupported: boolean;
}

export interface VoiceControlActions {
  toggleListening: () => void;
  processTranscript: (text: string) => Promise<void>;
  clear: () => void;
}

function speak(message: string): void {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(message));
}

function waitForMotion(pipeline: MotionPipeline): Promise<void> {
  return new Promise(resolve => {
    const check = () => pipeline.isRunning ? window.setTimeout(check, 40) : resolve();
    check();
  });
}

function actionLabel(action: VoiceAction): string {
  if (action.kind === 'move_to') return `move to (${action.target.x.toFixed(2)}, ${action.target.y.toFixed(2)}, ${action.target.z.toFixed(2)})`;
  if (action.kind === 'move_by') return 'move relative to the current pose';
  if (action.kind === 'rotate_joint') return `rotate joint ${action.joint} by ${action.degrees} degrees`;
  if (action.kind === 'joint_pose') return 'move to the requested joint pose';
  return 'return home';
}

export function useVoiceControl(pipeline: MotionPipeline | null): VoiceControlState & VoiceControlActions {
  const [isParsing, setIsParsing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pipelineRef = useRef(pipeline);
  const processRef = useRef<(text: string) => Promise<void>>(async () => {});
  const lastTranscriptRef = useRef('');
  pipelineRef.current = pipeline;

  const executePlan = useCallback(async (plan: VoicePlan): Promise<void> => {
    const motion = pipelineRef.current;
    if (!motion) throw new Error('Motion pipeline is not ready.');
    if (plan.actions.length === 0) throw new Error(plan.summary || 'No safe action was planned.');

    setIsExecuting(true);
    try {
      for (const action of plan.actions) {
        let result;
        if (action.kind === 'move_to') result = motion.moveToTarget(new THREE.Vector3(action.target.x, action.target.y, action.target.z), { duration: 550 });
        else if (action.kind === 'move_by') result = motion.jog(new THREE.Vector3(action.delta.x, action.delta.y, action.delta.z));
        else if (action.kind === 'rotate_joint') result = motion.rotateJoint(action.joint - 1, THREE.MathUtils.degToRad(action.degrees));
        else if (action.kind === 'joint_pose') result = motion.moveToJointPose(action.angles.map(THREE.MathUtils.degToRad));
        else result = motion.reset();

        if (!result.success) throw new Error(`${actionLabel(action)} failed: ${result.reason || 'unsafe or unreachable target'}`);
        await waitForMotion(motion);
      }
    } finally {
      setIsExecuting(false);
    }
  }, []);

  const processTranscript = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const motion = pipelineRef.current;
    if (!motion) {
      setError('Motion pipeline is not ready.');
      return;
    }

    setIsParsing(true);
    setError(null);
    try {
      const position = motion.getEndEffectorPosition();
      const { plan } = await parseFreeSpeech(text, {
        currentPosition: { x: position.x, y: position.y, z: position.z },
        panelPositions: PANEL_POSITIONS,
      });
      setLastCommand(plan.summary);
      if (plan.actions.length === 0) {
        setError(plan.summary);
        speak(plan.summary);
        return;
      }

      speak(`I understood: ${plan.summary}. Executing ${plan.actions.length} step${plan.actions.length === 1 ? '' : 's'}.`);
      await executePlan(plan);
      setLastCommand(`Completed: ${plan.summary}`);
      speak(`Completed: ${plan.summary}.`);
    } catch (cause: any) {
      const message = cause?.message || 'Voice command failed.';
      setError(message);
      speak(message);
    } finally {
      setIsParsing(false);
    }
  }, [executePlan]);
  processRef.current = processTranscript;

  const speech = useSpeechRecognition({
    language: 'en-US', continuous: true, interimResults: false,
    onResult: (text) => { lastTranscriptRef.current = text; void processRef.current(text); },
    onError: setError,
  });

  const toggleListening = useCallback(() => {
    if (speech.isListening) {
      speech.stopListening();
      if (lastTranscriptRef.current) void processTranscript(lastTranscriptRef.current);
    } else {
      speech.clearTranscript();
      setError(null);
      setLastCommand(null);
      lastTranscriptRef.current = '';
      speech.startListening();
    }
  }, [speech, processTranscript]);

  const clear = useCallback(() => {
    speech.clearTranscript();
    setError(null);
    setLastCommand(null);
  }, [speech]);

  return { transcript: speech.transcript, isListening: speech.isListening, isParsing, isExecuting, lastCommand, error: error || speech.error, isSupported: speech.isSupported, toggleListening, processTranscript, clear };
}
