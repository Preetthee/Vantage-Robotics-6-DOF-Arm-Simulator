import { useArmState } from '../context/ArmStateContext';
import type { Scene3DHandle } from './Scene3D';

/** Format radians to degrees for display */
function radToDeg(rad: number): string {
  return `${(rad * 180 / Math.PI).toFixed(1)}°`;
}

export default function ControlDashboard({ sceneRef }: { sceneRef: React.RefObject<Scene3DHandle | null> }) {
  const { state, updateJointTarget, updateJointAngle, setMode, resetPose } = useArmState();

  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-thin p-5 gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-heading font-semibold text-foreground">Joint Controls</h2>
          <p className="text-[11px] text-foreground/50 mt-0.5">6-DOF Manual Control</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="text-[10px] text-foreground/50 uppercase tracking-wider">
            {state.status}
          </span>
        </div>
      </div>

      {/* Joint sliders */}
      <div className="flex flex-col gap-4">
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
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setMode('manual')}
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
        </div>
        <button
          onClick={() => {
            // Reset the 3D scene joints back to zero
            state.joints.forEach(j => sceneRef.current?.setJointAngle(j.name, 0));
            // Also reset the state
            resetPose();
          }}
          className="px-3 py-2 rounded-lg text-xs font-medium bg-surface text-foreground/70 hover:text-foreground border border-border transition-all duration-150 active:scale-[0.97]"
        >
          Reset Pose
        </button>
      </div>

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
          {joint.name.replace('_', ' ')}
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