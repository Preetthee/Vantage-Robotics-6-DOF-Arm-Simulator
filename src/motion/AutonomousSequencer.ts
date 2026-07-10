/**
 * AutonomousSequencer — motion planning engine for autonomous PIN entry.
 *
 * Given a 6-digit PIN (digits 1-6), generates hover→touch→retract
 * waypoints for each key and executes them through MotionPipeline.
 * Validates each press against the target key coordinate and reports
 * per-key results.
 *
 * Strategy: Move to 3cm ABOVE the key (forces an "arm above key" IK
 * solution), then descend directly to the key surface. The 3cm clearance
 * prevents the arm from sagging below the key surface due to joint limits.
 * The IK solver is given a downward-pointing orientation constraint so the
 * tool points toward the keypad (not upward).
 *
 * State machine:
 *   IDLE → RUNNING → (for each key: HOVERING → TOUCHING → VALIDATING → RETRACTING) → COMPLETE
 *                        ↓
 *                     ABORTED (any phase)
 */

import * as THREE from 'three';
import type { Scene3DHandle } from '../components/Scene3D';
import { MotionPipeline } from './MotionPipeline';

// ─── Types ────────────────────────────────────────────────────────────

export type SequencerStatus = 'idle' | 'running' | 'aborted' | 'complete';
export type KeyPhase = 'hovering' | 'touching' | 'validating' | 'retracting' | 'idle';

export interface KeyResult {
  keyId: number;
  status: 'success' | 'failure' | 'unreachable';
  errorMm: number;
}

export interface SequencerStatusEvent {
  status: SequencerStatus;
  currentKeyIndex: number;
  totalKeys: number;
  phase: KeyPhase;
  results: KeyResult[];
}

/** A single key entry from key.config.json (URDF base_link frame) */
interface KeyConfigEntry {
  x: number;
  y: number;
  z: number;
}

// ─── Constants ─────────────────────────────────────────────────────────

/** 3cm clearance above the key surface for the hover position */
const HOVER_CLEARANCE = 0.03;

/**
 * Downward-pointing orientation quaternion.
 * In URDF the tool's default direction is +z; in Three.js (Y-up)
 * "down" is -y. This quaternion rotates +z to -y.
 */
const DOWNWARD_ORI = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, -1, 0),
);

/** Tolerance for validating a key press (metres) */
const TOUCH_TOLERANCE = 0.005;

/** Duration (ms) the tool holds on the key to simulate a press */
const HOLD_DURATION = 200;

// ─── Helpers ───────────────────────────────────────────────────────────

/** Format joint angles in degrees for logging */
function logJointAngles(label: string, angles: number[], jointNames: string[]): void {
  const degStr = angles
    .map((a, i) => `${jointNames[i] || `j${i}`}=${(a * 180 / Math.PI).toFixed(1)}°`)
    .join('  ');
  console.log(`[SEQUENCER] ${label}: ${degStr}`);
}

// ─── Sequencer ─────────────────────────────────────────────────────────

export class AutonomousSequencer {
  private pipeline: MotionPipeline;
  private scene: Scene3DHandle;
  private keyConfig: Record<string, KeyConfigEntry>;
  private onStatusChange: (event: SequencerStatusEvent) => void;

  private _status: SequencerStatus = 'idle';
  private _currentKeyIndex = 0;
  private _phase: KeyPhase = 'idle';
  private _results: KeyResult[] = [];
  private _pin = '';
  private _aborted = false;
  private _holdTimer: ReturnType<typeof setTimeout> | null = null;

  /** Height (in Three.js world Y) at which the arm hovered — reused for retract */
  private _hoverHeight = 0;

  constructor(deps: {
    pipeline: MotionPipeline;
    scene: Scene3DHandle;
    keyConfig: Record<string, KeyConfigEntry>;
    onStatusChange?: (event: SequencerStatusEvent) => void;
  }) {
    this.pipeline = deps.pipeline;
    this.scene = deps.scene;
    this.keyConfig = deps.keyConfig;
    this.onStatusChange = deps.onStatusChange ?? (() => {});
  }

  // ── Public getters ─────────────────────────────────────────────────

  get status(): SequencerStatus {
    return this._status;
  }

  get currentKeyIndex(): number {
    return this._currentKeyIndex;
  }

  get phase(): KeyPhase {
    return this._phase;
  }

  get results(): readonly KeyResult[] {
    return this._results;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Start autonomous playback of the given PIN.
   * Returns `true` if the sequence started, `false` if already running or invalid PIN.
   */
  start(pin: string): boolean {
    if (this._status === 'running') return false;
    if (pin.length !== 6 || !/^[1-6]{6}$/.test(pin)) return false;

    this._pin = pin;
    this._aborted = false;
    this._currentKeyIndex = 0;
    this._results = [];
    this._status = 'running';
    this._phase = 'hovering';
    this.emitStatus();

    this.executeNextKey();
    return true;
  }

  /**
   * Abort the current sequence immediately.
   * Cancels the current animation, clears the target marker, sets status to 'aborted'.
   */
  abort(): void {
    this._aborted = true;

    if (this._holdTimer !== null) {
      clearTimeout(this._holdTimer);
      this._holdTimer = null;
    }

    this.pipeline.cancel();
    this._status = 'aborted';
    this._phase = 'idle';
    this.scene.updateTargetMarker(null);
    this.scene.clearHighlights();
    this.emitStatus();
  }

  // ── Private: key execution ─────────────────────────────────────────

  /** Convert URDF (Z-up) coordinates to Three.js world (Y-up) */
  private urdfToWorld(entry: KeyConfigEntry): THREE.Vector3 {
    return new THREE.Vector3(entry.x, entry.z, -entry.y);
  }

  /** Log current joint angles from the scene */
  private logCurrentJoints(label: string): void {
    const jointNames = Array.from(this.scene.getJoints().keys());
    const angles = jointNames.map(name => {
      const obj = this.scene.getJoints().get(name);
      if (!obj) return 0;
      const axis = (obj as any).axis;
      if (!axis || axis.lengthSq() <= 0) return 0;
      // Extract signed angle from quaternion
      const q = obj.quaternion;
      const sinHalf = Math.sqrt(1 - q.w * q.w);
      if (sinHalf < 1e-6) return 0;
      let angle = 2 * Math.atan2(sinHalf, q.w);
      const qAxis = new THREE.Vector3(q.x, q.y, q.z).normalize();
      if (qAxis.dot(axis.clone().normalize()) < 0) angle = -angle;
      return angle;
    });
    logJointAngles(label, angles, jointNames);
  }

  /** Move to the next key in the sequence, or finish if done */
  private executeNextKey(): void {
    if (this._aborted) return;

    if (this._currentKeyIndex >= 6) {
      // All keys processed — complete
      this.scene.clearHighlights();
      this._status = 'complete';
      this._phase = 'idle';
      this.scene.updateTargetMarker(null);
      this.emitStatus();
      return;
    }

    const digit = this._pin[this._currentKeyIndex];
    const keyId = parseInt(digit, 10);
    const config = this.keyConfig[digit];
    if (!config) {
      this.scene.highlightKey(keyId);
      setTimeout(() => this.scene.flashKey(keyId, false), 100);
      this.recordUnreachable(`No config found for digit "${digit}"`);
      return;
    }

    // Highlight the target key in the 3D scene
    this.scene.highlightKey(keyId);

    const keyWorldPos = this.urdfToWorld(config);
    this.executeHover(keyWorldPos);
  }

  /**
   * Phase 1: Move to 3cm ABOVE the key surface.
   * This forces an "arm above key" IK solution, preventing the arm
   * from sagging below the key surface.
   */
  private executeHover(keyWorldPos: THREE.Vector3): void {
    if (this._aborted) return;

    const hoverPos = keyWorldPos.clone();
    hoverPos.y += HOVER_CLEARANCE;
    this._hoverHeight = hoverPos.y;
    this._phase = 'hovering';
    this.emitStatus();
    this.scene.updateTargetMarker(hoverPos);

    this.logCurrentJoints(`HOVER start (key ${this._currentKeyIndex + 1})`);

    const result = this.pipeline.moveToTarget(hoverPos, {
      duration: 400,
      targetOrientation: DOWNWARD_ORI,
      onComplete: () => {
        if (this._aborted) return;
        this.logCurrentJoints(`HOVER end (key ${this._currentKeyIndex + 1})`);
        this.executeTouch(keyWorldPos);
      },
    });

    if (!result.success) {
      this.recordUnreachable(result.reason || 'IK solver failed (hover)');
    }
  }

  /**
   * Phase 2: Descend directly to the key surface.
   * This is a short, reachable move since we're already 3cm above.
   */
  private executeTouch(keyWorldPos: THREE.Vector3): void {
    if (this._aborted) return;

    this._phase = 'touching';
    this.emitStatus();
    this.scene.updateTargetMarker(keyWorldPos);

    this.logCurrentJoints(`TOUCH start (key ${this._currentKeyIndex + 1})`);

    const result = this.pipeline.moveToTarget(keyWorldPos, {
      duration: 400,
      targetOrientation: DOWNWARD_ORI,
      onComplete: () => {
        if (this._aborted) return;

        this.logCurrentJoints(`TOUCH end (key ${this._currentKeyIndex + 1})`);

        // Hold 200ms to simulate a press, then validate and retract
        this._holdTimer = setTimeout(() => {
          this._holdTimer = null;
          if (this._aborted) return;

          this.executeValidate(keyWorldPos);
        }, HOLD_DURATION);
      },
    });

    if (!result.success) {
      this.recordUnreachable(result.reason || 'IK solver failed (touch)');
    }
  }

  /** Phase 3: Validate end-effector position against target key */
  private executeValidate(keyWorldPos: THREE.Vector3): void {
    if (this._aborted) return;

    this._phase = 'validating';
    this.emitStatus();

    const eePos = this.scene.getEEPosition();
    const distance = eePos.distanceTo(keyWorldPos);
    const success = distance <= TOUCH_TOLERANCE;

    this._results.push({
      keyId: parseInt(this._pin[this._currentKeyIndex], 10),
      status: success ? 'success' : 'failure',
      errorMm: distance * 1000,
    });

    console.log(
      `[SEQUENCER] Key ${this._currentKeyIndex + 1}: ${success ? 'SUCCESS' : 'FAILURE'} ` +
      `(error: ${(distance * 1000).toFixed(2)}mm)`,
    );

    // Flash the key with the result colour (green=success, red=failure)
    const keyId = parseInt(this._pin[this._currentKeyIndex], 10);
    this.scene.flashKey(keyId, success);

    this.emitStatus();
    this.executeRetract(keyWorldPos);
  }

  /** Phase 4: Retract back to the hover position (3cm above the key) */
  private executeRetract(keyWorldPos: THREE.Vector3): void {
    if (this._aborted) return;

    const retractPos = keyWorldPos.clone();
    retractPos.y = this._hoverHeight;
    this._phase = 'retracting';
    this.emitStatus();
    this.scene.updateTargetMarker(retractPos);

    const result = this.pipeline.moveToTarget(retractPos, {
      duration: 400,
      targetOrientation: DOWNWARD_ORI,
      onComplete: () => {
        if (this._aborted) return;

        // Advance to the next key
        this._currentKeyIndex++;
        this.executeNextKey();
      },
    });

    if (!result.success) {
      // Retract failed — log but continue to next key
      console.warn('[SEQUENCER] Retract failed — moving to next key:', result.reason);
      this._currentKeyIndex++;
      this.executeNextKey();
    }
  }

  /** Record a key as unreachable and stop the sequence */
  private recordUnreachable(reason: string): void {
    if (this._aborted) return;

    console.warn('[SEQUENCER] Unreachable key:', reason);

    this._results.push({
      keyId: parseInt(this._pin[this._currentKeyIndex], 10),
      status: 'unreachable',
      errorMm: -1,
    });

    // Stop the sequence — unreachable key is a terminal condition
    this.scene.clearHighlights();
    this._status = 'complete';
    this._phase = 'idle';
    this.scene.updateTargetMarker(null);
    this.emitStatus();
  }

  /** Emit current status to the registered callback */
  private emitStatus(): void {
    this.onStatusChange({
      status: this._status,
      currentKeyIndex: this._currentKeyIndex,
      totalKeys: 6,
      phase: this._phase,
      results: [...this._results],
    });
  }
}