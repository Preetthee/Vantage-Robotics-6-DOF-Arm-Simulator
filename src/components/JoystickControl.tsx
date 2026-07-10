/**
 * JoystickControl — On-screen drag joystick for end-effector jogging.
 *
 * A circular drag pad that maps pointer displacement to 3D movement:
 *   - Drag horizontally → X axis movement
 *   - Drag vertically   → Z axis movement
 * A separate vertical slider handles Y (up/down) with auto-return.
 *
 * While dragging, a rAF loop continuously calls pipeline.jog() with
 * the current displacement vector, giving smooth real-time control.
 */

import { useRef, useCallback, useState, useEffect, useReducer } from 'react';
import * as THREE from 'three';
import type { MotionPipeline } from '../motion/MotionPipeline';

interface JoystickControlProps {
  pipeline: MotionPipeline;
  /** Max jog speed in m/s (default 0.02) */
  maxSpeed?: number;
}

type JoystickState = 'idle' | 'dragging';

const PAD_SIZE = 96; // px (w-24)
const KNOB_SIZE = 36; // px
const MAX_OFFSET = (PAD_SIZE - KNOB_SIZE) / 2; // 30px — knob edge touches pad edge

export default function JoystickControl({ pipeline, maxSpeed = 0.02 }: JoystickControlProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const rafId = useRef<number | null>(null);
  const displacement = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  const [speedScale, setSpeedScale] = useState(0.65);

  const [, forceRender] = useReducer(x => x + 1, 0);

  // ── Pointer handlers ──────────────────────────────────

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const pad = padRef.current;
    if (!pad) return;
    pad.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    setIsDragging(true);
    displacement.current = { x: 0, y: 0 };
    setKnobPos({ x: 0, y: 0 });

    // Start the jog loop
    const tick = () => {
      if (!isDraggingRef.current) return;
      const dx = displacement.current.x;
      const dy = displacement.current.y;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        // Up/down → Z axis (body-frame forward/back)
        pipeline.jog(new THREE.Vector3(dx * maxSpeed * speedScale, 0, dy * maxSpeed * speedScale));
      }
      rafId.current = requestAnimationFrame(tick);
    };
    rafId.current = requestAnimationFrame(tick);
  }, [pipeline, maxSpeed, speedScale]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const pad = padRef.current;
    if (!pad) return;

    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = rect.width / 2;

    // Clamp to circle
    let nx = (e.clientX - cx) / radius;
    let ny = (e.clientY - cy) / radius;
    const dist = Math.sqrt(nx * nx + ny * ny);
    if (dist > 1) {
      nx /= dist;
      ny /= dist;
    }

    displacement.current = { x: nx, y: ny };
    setKnobPos({ x: nx, y: ny });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const pad = padRef.current;
    if (!pad) return;
    pad.releasePointerCapture(e.pointerId);
    isDraggingRef.current = false;
    setIsDragging(false);
    displacement.current = { x: 0, y: 0 };
    setKnobPos({ x: 0, y: 0 });

    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  }, []);

  // ── Y slider with auto-return ─────────────────────────

  const yRef = useRef(0);
  const [yActive, setYActive] = useState(false);
  const yRafId = useRef<number | null>(null);

  useEffect(() => {
    // Cleanup rAF on unmount
    return () => {
      if (yRafId.current !== null) cancelAnimationFrame(yRafId.current);
    };
  }, []);

  const startYJog = useCallback((value: number) => {
    yRef.current = value;
    setYActive(true);

    const tick = () => {
      pipeline.jog(new THREE.Vector3(0, yRef.current, 0));
      yRafId.current = requestAnimationFrame(tick);
    };
    yRafId.current = requestAnimationFrame(tick);
  }, [pipeline]);

  const stopYJog = useCallback(() => {
    yRef.current = 0;
    setYActive(false);
    if (yRafId.current !== null) {
      cancelAnimationFrame(yRafId.current);
      yRafId.current = null;
    }
  }, []);

  const handleYPointerDown = useCallback((e: React.PointerEvent) => {
    const slider = e.currentTarget as HTMLInputElement;
    slider.setPointerCapture(e.pointerId);
    const val = parseFloat(slider.value);
    startYJog(val);
  }, [startYJog]);

  const handleYPointerMove = useCallback((e: React.PointerEvent) => {
    if (!yActive) return;
    const slider = e.currentTarget as HTMLInputElement;
    const val = parseFloat(slider.value);
    yRef.current = val;
    // Update the visual by forcing a re-render
    forceRender(n => n + 1);
  }, [yActive]);

  const handleYPointerUp = useCallback((e: React.PointerEvent) => {
    const slider = e.currentTarget as HTMLInputElement;
    slider.releasePointerCapture(e.pointerId);
    stopYJog();
  }, [stopYJog]);

  return (
    <div className="flex flex-col gap-3 select-none">
      <div className="flex items-center gap-3">
        {/* Joystick pad */}
        <div
          ref={padRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`relative w-24 h-24 rounded-full touch-none cursor-grab active:cursor-grabbing transition-shadow duration-150 ${
            isDragging
              ? 'shadow-lg shadow-primary/20 ring-2 ring-primary/30'
              : 'shadow-md'
          }`}
          style={{
            background: 'radial-gradient(circle, var(--color-muted) 0%, var(--color-background) 100%)',
            border: '1px solid var(--color-border)',
            touchAction: 'none',
          }}
          role="slider"
          aria-label="End-effector XY joystick"
          aria-orientation="dual"
          tabIndex={0}
        >
          {/* Knob */}
          <div
            className="absolute w-9 h-9 rounded-full transition-none"
            style={{
              background: 'radial-gradient(circle at 35% 35%, var(--color-primary), var(--color-secondary))',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)',
              left: `calc(50% - ${KNOB_SIZE / 2}px + ${knobPos.x * MAX_OFFSET}px)`,
              top: `calc(50% - ${KNOB_SIZE / 2}px + ${knobPos.y * MAX_OFFSET}px)`,
            }}
          />
          {/* Crosshair guides */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-full h-px bg-border/40" style={{ position: 'absolute', top: '50%' }} />
            <div className="h-full w-px bg-border/40" style={{ position: 'absolute', left: '50%' }} />
          </div>
          {/* Axis labels */}
          <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[8px] font-mono text-foreground/30">Z-</span>
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] font-mono text-foreground/30">Z+</span>
          <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[8px] font-mono text-foreground/30">X-</span>
          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[8px] font-mono text-foreground/30">X+</span>
        </div>

        {/* Y (vertical) jog slider — auto-returns to center on release */}
        <div className="flex h-24 w-20 flex-col justify-center gap-2 rounded-xl border border-border/60 bg-surface/70 px-2">
          <div className="flex items-center justify-between">
            <label htmlFor="joystick-speed" className="text-[9px] font-mono font-semibold uppercase tracking-wider text-foreground/60">Speed</label>
            <span className="text-[9px] font-mono text-primary">{Math.round(speedScale * 100)}%</span>
          </div>
          <input
            id="joystick-speed"
            type="range"
            min="0.2"
            max="1"
            step="0.05"
            value={speedScale}
            onChange={(event) => setSpeedScale(parseFloat(event.target.value))}
            className="joint-slider w-full"
            aria-label="Joystick speed"
          />
          <span className="text-[8px] leading-tight text-foreground/45">Controls drag speed</span>
        </div>

        <div className="hidden">
          <label className="text-[9px] font-mono text-foreground/40 uppercase tracking-wider">Y</label>
          <div className="relative h-24 w-7 flex items-center">
            {/* Slider track background */}
            <div
              className="absolute left-1/2 -translate-x-1/2 w-1 rounded-full"
              style={{
                height: 'calc(100% - 4px)',
                background: 'var(--color-muted)',
                top: '2px',
              }}
            />
            {/* Active track fill */}
            <div
              className="absolute left-1/2 -translate-x-1/2 w-1 rounded-full transition-none"
              style={{
                height: yActive ? `${Math.abs(yRef.current) / 0.03 * 50}%` : '0%',
                background: 'var(--color-primary)',
                bottom: yRef.current < 0 ? '50%' : 'auto',
                top: yRef.current >= 0 ? '50%' : 'auto',
              }}
            />
            {/* Slider thumb */}
            <div
              className="absolute left-1/2 -translate-x-1/2 w-4 h-4 rounded-full transition-shadow duration-150 cursor-grab active:cursor-grabbing"
              style={{
                background: yActive
                  ? 'var(--color-primary)'
                  : 'radial-gradient(circle at 35% 35%, var(--color-secondary), var(--color-primary))',
                boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                top: `${50 - (yRef.current / 0.03) * 50}%`,
                touchAction: 'none',
              }}
              onPointerDown={handleYPointerDown}
              onPointerMove={handleYPointerMove}
              onPointerUp={handleYPointerUp}
              onPointerCancel={handleYPointerUp}
            />
            {/* Hidden input for accessibility */}
            <input
              type="range"
              min={-0.03}
              max={0.03}
              step={0.001}
              defaultValue={0}
              onPointerDown={handleYPointerDown}
              onPointerMove={handleYPointerMove}
              onPointerUp={handleYPointerUp}
              className="absolute inset-0 opacity-0 cursor-grab active:cursor-grabbing"
              style={{ touchAction: 'none' }}
              aria-label="End-effector Y axis jog"
            />
          </div>
          <span className="text-[8px] font-mono text-foreground/30">↑+ ↓-</span>
        </div>
      </div>

      {/* Status hint */}
      <p className="text-[10px] text-foreground/40 text-center leading-relaxed">
        {isDragging
          ? 'Drag to jog end-effector'
          : 'Drag the pad to move the arm'}
      </p>
    </div>
  );
}
