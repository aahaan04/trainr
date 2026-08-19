/**
 * Colour legend, the "what you need" checklist, the two-camera upgrade table
 * (TWO_CAMERA_UPGRADES verbatim, Section 10), and a slot for WS6's "how this works
 * and where it is wrong" page — this workstream only renders the callback/slot.
 */

import { TWO_CAMERA_UPGRADES } from '@/domain/constants';
import { color } from '@/design/tokens';

const CHECKLIST = ['A softball', 'A tripod or stable mount', 'Bright, even light', 'About 20 ft of space behind the plate'];

interface LegendProps {
  cameraMode: 'single' | 'dual';
  onOpenHowThisWorks?: () => void;
}

function Swatch({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-body text-ink">
      {swatch}
      <span>{label}</span>
    </div>
  );
}

export function Legend({ cameraMode, onOpenHowThisWorks }: LegendProps) {
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-label text-ink-secondary">Legend</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Swatch swatch={<span className="h-3 w-3 rounded-full" style={{ background: color.indigo700 }} />} label="Camera & structures" />
          <Swatch
            swatch={<span className="h-3 w-6 rounded-input" style={{ background: color.indigo500, opacity: 0.3 }} />}
            label="Field of view / strike zone"
          />
          <Swatch swatch={<span className="h-3 w-3 rounded-full border" style={{ borderColor: color.surface1, background: color.surface2 }} />} label="Plate, lines & dirt" />
          <Swatch
            swatch={<span className="h-2 w-6 rounded-full" style={{ background: `linear-gradient(90deg, ${color.optic}, ${color.opticGlow})` }} />}
            label="Ball & pitch path"
          />
        </div>
      </div>

      <div>
        <p className="mb-2 text-label text-ink-secondary">What you need</p>
        <ul className="space-y-1 text-body text-ink">
          {CHECKLIST.map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {cameraMode === 'dual' && (
        <div>
          <p className="mb-2 text-label text-ink-secondary">What the second camera improves</p>
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full text-left text-body">
              <thead>
                <tr className="bg-surface-2 text-label text-ink-secondary">
                  <th scope="col" className="px-3 py-2">
                    Metric
                  </th>
                  <th scope="col" className="px-3 py-2">
                    One camera
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Two cameras
                  </th>
                </tr>
              </thead>
              <tbody>
                {TWO_CAMERA_UPGRADES.map((row) => (
                  <tr key={row.metric} className="border-t border-border">
                    <td className="px-3 py-2 text-ink">{row.metric}</td>
                    <td className="px-3 py-2 text-ink-secondary">{row.single}</td>
                    <td className="px-3 py-2 font-semibold text-indigo-700">{row.dual}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {onOpenHowThisWorks && (
        <button
          type="button"
          onClick={onOpenHowThisWorks}
          className="min-h-tap text-body font-semibold text-indigo-600 underline-offset-2 hover:underline"
        >
          How this works, and where it can be wrong
        </button>
      )}
    </div>
  );
}
