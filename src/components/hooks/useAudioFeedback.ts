import { useCallback, useRef } from 'react';

/**
 * Synthesized (no audio files) strike/ball tones, so a pitcher on the mound never
 * has to look at the screen (Section 9). The asymmetry matters here too: strike is
 * a bright rising two-note chime, ball is a single short, lower blip — the same
 * "strike should feel better" rule that governs the call animation (Section 8.5).
 *
 * AudioContext must be created/resumed from a user gesture, so callers should
 * invoke `unlock()` from the first tap of a session (e.g. "Start session").
 */
export function useAudioFeedback(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);

  const getContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctxRef.current) ctxRef.current = new Ctor();
    return ctxRef.current;
  }, []);

  const unlock = useCallback(() => {
    const ctx = getContext();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }, [getContext]);

  const tone = useCallback(
    (freqHz: number, startAt: number, durationS: number, ctx: AudioContext, peakGain: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freqHz, startAt);
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + durationS);
      osc.connect(gain).connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + durationS + 0.02);
    },
    [],
  );

  const playStrike = useCallback(() => {
    if (!enabled) return;
    const ctx = getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    tone(880, now, 0.14, ctx, 0.22);
    tone(1318.5, now + 0.1, 0.22, ctx, 0.22);
  }, [enabled, getContext, tone]);

  const playBall = useCallback(() => {
    if (!enabled) return;
    const ctx = getContext();
    if (!ctx) return;
    tone(294, ctx.currentTime, 0.18, ctx, 0.18);
  }, [enabled, getContext, tone]);

  return { playStrike, playBall, unlock };
}
