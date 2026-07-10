/**
 * useKeyboardControl — WASD/Arrow + QE keyboard jogging.
 *
 * Hooks global keydown/keyup events. While a movement key is held,
 * a requestAnimationFrame loop continuously jogs the end-effector
 * via the motion pipeline.
 *
 * Key mappings:
 *   W / Arrow Up    →  -Z (move "forward" in camera space)
 *   S / Arrow Down  →  +Z (move "backward")
 *   A / Arrow Left  →  -X (move left)
 *   D / Arrow Right →  +X (move right)
 *   Q               →  -Y (move down)
 *   E               →  +Y (move up)
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { MotionPipeline } from '../motion/MotionPipeline';

interface UseKeyboardControlOptions {
  pipeline: MotionPipeline;
  /** Movement step in metres per jog call (default 0.008) */
  stepSize?: number;
  /** Whether the keyboard controls are active (default true) */
  enabled?: boolean;
}

export function useKeyboardControl({
  pipeline,
  stepSize = 0.008,
  enabled = true,
}: UseKeyboardControlOptions) {
  const keysDown = useRef(new Set<string>());
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const isModifier = (key: string) =>
      ['shift', 'control', 'alt', 'meta'].includes(key);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      // Ignore modifier-only presses
      if (isModifier(e.key.toLowerCase())) return;

      const key = e.key.toLowerCase();
      keysDown.current.add(key);

      // Prevent browser scrolling for arrow keys / space
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) {
        e.preventDefault();
      }

      // Start the jog loop if it is not already running
      if (rafId.current === null) startJogLoop();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keysDown.current.delete(key);

      // If no keys remain, stop the loop
      if (keysDown.current.size === 0) stopJogLoop();
    };

    const handleBlur = () => {
      keysDown.current.clear();
      stopJogLoop();
    };

    // ── rAF jog loop ──────────────────────────────────
    const startJogLoop = () => {
      const tick = () => {
        applyJog();
        rafId.current = requestAnimationFrame(tick);
      };
      rafId.current = requestAnimationFrame(tick);
    };

    const stopJogLoop = () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };

    const applyJog = () => {
      const keys = keysDown.current;
      if (keys.size === 0) return;

      // Use shift for fine / fast modifier
      const mult = keys.has('shift') ? 0.5 : 1;
      const s = stepSize * mult;
      const delta = new THREE.Vector3();

      if (keys.has('w') || keys.has('arrowup')) delta.z -= s;
      if (keys.has('s') || keys.has('arrowdown')) delta.z += s;
      if (keys.has('a') || keys.has('arrowleft')) delta.x -= s;
      if (keys.has('d') || keys.has('arrowright')) delta.x += s;
      if (keys.has('q')) delta.y -= s;
      if (keys.has('e')) delta.y += s;

      if (delta.lengthSq() > 0) {
        pipeline.jog(delta);
      }
    };

    // ── Register listeners ────────────────────────────
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      stopJogLoop();
      keysDown.current.clear();
    };
  }, [pipeline, stepSize, enabled]);
}