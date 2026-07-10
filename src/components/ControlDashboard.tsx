import { useState, useMemo, useRef } from 'react';
import { useArmState } from '../context/ArmStateContext';
import * as THREE from 'three';
import type { Scene3DHandle } from './Scene3D';
import { MotionPipeline } from '../motion/MotionPipeline';
import { useKeyboardControl } from '../hooks/useKeyboardControl';
import JoystickControl from './JoystickControl';

/** Format radians to degrees for display */
function radToDeg(rad: number): string {
  return `${(rad * 180 / Math.PI).toFixed(1)}°`;
}

export default function ControlDashboard({ sceneRef }: { sceneRef: React.RefObject<Scene3DHandle | null> }) {
  const { state, updateJointTarget, updateJointAngle, updateJointAngles, setMode, setStatus, resetPose, setIKTarget } = useArmState();

  // ── Refs to avoid stale closures over state.joints ─────
  const getJointNamesRef = useRef(() => state.joints.map(j => j.name));
  getJointNamesRef.current = () => state.joints.map(j => j.name);
  const setStateAnglesRef = useRef(updateJointAngles);
  setStateAnglesRef.current = updateJointAngles;

  // ── Build motion pipeline (only rebuild when scene handle changes) ─────
  const pipeline = useMemo(() => {
    const scene = sceneRef.current;
    if (!scene) return null;
    return new MotionPipeline({
      scene,
      getJointNames: () => getJointNamesRef.current(),
      setStateAngles: (angles: number[]) => setStateAnglesRef.current(angles),
    });
  }, [sceneRef.current]);

  // ── Keyboard control hook ─────────────────────────────
  useKeyboardControl({ pipeline: pipeline!, enabled: state.mode === 'manual' && !!pipeline });

  // IK target input fields
  const [ikTargetInput, setIkTargetInput] = useState({ x: 0.6, y: 0.3, z: 0.1 });
  const [ikSolverState, setIkSolverState] = useState<{ running: boolean; message: string }>({ running: false, message: '' });

  /** Solve IK through the motion pipeline */
  const handleSolveIK = () => {
    const scene = sceneRef.current;
    if (!scene || !pipeline) return;

    const targetPos = new THREE.Vector3(ikTargetInput.x, ikTargetInput.y, ikTargetInput.z);

    // Show the target marker
    scene.updateTargetMarker(targetPos);
    setIKTarget({ position: [ikTargetInput.x, ikTargetInput.y, ikTargetInput.z] });
    setStatus('running');
    setIkSolverState({ running: true, message: 'Solving...' });

    // Run IK through the pipeline (which handles animation)
    const result = pipeline.moveToTarget(targetPos, {
      duration: 600,
      onComplete: () => {
        // Read final ee position from scene
        const finalPos = scene.getEEPosition();
        const error = finalPos.distanceTo(targetPos);
        setIkSolverState({
          running: false,
          message: error < 0.01
            ? `Reached (error ${(error * 1000).toFixed(1)}mm)`
            : `Partial (error ${(error * 1000).toFixed(1)}mm)`,
        });
        setStatus(error < 0.01 ? 'reached' : 'idle');

        // Clear marker after a moment
        setTimeout(() => scene.updateTargetMarker(null), 3000);
      },
    });

    if (!result.success) {
      setStatus('error');
      setIkSolverState({ running: false, message: `${result.reason || 'IK failed'}` });
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-thin p-5 gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-heading font-semibold text-foreground">Controls</h2>
          <p className="text-[11px] text-foreground/50 mt-0.5">6-DOF Robot Arm</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${
            state.status === 'reached' ? 'bg-emerald-500' :
            state.status === 'running' ? 'bg-amber-500 animate-pulse' :
            state.status === 'error' ? 'bg-red-500' :
            'bg-emerald-500'
          }`} />
          <span className="text-[10px] text-foreground/50 uppercase tracking-wider">
            {state.status}
          </span>
        </div>
      </div>

      {/* Mode switcher */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => {
            setMode('manual');
            setIkSolverState({ running: false, message: '' });
            sceneRef.current?.updateTargetMarker(null);
            pipeline?.cancel();
          }}
          className={`px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 active:scale-[0.97] ${
            state.mode === 'manual'
              ? 'bg-primary text-primary-foreground shadow-md'
              : 'bg-surface text-foreground/70 hover:text-foreground border border-border'
          }`}
        >
          Manual
        </button>
        <button
          onClick={() => setMode('ik')}
          className={`px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 active:scale-[0.97] ${
            state.mode === 'ik'
              ? 'bg-primary text-primary-foreground shadow-md'
              : 'bg-surface text-foreground/70 hover:text-foreground border border-border'
          }`}
        >
          IK Mode
        </button>
        <span className="px-3 py-2 rounded-lg text-xs font-medium bg-surface text-foreground/30 border border-border cursor-not-allowed text-center">
          Voice
        </span>
      </div>

      {/* Manual controls — visible in manual mode */}
      {state.mode === 'manual' && pipeline && (
        <div className="space-y-4">
          {/* On-screen joystick */}
          <div className="p-4 rounded-xl bg-surface/50 border border-border/50">
            <h3 className="text-[11px] font-heading font-medium text-foreground/60 uppercase tracking-wider mb-3 flex items-center justify-between">
              <span>Joystick</span>
              <span className="text-[9px] text-foreground/30 font-normal">Drag to jog</span>
            </h3>
            <div className="flex items-center justify-center">
              <JoystickControl pipeline={pipeline} maxSpeed={0.025} />
            </div>
          </div>

          {/* Keyboard hint */}
          <div className="px-3 py-2.5 rounded-lg bg-surface/30 border border-border/30">
            <h3 className="text-[10px] font-heading font-medium text-foreground/50 uppercase tracking-wider mb-2">
              Keyboard Controls
            </h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono text-foreground/50">
              <span><kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground/70 text-[9px]">W</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground/70 text-[9px]">↑</kbd></span>
              <span>Move forward (Z-)</span>
              <span><kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground/70 text-[9px]">S</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground/70 text-[9px]">↓</kbd></span>
              <span>Move back (Z+)</span>
              <span><kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground/70 text-[9px]">A</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground/70 text-[9px]">←</kbd></span>
              <span>Move left (X-)</span>
              <span><kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground/70 text-[9px]">D</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground/70 text-[9px]">→</kbd></span>
              <span>Move right (X+)</span>
              <span><kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground/70 text-[9px]">Q</kbd></span>
              <span>Move down (Y-)</span>
              <span><kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground/70 text-[9px]">E</kbd></span>
              <span>Move up (Y+)</span>
            </div>
          </div>
        </div>
      )}

      {/* Joint sliders — always visible */}
      <div className="flex flex-col gap-4">
        <h3 className="text-[11px] font-heading font-medium text-foreground/60 uppercase tracking-wider">
          Joint Angles
        </h3>
        {state.joints.map((joint, i) => (
          <JointSlider
            key={joint.name}
            index={i}
            joint={joint}
            onAngleChange={(angle) => {
              updateJointAngle(i, angle);
              sceneRef.current?.setJointAngle(joint.name, angle);
            }}
            onTargetChange={(target) => updateJointTarget(i, target)}
          />
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-2 mt-2">
        <button
          onClick={() => {
            pipeline?.cancel();
            // Reset the 3D scene joints back to zero
            state.joints.forEach(j => sceneRef.current?.setJointAngle(j.name, 0));
            // Also reset the state
            resetPose();
            setIkSolverState({ running: false, message: '' });
          }}
          className="px-3 py-2 rounded-lg text-xs font-medium bg-surface text-foreground/70 hover:text-foreground border border-border transition-all duration-150 active:scale-[0.97]"
        >
          Reset Pose
        </button>
      </div>

      {/* IK Mode Controls */}
      {state.mode === 'ik' && (
        <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 space-y-3">
          <h3 className="text-xs font-heading font-semibold text-foreground flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Inverse Kinematics
          </h3>
          <p className="text-[10px] text-foreground/50 leading-relaxed">
            Set a target position for the stylus tip. The solver computes the required joint angles and animates the arm smoothly to the target.
          </p>

          {/* Target position inputs */}
          <div className="grid grid-cols-3 gap-2">
            {(['x', 'y', 'z'] as const).map(axis => (
              <div key={axis} className="flex flex-col gap-0.5">
                <label className="text-[10px] font-mono text-foreground/50 uppercase">{axis}</label>
                <input
                  type="number"
                  step={0.01}
                  value={ikTargetInput[axis]}
                  onChange={(e) => setIkTargetInput(prev => ({ ...prev, [axis]: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-2 py-1.5 rounded-lg bg-surface border border-border text-xs font-mono tabular-nums text-foreground/80 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all duration-150"
                  placeholder="0.000"
                />
              </div>
            ))}
          </div>

          {/* Solve button */}
          <button
            onClick={handleSolveIK}
            disabled={pipeline?.isRunning}
            className="w-full px-3 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground shadow-md hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97] transition-all duration-150"
          >
            {pipeline?.isRunning ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3 h-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Animating...
              </span>
            ) : (
              'Solve & Animate IK'
            )}
          </button>

          {/* Solver result message */}
          {ikSolverState.message && (
            <div className={`text-[10px] font-mono text-center pt-1 flex items-center justify-center gap-1.5 ${
              ikSolverState.message.startsWith('Reached') ? 'text-success' :
              ikSolverState.message.startsWith('Partial') ? 'text-warning' :
              'text-destructive'
            }`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {ikSolverState.message.startsWith('Reached') ? (
                  <polyline points="20 6 9 17 4 12" />
                ) : ikSolverState.message.startsWith('Partial') ? (
                  <line x1="12" y1="5" x2="12" y2="12" />
                ) : (
                  <circle cx="12" cy="12" r="10" />
                )}
              </svg>
              {ikSolverState.message}
            </div>
          )}
        </div>
      )}

      {/* End effector info */}
      <div className="mt-2 p-3 rounded-lg bg-surface/50 border border-border/50">
        <h3 className="text-[11px] font-heading font-medium text-foreground/60 uppercase tracking-wider mb-2">
          End Effector
        </h3>
        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          <span className="text-foreground/50">Position</span>
          <span className="text-foreground/80 font-mono tabular-nums text-right">
            {state.endEffectorPosition.map(v => v.toFixed(3)).join(', ')}
          </span>
          <span className="text-foreground/50">Orientation</span>
          <span className="text-foreground/80 font-mono tabular-nums text-right">
            {state.endEffectorOrientation.map(v => radToDeg(v)).join(', ')}
          </span>
        </div>
      </div>
    </div>
  );
}

interface JointSliderProps {
  index: number;
  joint: { name: string; angle: number; minAngle: number; maxAngle: number; target: number };
  onAngleChange: (angle: number) => void;
  onTargetChange: (target: number) => void;
}

function JointSlider({ index, joint, onAngleChange, onTargetChange }: JointSliderProps) {
  const range = joint.maxAngle - joint.minAngle;
  const pct = ((joint.angle - joint.minAngle) / range) * 100;

  return (
    <div className="group">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs text-foreground/70 font-medium truncate">
          <span className="text-primary/60 mr-1.5 font-mono text-[10px]">J{index + 1}</span>
          {joint.name.replace(/_/g, ' ')}
        </label>
        <span className="text-[11px] font-mono tabular-nums text-foreground/60 min-w-[4rem] text-right">
          {radToDeg(joint.angle)}
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={joint.minAngle}
          max={joint.maxAngle}
          step={0.001}
          value={joint.angle}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            onAngleChange(val);
            onTargetChange(val);
          }}
          className="joint-slider w-full"
        />
        {/* Value bar */}
        <div
          className="absolute bottom-0 left-0 h-full bg-primary/20 rounded-full pointer-events-none"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}