/**
 * MotionPipeline — shared pipeline for all Phase 2 control modes.
 *
 * Accepts target poses (absolute or relative), validates reachability,
 * runs the Jacobian IK solver, and smoothly animates the arm to the
 * result. Joystick, keyboard, IK mode, and future voice/autonomous
 * modes all feed into this single pipeline.
 */

import * as THREE from 'three';
import type { Scene3DHandle } from '../components/Scene3D';

export interface MotionOptions {
  /** Animation duration in ms (default 350) */
  duration?: number;
  /** Target orientation for the end-effector (quaternion) */
  targetOrientation?: THREE.Quaternion;
  onStart?: () => void;
  onProgress?: (t: number) => void;
  onComplete?: () => void;
}

/** Result of a moveToTarget call */
export interface MoveResult {
  success: boolean;
  /** Human-readable reason if not successful */
  reason?: string;
}

export class MotionPipeline {
  private scene: Scene3DHandle;
  private getJointNames: () => string[];
  private setStateAngles: (angles: number[]) => void;
  private animFrameId: number | null = null;
  private _running = false;

  constructor(deps: {
    scene: Scene3DHandle;
    getJointNames: () => string[];
    setStateAngles: (angles: number[]) => void;
  }) {
    this.scene = deps.scene;
    this.getJointNames = deps.getJointNames;
    this.setStateAngles = deps.setStateAngles;
  }

  get isRunning(): boolean {
    return this._running;
  }

  /** Current stylus position, exposed for natural-language planning context. */
  getEndEffectorPosition(): THREE.Vector3 {
    return this.scene.getEEPosition();
  }

  /**
   * Move the end-effector to an absolute world-space target, animated smoothly.
   * Returns false if the target is unreachable or if a previous animation is running.
   */
  moveToTarget(targetPos: THREE.Vector3, options?: MotionOptions): MoveResult {
    const jointNames = this.getJointNames();
    if (jointNames.length === 0) {
      return { success: false, reason: 'No joints loaded' };
    }
    if (this._running) {
      return { success: false, reason: 'Animation in progress' };
    }
    if (!this.isSafeTarget(targetPos)) {
      return { success: false, reason: 'Target is outside the configured safe workspace' };
    }

    // The solver evaluates candidates by applying them to the live scene. Save
    // the actual pose *before* solving so the visual animation can start from
    // where the arm really is, rather than from the solver's final iteration.
    const currentAngles = this.readCurrentAngles(jointNames);

    options?.onStart?.();

    // 1. Solve IK for the target (with optional orientation)
    const result = this.scene.solveIK(targetPos, options?.targetOrientation);
    if (result.angles.length === 0) {
      this.applyAngles(jointNames, currentAngles);
      return { success: false, reason: 'IK solver returned no angles' };
    }

    // Restore the pose that was visible when the command began. Without this,
    // solveIK leaves the arm at the target and the following animation has no
    // distance to interpolate.
    this.applyAngles(jointNames, currentAngles);

    // Animate from the original pose to the IK result.
    this.animateAngles(currentAngles, result.angles, options?.duration ?? 350, options?.onComplete);
    return { success: true };
  }

  /** Promise form for planners that must wait for one safe move to finish. */
  moveToTargetAsync(targetPos: THREE.Vector3, options?: MotionOptions): Promise<MoveResult> {
    return new Promise(resolve => {
      const result = this.moveToTarget(targetPos, {
        ...options,
        onComplete: () => {
          options?.onComplete?.();
          resolve({ success: true });
        },
      });
      if (!result.success) resolve(result);
    });
  }

  /**
   * Jog the end-effector by a relative delta in world space.
   * Applies instantly (no animation) for responsive real-time control.
   */
  jog(delta: THREE.Vector3): MoveResult {
    if (this._running) {
      return { success: false, reason: 'Animation in progress' };
    }

    const jointNames = this.getJointNames();
    if (jointNames.length === 0) {
      return { success: false, reason: 'No joints loaded' };
    }

    const currentPos = this.scene.getEEPosition();
    const targetPos = currentPos.clone().add(delta);

    if (!this.isSafeTarget(targetPos)) {
      return { success: false, reason: 'Requested movement leaves the safe workspace' };
    }

    console.log('[JOG] delta:', delta.toArray().map(v => v.toFixed(4)), 'currentEE:', currentPos.toArray().map(v => v.toFixed(4)), 'target:', targetPos.toArray().map(v => v.toFixed(4)));

    const result = this.scene.solveIK(targetPos);
    console.log('[JOG] IK result:', { angles: result.angles.map(a => (a * 180 / Math.PI).toFixed(1)), error: result.error.toFixed(6), iterations: result.iterations, converged: result.converged });

    if (result.angles.length === 0) {
      return { success: false, reason: 'IK solver returned no angles' };
    }

    // Apply instantly
    result.angles.forEach((angle, i) => {
      if (i < jointNames.length) {
        this.scene.setJointAngle(jointNames[i], angle);
      }
    });
    this.setStateAngles(result.angles);
    return { success: true };
  }

  /** Cancel any running animation */
  cancel(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this._running = false;
  }

  /** Smoothly return every controllable joint to its URDF zero position. */
  reset(duration: number = 500, onComplete?: () => void): MoveResult {
    if (this._running) return { success: false, reason: 'Animation in progress' };

    const jointNames = this.getJointNames();
    if (jointNames.length === 0) return { success: false, reason: 'No joints loaded' };

    this.animateAngles(this.readCurrentAngles(jointNames), new Array(jointNames.length).fill(0), duration, onComplete);
    return { success: true };
  }

  /** Rotate one controllable joint by a relative amount. */
  rotateJoint(index: number, deltaRadians: number, duration: number = 400): MoveResult {
    if (this._running) return { success: false, reason: 'Animation in progress' };

    const jointNames = this.getJointNames();
    if (index < 0 || index >= jointNames.length) return { success: false, reason: 'Joint not found' };

    const start = this.readCurrentAngles(jointNames);
    const end = [...start];
    const limit = (this.scene.getJoints().get(jointNames[index]) as any)?.limit;
    end[index] = THREE.MathUtils.clamp(
      end[index] + deltaRadians,
      limit?.lower ?? -Math.PI,
      limit?.upper ?? Math.PI,
    );
    this.animateAngles(start, end, duration);
    return { success: true };
  }

  /** Move all joints to an explicit, validated joint-angle pose. */
  moveToJointPose(angles: number[], duration: number = 600): MoveResult {
    if (this._running) return { success: false, reason: 'Animation in progress' };
    const jointNames = this.getJointNames();
    if (angles.length !== jointNames.length || angles.some(angle => !Number.isFinite(angle))) {
      return { success: false, reason: `Expected ${jointNames.length} finite joint angles` };
    }

    for (let index = 0; index < jointNames.length; index++) {
      const limit = (this.scene.getJoints().get(jointNames[index]) as any)?.limit;
      const lower = limit?.lower ?? -Math.PI;
      const upper = limit?.upper ?? Math.PI;
      if (angles[index] < lower || angles[index] > upper) {
        return { success: false, reason: `Joint ${index + 1} is outside its safe limit` };
      }
    }

    this.animateAngles(this.readCurrentAngles(jointNames), angles, duration);
    return { success: true };
  }

  // ─── Private ───────────────────────────────────────────

  private readCurrentAngles(jointNames: string[]): number[] {
    return jointNames.map(name => {
      const obj = this.scene.getJoints().get(name);
      if (!obj) return 0;
      const axis = (obj as any).axis;
      if (!axis || axis.lengthSq() <= 0) return 0;
      return extractAngle(obj.quaternion, axis);
    });
  }

  private applyAngles(jointNames: string[], angles: number[]): void {
    angles.forEach((angle, index) => {
      if (index < jointNames.length) this.scene.setJointAngle(jointNames[index], angle);
    });
    this.setStateAngles(angles);
  }

  /** Deterministic workspace gate used by every command source, including AI. */
  private isSafeTarget(target: THREE.Vector3): boolean {
    const withinBounds =
      target.x >= -1.5 && target.x <= 1.5 &&
      target.y >= -0.05 && target.y <= 1.8 &&
      target.z >= -1.5 && target.z <= 1.5;
    return withinBounds && target.length() <= 1.5;
  }

  private animateAngles(
    start: number[],
    end: number[],
    duration: number,
    onComplete?: () => void,
  ): void {
    const jointNames = this.getJointNames();
    const n = Math.min(start.length, end.length, jointNames.length);
    if (n === 0) return;

    this._running = true;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Ease-out cubic — smooth deceleration
      const eased = 1 - Math.pow(1 - t, 3);

      const interpolated = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        interpolated[i] = start[i] + (end[i] - start[i]) * eased;
      }

      // Apply to 3D scene
      interpolated.forEach((angle, i) => {
        this.scene.setJointAngle(jointNames[i], angle);
      });

      // Update React state every frame for smooth dashboard readout
      this.setStateAngles(interpolated);

      if (t < 1) {
        this.animFrameId = requestAnimationFrame(tick);
      } else {
        this._running = false;
        onComplete?.();
      }
    };

    this.animFrameId = requestAnimationFrame(tick);
  }
}

/** Extract signed rotation angle from a quaternion given the axis it rotates around */
function extractAngle(q: THREE.Quaternion, axis: THREE.Vector3): number {
  const sinHalf = Math.sqrt(1 - q.w * q.w);
  if (sinHalf < 1e-6) return 0;
  let angle = 2 * Math.atan2(sinHalf, q.w);
  const qAxis = new THREE.Vector3(q.x, q.y, q.z).normalize();
  if (qAxis.dot(axis.clone().normalize()) < 0) angle = -angle;
  return angle;
}
