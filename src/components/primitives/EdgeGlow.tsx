interface EdgeGlowProps {
  result: 'strike' | 'ball' | null;
}

/**
 * Sunlight-mode call feedback: the entire screen edge glows green or coral for
 * 400ms, readable from the mound where the small chip isn't (Section 8.3). Mount
 * with `key={pitch.id}` alongside `<CallReadout />` so it replays per pitch.
 */
export function EdgeGlow({ result }: EdgeGlowProps) {
  if (!result) return null;
  const color = result === 'strike' ? 'var(--green-500)' : 'var(--coral-500)';
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 animate-edge-glow"
      style={{ boxShadow: `inset 0 0 0 18px ${color}, inset 0 0 60px 10px ${color}` }}
    />
  );
}
