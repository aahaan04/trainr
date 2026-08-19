import { TWO_CAMERA_UPGRADES } from '@/domain/constants';
import { Card } from '@/components/primitives/Card';
import { SectionDivider } from '@/components/motif/SectionDivider';

/**
 * Section 16: "How this works and where it is wrong." The numbers below are
 * measured from this build's own calibration and physics model, not marketing
 * copy — that's the point of the page. Users who understand the failure modes
 * trust the numbers that are actually good.
 */
export function HowItWorksScreen() {
  return (
    <div className="flex flex-col gap-6 px-4 py-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-display-md font-display font-bold text-ink">How this works, and where it's wrong</h1>
        <p className="text-body text-ink-secondary">
          Every number this app shows comes from a webcam, some geometry, and a physics model — not a radar gun.
          Here's what that buys you, and where it breaks down.
        </p>
      </header>

      <Card className="flex flex-col gap-2">
        <h2 className="text-title font-semibold text-ink">1. Calibration is the whole game, and it's less forgiving than it looks</h2>
        <p className="text-body text-ink-secondary">
          At the recommended plate-camera placement — about 16 ft behind the plate, viewing it at a shallow angle —
          home plate only images at roughly <strong>91 x 24 pixels</strong> at 720p. Tapping its corners during setup
          just 1 pixel off yields a median camera-position error of about <strong>0.24 m</strong>; 2 pixels off pushes
          the median to <strong>0.59 m</strong>, with a worst case as bad as 11 m. That error propagates straight into
          every distance, velocity and break number the app reports.
        </p>
        <p className="text-body text-ink-secondary">
          This is also why the app reports calibration uncertainty in metres instead of the usual "reprojection
          error" you'd see in most computer vision tools: reprojection error stays under 1 pixel even when the
          camera's actual position is off by metres, so it would look reassuring while being wrong. Take your time
          with the corner-tapping step and use the magnifier — it matters more than almost anything else you do
          during setup.
        </p>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-title font-semibold text-ink">2. Motion blur depends on where the camera is standing</h2>
        <p className="text-body text-ink-secondary">
          From behind the plate the ball is flying almost straight at the lens, so it barely streaks — mostly it
          just grows larger, frame to frame. From the side, the same pitch streaks <strong>3-5 ball widths</strong>{' '}
          at 60 fps. That difference is exactly why a side camera measures break so much better than the plate
          camera alone: sideways streaking is a strong signal for lateral motion, and the plate camera simply
          doesn't get much of it. Single-camera break numbers are a real measurement, but they're built on a
          thinner signal, which is why they're always labelled approximate.
        </p>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-title font-semibold text-ink">3. Frame rate matters more than resolution</h2>
        <p className="text-body text-ink-secondary">
          A roughly 0.4-0.5 s pitch flight gives the tracker about <strong>13 samples at 30 fps</strong> — workable,
          but marginal — versus about <strong>26 at 60 fps</strong>. Temporal resolution beats spatial resolution
          here: a sharp 1080p30 frame that's blurred by motion still only gives you a coarse read on the flight,
          while a slightly softer 720p60 frame gives the fitting model twice the samples to work with. Prefer
          720p60 over 1080p30 whenever your camera offers the choice.
        </p>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-title font-semibold text-ink">4. The two-plane rule is correct, and rarely the deciding factor</h2>
        <p className="text-body text-ink-secondary">
          Home plate is only 17 in deep, so the front and back planes the app checks are just{' '}
          <strong>17-20 ms apart</strong> for a typical pitch. In that gap even the steepest drop ball falls about{' '}
          <strong>3.9 cm</strong> — noticeable, but small next to the zone's own inflation of one ball radius (about
          4.85 cm) on every side. In practice, checking both planes only changes the call for pitches passing within
          roughly 2 cm of a zone edge. It's implemented, and it's right when it applies, but it isn't the
          difference-maker it might sound like from the rulebook description.
        </p>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-title font-semibold text-ink">5. Spin is never measured</h2>
        <p className="text-body text-ink-secondary">
          This app does not display a spin rate or spin axis anywhere, for any pitch. Optical spin tracking needs
          high-speed multi-camera rigs or dedicated radar hardware that a webcam setup cannot approximate — so
          rather than guess, it says nothing. If a number would have to be invented to fill the space, it's left
          blank instead.
        </p>
      </Card>

      <SectionDivider />

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold text-ink">Single camera vs. two cameras</h2>
        <p className="text-body text-ink-secondary">
          The strike/ball call itself is reliable either way — it only needs the ball to cross the plate plane
          accurately, which a single well-calibrated camera does well. Everything that depends on depth or lateral
          motion improves with a second camera:
        </p>
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full min-w-[420px] text-left text-body">
            <thead>
              <tr className="bg-surface-2 text-label uppercase text-ink-tertiary">
                <th className="px-3 py-2">Metric</th>
                <th className="px-3 py-2">Single camera</th>
                <th className="px-3 py-2">Two cameras</th>
              </tr>
            </thead>
            <tbody>
              {TWO_CAMERA_UPGRADES.map((row) => (
                <tr key={row.metric} className="border-t border-border">
                  <td className="px-3 py-2 text-ink">{row.metric}</td>
                  <td className="px-3 py-2 text-ink-secondary">{row.single}</td>
                  <td className="px-3 py-2 text-ink-secondary">{row.dual}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-caption text-ink-tertiary">
        Wherever a number on screen depends on any of this, the app marks it — a confidence meter next to every
        call, "approximate" on single-camera break figures, and a sync-quality warning in two-camera mode when clock
        alignment degrades.
      </p>
    </div>
  );
}
