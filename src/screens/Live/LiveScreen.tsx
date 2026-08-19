import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { navigate } from '@/components/router';
import { useWakeLock } from '@/components/hooks/useWakeLock';
import { useAudioFeedback } from '@/components/hooks/useAudioFeedback';
import { CameraStage } from '@/components/live/CameraStage';
import { ZoneOverlay } from '@/components/live/ZoneOverlay';
import { PitchStrip } from '@/components/live/PitchStrip';
import { PitchTypeRow } from '@/components/live/PitchTypeRow';
import { SyncBadge } from '@/components/live/SyncBadge';
import { CallReadout } from '@/components/primitives/CallReadout';
import { EdgeGlow } from '@/components/primitives/EdgeGlow';
import { Button } from '@/components/primitives/Button';
import { Optional, PendingPlaceholder } from '@/components/adapters/optional';
import { PitchTypePad } from '@/components/adapters/statsAdapter';
import { RollingClipRecorder } from '@/clip/clipRecorder';
import { formatDistance } from '@/domain/units';
import type { PitchTypeId } from '@/domain/constants';

const STATUS_LABEL: Record<string, string> = {
  idle: 'Idle',
  starting: 'Starting...',
  running: 'Tracking',
  degraded: 'Degraded',
  error: 'Error',
};

/**
 * The live session screen (Section 9): dominated by the camera feed, the call and
 * velocity appear large and immediately, a recent-pitch strip runs along the
 * bottom, pitch type buttons stay thumb-reachable. This workstream builds the
 * chrome around the feed; frame capture, ball tracking and the strike/ball
 * decision are WS3/WS4's pipeline, consumed here only via `appStore`.
 *
 * UNTESTABLE without a physical camera — see the report for what was and wasn't
 * verified.
 */
export function LiveScreen() {
  const session = useAppStore((s) => s.session);
  const pitcher = useAppStore((s) => s.pitcher);
  const pitches = useAppStore((s) => s.pitches);
  const zone = useAppStore((s) => s.zone);
  const calibrations = useAppStore((s) => s.calibrations);
  const settings = useAppStore((s) => s.settings);
  const status = useAppStore((s) => s.status);
  const fps = useAppStore((s) => s.fps);
  const sync = useAppStore((s) => s.sync);
  const intendedType = useAppStore((s) => s.intendedType);
  const relabelPitch = useAppStore((s) => s.relabelPitch);
  const setIntent = useAppStore((s) => s.setIntent);
  const endSession = useAppStore((s) => s.endSession);

  useWakeLock(!!session);
  const { playStrike, playBall, unlock } = useAudioFeedback(settings.audioFeedback);

  const recorderRef = useRef<RollingClipRecorder>(new RollingClipRecorder());
  const lastAnnouncedIdRef = useRef<string | null>(null);

  const handleStream = useCallback((stream: MediaStream | null) => {
    if (stream) recorderRef.current.start(stream);
    else recorderRef.current.stop();
  }, []);

  useEffect(() => () => recorderRef.current.stop(), []);

  const latest = pitches[0] ?? null;

  useEffect(() => {
    if (!latest || latest.id === lastAnnouncedIdRef.current || !session) return;
    lastAnnouncedIdRef.current = latest.id;
    if (latest.call.result === 'strike') playStrike();
    else playBall();
    void recorderRef.current.captureAround(session.id, latest.id, latest.timestampMs, settings.clipRetentionCount);
  }, [latest, session, playStrike, playBall, settings.clipRetentionCount]);

  if (!session || !pitcher) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-indigo-900 p-6 text-center text-white">
        <p className="text-title font-semibold">No session in progress</p>
        <p className="max-w-xs text-body text-indigo-100">Start a session from Home first.</p>
        <Button onClick={() => navigate('/')}>Go home</Button>
      </div>
    );
  }

  const pickerValue = session.callBeforeMode ? intendedType : (latest?.labeledType ?? null);
  const handleTypePick = (type: PitchTypeId, customName?: string) => {
    if (session.callBeforeMode) setIntent(type);
    else if (latest) void relabelPitch(latest.id, type, customName);
  };

  const endAndReview = async () => {
    recorderRef.current.stop();
    await endSession();
    navigate(`/session/${session.id}`);
  };

  return (
    <div className="fixed inset-0" onPointerDownCapture={unlock}>
      <CameraStage onStream={handleStream}>
        <ZoneOverlay
          calibration={calibrations.plate ?? null}
          zone={zone}
          sunlightMode={settings.sunlightMode}
          lastCall={
            latest
              ? { isStrike: latest.call.result === 'strike', x: latest.call.front.position.x, y: latest.call.front.position.y }
              : null
          }
        />

        <div className="over-video pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <div className="flex flex-col gap-1">
            <span
              className={[
                'rounded-pill px-3 py-1 text-caption font-medium text-white',
                status === 'running'
                  ? 'bg-indigo-700'
                  : status === 'error'
                    ? 'bg-coral-700'
                    : status === 'degraded'
                      ? 'bg-amber-500 text-indigo-900'
                      : 'bg-indigo-900/70',
              ].join(' ')}
            >
              {STATUS_LABEL[status] ?? status} {status === 'running' ? `- ${fps.toFixed(0)} fps` : ''}
            </span>
          </div>
          <div className="flex flex-col items-end gap-1">
            {session.cameraMode === 'dual' && sync && <SyncBadge sync={sync} />}
            <Button variant="secondary" size="md" className="pointer-events-auto bg-white/90" onClick={() => void endAndReview()}>
              End session
            </Button>
          </div>
        </div>

        {latest && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <CallReadout
              key={latest.id}
              result={latest.call.result}
              speedMps={latest.call.front.speedMps}
              units={settings.units}
              band={latest.call.band}
              caveats={latest.call.caveats}
            />
          </div>
        )}
        {latest && settings.sunlightMode && <EdgeGlow key={`${latest.id}-glow`} result={latest.call.result} />}

        {latest?.commandMissM !== undefined && (
          <div className="over-video absolute bottom-40 left-1/2 -translate-x-1/2 rounded-pill bg-indigo-900/70 px-3 py-1 text-caption text-white">
            Missed target by {formatDistance(latest.commandMissM, settings.units)}
          </div>
        )}

        <div className="over-video absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-indigo-900/90 via-indigo-900/60 to-transparent pb-2 pt-8">
          <PitchStrip pitches={pitches} units={settings.units} onRelabel={(id, type) => void relabelPitch(id, type)} />
          <Optional
            component={PitchTypePad}
            fallback={<PitchTypeRow value={pickerValue} onChange={handleTypePick} />}
            props={{ value: pickerValue, onChange: handleTypePick }}
          />
        </div>

        {status === 'idle' && (
          <div className="over-video pointer-events-none absolute inset-x-0 bottom-24 flex justify-center">
            <PendingPlaceholder
              label="Vision pipeline not connected"
              detail="Camera preview is live; ball detection and calls will appear once WS3/WS4's pipeline is running."
            />
          </div>
        )}
      </CameraStage>
    </div>
  );
}
