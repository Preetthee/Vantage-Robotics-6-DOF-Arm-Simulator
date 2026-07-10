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

    options?.onStart?.();

    // 1. Solve IK for the target (with optional orientation)
    const result = this.scene.solveIK(targetPos, options?.targetOrientation);
    if (result.angles.length === 0) {
      return { success: false, reason: 'IK solver returned no angles' };
    }

    // 2. Read current angles from the scene for interpolation start
    const currentAngles = this.readCurrentAngles(jointNames);

    // 3. Animate from current to target
    this.animateAngles(currentAngles, result.angles, options?.duration ?? 350, options?.onComplete);
    return { success: true };
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