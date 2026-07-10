/**
 * AutonomousSequencer — motion planning engine for autonomous PIN entry.
 *
 * Given a 6-digit PIN (digits 1-6), generates approach→touch→retract
 * waypoints for each key and executes them through MotionPipeline.
 * Validates each press against the target key coordinate and reports
 * per-key results.
 *
 * State machine:
 *   IDLE → RUNNING → (for each key: APPROACHING → TOUCHING → VALIDATING → RETRACTING) → COMPLETE
 *                        ↓
 *                     ABORTED (any phase)
 */

import * as THREE from 'three';
import type { Scene3DHandle } from '../components/Scene3D';
import { MotionPipeline } from './MotionPipeline';

// ─── Types ────────────────────────────────────────────────────────────

export type SequencerStatus = 'idle' | 'running' | 'aborted' | 'complete';
export type KeyPhase = 'approaching' | 'touching' | 'validating' | 'retracting' | 'idle';

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
    this._phase = 'approaching';
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

  /** Compute approach position: 30mm above the key surface in Three.js world Y */
  private approachPos(worldPos: THREE.Vector3): THREE.Vector3 {
    return worldPos.clone().add(new THREE.Vector3(0, 0.03, 0));
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
    this.executeApproach(keyWorldPos);
  }

  /** Phase 1: Move to approach position above the key */
  private executeApproach(keyWorldPos: THREE.Vector3): void {
    if (this._aborted) return;

    const approachPos = this.approachPos(keyWorldPos);
    this._phase = 'approaching';
    this.emitStatus();
    this.scene.updateTargetMarker(approachPos);

    const result = this.pipeline.moveToTarget(approachPos, {
      duration: 400,
      onComplete: () => {
        if (this._aborted) return;
        this.executeTouch(keyWorldPos);
      },
    });

    if (!result.success) {
      this.recordUnreachable(result.reason || 'IK solver failed (approach)');
    }
  }

  /** Phase 2: Descend to touch the key surface */
  private executeTouch(keyWorldPos: THREE.Vector3): void {
    if (this._aborted) return;

    this._phase = 'touching';
    this.emitStatus();
    this.scene.updateTargetMarker(keyWorldPos);

    const result = this.pipeline.moveToTarget(keyWorldPos, {
      duration: 400,
      onComplete: () => {
        if (this._aborted) return;

        // Hold 200ms to simulate a press, then validate and retract
        this._holdTimer = setTimeout(() => {
          this._holdTimer = null;
          if (this._aborted) return;

          this.executeValidate(keyWorldPos);
        }, 200);
      },
    });

    if (!result.success) {
      this.recordUnreachable(result.reason || 'IK solver failed (touch)');
    }
  }

  /** Phase 2.5: Validate end-effector position against target key */
  private executeValidate(keyWorldPos: THREE.Vector3): void {
    if (this._aborted) return;

    this._phase = 'validating';
    this.emitStatus();

    const eePos = this.scene.getEEPosition();
    const distance = eePos.distanceTo(keyWorldPos);
    const success = distance <= 0.005; // 5mm tolerance

    this._results.push({
      keyId: parseInt(this._pin[this._currentKeyIndex], 10),
      status: success ? 'success' : 'failure',
      errorMm: distance * 1000,
    });

    // Flash the key with the result colour (green=success, red=failure)
    const keyId = parseInt(this._pin[this._currentKeyIndex], 10);
    this.scene.flashKey(keyId, success);

    this.emitStatus();
    this.executeRetract(keyWorldPos);
  }

  /** Phase 3: Retract back to the approach position */
  private executeRetract(keyWorldPos: THREE.Vector3): void {
    if (this._aborted) return;

    const approachPos = this.approachPos(keyWorldPos);
    this._phase = 'retracting';
    this.emitStatus();
    this.scene.updateTargetMarker(approachPos);

    const result = this.pipeline.moveToTarget(approachPos, {
      duration: 400,
      onComplete: () => {
        if (this._aborted) return;

        // Advance to the next key
        this._currentKeyIndex++;
        this.executeNextKey();
      },
    });

    if (!result.success) {
      // Retract failed — log but continue to next key
      console.warn('[Sequencer] Retract failed — moving to next key:', result.reason);
      this._currentKeyIndex++;
      this.executeNextKey();
    }
  }

  /** Record a key as unreachable and stop the sequence */
  private recordUnreachable(reason: string): void {
    if (this._aborted) return;

    console.warn('[Sequencer] Unreachable key:', reason);

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