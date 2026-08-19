interface StatTileProps {
  label: string;
  value: string;
  sublabel?: string;
  className?: string;
}

/** A headline number tile: Barlow Condensed display numerals, tabular so live updates don't jitter. */
export function StatTile({ label, value, sublabel, className = '' }: StatTileProps) {
  return (
    <div className={`flex flex-col gap-1 rounded-card bg-surface-1 p-4 shadow-rest ${className}`}>
      <span className="text-label uppercase text-ink-tertiary">{label}</span>
      <span className="num font-display text-display-md font-bold text-ink">{value}</span>
      {sublabel && <span className="text-caption text-ink-secondary">{sublabel}</span>}
    </div>
  );
}
