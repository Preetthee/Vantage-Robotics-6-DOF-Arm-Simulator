/**
 * PlaybackPanel — PIN entry, execution, and result display for autonomous playback mode.
 *
 * Provides a virtual 6-key keypad (digits 1-6), PIN display, Run/Abort controls,
 * live status updates, and a per-key result summary after sequence completion.
 *
 * Receives sequencer status from the parent (ControlDashboard) via props,
 * and issues start/abort commands through the sequencer ref.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { AutonomousSequencer, KeyPhase, KeyResult } from '../motion/AutonomousSequencer';

interface PlaybackPanelProps {
  sequencer: AutonomousSequencer | null;
  playbackStatus: {
    status: 'idle' | 'running' | 'aborted' | 'complete';
    currentKeyIndex: number;
    phase: KeyPhase;
    results: readonly KeyResult[];
  };
}

const MAX_PIN_LENGTH = 6;

/** Step info helper — maps sequencer phase to a human-readable label */
function stepLabel(keyIndex: number, phase: string): string {
  if (phase === 'idle' || keyIndex < 0) return '—';
  const labelMap: Record<string, string> = {
    approaching: 'Approaching',
    touching: 'Pressing',
    validating: 'Validating',
    retracting: 'Retracting',
  };
  const base = labelMap[phase] || phase;
  return `Key ${keyIndex + 1}/6 — ${base}`;
}

export default function PlaybackPanel({ sequencer, playbackStatus }: PlaybackPanelProps) {
  const [pin, setPin] = useState('');
  const [pinAlert, setPinAlert] = useState<string | null>(null);
  const sequencerRef = useRef(sequencer);
  sequencerRef.current = sequencer;

  const { status, currentKeyIndex, phase, results } = playbackStatus;

  // Clear PIN when sequence completes or aborts
  useEffect(() => {
    if (status === 'complete' || status === 'aborted') {
      // Don't clear PIN so user can see what was entered — only clear on manual reset
    }
  }, [status]);

  // ── Keypad handlers ───────────────────────────────────────────────

  const addDigit = useCallback((digit: string) => {
    setPinAlert(null);
    setPin(prev => {
      if (prev.length >= MAX_PIN_LENGTH) return prev;
      return prev + digit;
    });
  }, []);

  const backspace = useCallback(() => {
    setPinAlert(null);
    setPin(prev => prev.slice(0, -1));
  }, []);

  const runSequence = useCallback(() => {
    if (pin.length !== MAX_PIN_LENGTH) {
      setPinAlert('Enter exactly 6 digits before running the sequence.');
      return;
    }
    if (!/^[1-6]{6}$/.test(pin)) {
      setPinAlert('Invalid PIN: this test panel accepts only digits 1 through 6.');
      return;
    }
    if (!sequencerRef.current?.start(pin)) {
      setPinAlert('Could not start the sequence. The arm may already be moving.');
    }
  }, [pin]);

  const abortSequence = useCallback(() => {
    sequencerRef.current?.abort();
  }, []);

  const resetAll = useCallback(() => {
    setPin('');
    setPinAlert(null);
  }, []);

  const isRunning = status === 'running';
  const canRun = pin.length === MAX_PIN_LENGTH && !isRunning && !!sequencer;
  const isComplete = status === 'complete';
  const isAborted = status === 'aborted';
  const showResults = (isComplete || isAborted) && results.length > 0;
  const successfulCount = results.filter(r => r.status === 'success').length;

  return (
    <div className="space-y-4">
      {/* ── PIN Display ────────────────────────────────────────────── */}
      <div className="p-4 rounded-xl bg-surface/50 border border-border/50">
        <h3 className="text-[11px] font-heading font-medium text-foreground/60 uppercase tracking-wider mb-3">
          PIN Entry
        </h3>

        {/* PIN digits display */}
        <div className="flex items-center justify-center gap-2 mb-4">
          {Array.from({ length: MAX_PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={`w-9 h-10 rounded-lg flex items-center justify-center text-sm font-mono font-bold border transition-all duration-150 ${
                i < pin.length
                  ? 'bg-primary/15 text-primary border-primary/40'
                  : 'bg-surface text-foreground/20 border-border/30'
              }`}
            >
              {i < pin.length ? pin[i] : ''}
            </div>
          ))}
        </div>

        {/* Virtual keypad — digits 1-6 in a 3x2 grid */}
        <label className="block mb-3">
          <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-foreground/60">Type 6-digit PIN</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={MAX_PIN_LENGTH}
            value={pin}
            disabled={isRunning}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, '').slice(0, MAX_PIN_LENGTH);
              setPin(digits);
              setPinAlert(null);
            }}
            placeholder="e.g. 123456"
            className="w-full rounded-lg border border-border/60 bg-surface px-3 py-2 text-center text-sm font-mono font-semibold tracking-[0.3em] text-foreground placeholder:tracking-normal placeholder:text-foreground/35 focus:border-primary/60"
            aria-describedby={pinAlert ? 'pin-alert' : undefined}
          />
        </label>

        {pinAlert && (
          <div id="pin-alert" role="alert" className="mb-3 rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-[11px] font-medium text-destructive">
            {pinAlert}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 mb-3">
          {['1', '2', '3', '4', '5', '6'].map(digit => (
            <button
              key={digit}
              onClick={() => addDigit(digit)}
              disabled={isRunning || pin.length >= MAX_PIN_LENGTH}
              className="px-3 py-2.5 rounded-lg text-sm font-heading font-bold bg-surface text-foreground/70 border border-border/50 hover:border-primary/30 hover:text-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.95] transition-all duration-150"
            >
              {digit}
            </button>
          ))}
        </div>

        {/* Backspace + Run/Abort */}
        <div className="flex items-center gap-2">
          <button
            onClick={backspace}
            disabled={isRunning || pin.length === 0}
            className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-surface text-foreground/60 border border-border/50 hover:text-foreground/80 hover:border-border disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97] transition-all duration-150"
          >
            <span className="flex items-center justify-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
                <line x1="18" y1="9" x2="12" y2="15" />
                <line x1="12" y1="9" x2="18" y2="15" />
              </svg>
              Backspace
            </span>
          </button>

          {isRunning ? (
            <button
              onClick={abortSequence}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-destructive/90 text-destructive-foreground hover:bg-destructive active:scale-[0.97] transition-all duration-150 flex items-center justify-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Abort
            </button>
          ) : (
            <button
              onClick={runSequence}
              disabled={!canRun}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground shadow-md hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97] transition-all duration-150 flex items-center justify-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Run Sequence
            </button>
          )}
        </div>
      </div>

      {/* ── Status Display ─────────────────────────────────────────── */}
      <div className="px-4 py-3 rounded-lg bg-surface/30 border border-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${
              status === 'running' ? 'bg-amber-500 animate-pulse' :
              status === 'complete' ? 'bg-emerald-500' :
              status === 'aborted' ? 'bg-red-500' :
              'bg-foreground/30'
            }`} />
            <span className="text-[11px] font-heading font-medium text-foreground/70 uppercase tracking-wider">
              {status === 'idle' ? 'Idle' :
               status === 'running' ? 'Running' :
               status === 'aborted' ? 'Aborted' :
               'Complete'}
            </span>
          </div>
          <span className="text-[10px] font-mono text-foreground/50">
            {stepLabel(currentKeyIndex, phase)}
          </span>
        </div>

        {/* Progress bar during execution */}
        {isRunning && (
          <div className="mt-2 h-1.5 w-full bg-surface rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
              style={{ width: `${Math.min(((currentKeyIndex + (phase === 'retracting' ? 0.5 : 0)) / 6) * 100, 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* ── Result Summary ─────────────────────────────────────────── */}
      {showResults && (
        <div className="p-4 rounded-xl bg-surface/50 border border-border/50">
          <h3 className="text-[11px] font-heading font-medium text-foreground/60 uppercase tracking-wider mb-3">
            Result Summary
          </h3>

          <div className="space-y-1.5 mb-3">
            {results.map((result, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs bg-surface/30"
              >
                <span className="text-foreground/70">
                  Key {result.keyId}
                </span>
                <span className={`font-mono tabular-nums flex items-center gap-1.5 ${
                  result.status === 'success' ? 'text-emerald-400' :
                  result.status === 'failure' ? 'text-red-400' :
                  'text-amber-400'
                }`}>
                  {result.status === 'success' && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  {result.status === 'failure' && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                  )}
                  {result.status === 'unreachable' && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  )}
                  <span>
                    {result.status === 'success' && `✅ ${result.errorMm.toFixed(1)}mm`}
                    {result.status === 'failure' && `❌ ${result.errorMm.toFixed(1)}mm`}
                    {result.status === 'unreachable' && '⚠ Unreachable'}
                  </span>
                </span>
              </div>
            ))}
          </div>

          {/* Overall score */}
          <div className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-surface/50 border border-border/30 mb-3">
            <span className="text-xs text-foreground/70 font-medium">
              {successfulCount}/{results.length} successful
            </span>
            <span className={`text-xs font-mono font-bold ${
              successfulCount === results.length ? 'text-emerald-400' :
              successfulCount >= results.length / 2 ? 'text-amber-400' :
              'text-red-400'
            }`}>
              {successfulCount === results.length ? 'Perfect' :
               successfulCount >= results.length / 2 ? 'Partial' :
               'Failed'}
            </span>
          </div>

          <button
            onClick={resetAll}
            className="w-full px-3 py-2 rounded-lg text-xs font-medium bg-surface text-foreground/70 border border-border/50 hover:text-foreground hover:border-border active:scale-[0.97] transition-all duration-150"
          >
            Clear & Try Again
          </button>
        </div>
      )}

      {/* ── Aborted message (no results yet) ────────────────────────── */}
      {isAborted && results.length === 0 && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30">
          <p className="text-xs text-destructive/80 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Sequence aborted. Enter a new PIN to try again.
          </p>
          <button
            onClick={resetAll}
            className="mt-2 px-3 py-1.5 rounded-lg text-[10px] font-medium bg-surface text-foreground/60 border border-border/50 hover:text-foreground active:scale-[0.97] transition-all duration-150"
          >
            Reset
          </button>
        </div>
      )}

      {/* ── No sequencer (loading) ──────────────────────────────────── */}
      {!sequencer && (
        <div className="px-4 py-3 rounded-lg bg-surface/30 border border-border/30">
          <p className="text-xs text-foreground/50 text-center">
            Waiting for robot model to load...
          </p>
        </div>
      )}
    </div>
  );
}
