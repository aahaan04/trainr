/**
 * /diagnostics — the device capability probe.
 *
 * Runs on both the laptop and the iPad and exports comparable JSON, so the two sit
 * side by side in the hardware report. Deliberately shows raw getCapabilities()
 * output rather than a curated summary: the surprises in this session will be
 * things nobody thought to summarise.
 */

import { useCallback, useRef, useState } from 'react';
import { CAPTURE } from '@/domain/constants';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { requestCameraStream } from '@/capture/getUserMedia';
import {
  emptyReport,
  probeBrightness,
  probeCameras,
  probeExposure,
  probeFrameRate,
  probeThroughput,
} from '@/diagnostics/probe';
import type { DiagnosticsReport } from '@/diagnostics/types';

type Phase = 'idle' | 'running' | 'done' | 'error';

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-1.5 last:border-0">
      <span className="text-caption text-ink-secondary">{label}</span>
      <span className={`num text-body ${warn ? 'text-coral-700' : 'text-ink'}`}>{value}</span>
    </div>
  );
}

function yesNo(v: boolean): string {
  return v ? 'yes' : 'no';
}

export function DiagnosticsScreen() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('');
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const run = useCallback(async () => {
    setPhase('running');
    setError(null);
    const r = emptyReport();
    let stream: MediaStream | null = null;

    try {
      setStatus('Requesting camera…');
      const requested = {
        width: CAPTURE.PREFERRED_WIDTH,
        height: CAPTURE.PREFERRED_HEIGHT,
        frameRate: CAPTURE.IDEAL_FPS,
      };
      // Deliberately goes through the app's own constraint ladder rather than a raw
      // getUserMedia call: a probe that fails where the app succeeds measures the
      // probe, not the device. A hard `min: 60` throws OverconstrainedError on any
      // camera that cannot do 60fps, which is most laptop webcams.
      const opened = await requestCameraStream();
      stream = opened.stream;
      if (opened.degraded && opened.degradeReason) r.notes.push(opened.degradeReason);

      const video = videoRef.current!;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      setStatus('Enumerating cameras…');
      r.cameras = await probeCameras();

      setStatus('Measuring delivered frame rate (5s)…');
      r.frameRate = await probeFrameRate(video, stream, requested, opened);
      if (!r.features.requestVideoFrameCallback) {
        r.notes.push(
          'requestVideoFrameCallback is unavailable, so the frame-rate figure is a requestAnimationFrame measurement bounded by display refresh, NOT a camera frame-rate measurement.',
        );
      }

      setStatus('Probing manual exposure…');
      r.exposure = await probeExposure(stream);

      setStatus('Measuring brightness…');
      r.brightness = probeBrightness(video);

      setStatus('Measuring worker transfer…');
      r.throughput = await probeThroughput(video);

      r.capturedAt = new Date().toISOString();
      setReport(r);
      setPhase('done');
      setStatus('');
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      setError(msg);
      r.notes.push(`Probe aborted: ${msg}`);
      setReport(r);
      setPhase('error');
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
    }
  }, []);

  const download = useCallback(() => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diagnostics-${report.device.guessedName.replace(/\s+/g, '-')}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report]);

  const copy = useCallback(async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setStatus('Copied to clipboard');
      setTimeout(() => setStatus(''), 2000);
    } catch {
      setStatus('Clipboard blocked — use Download instead');
    }
  }, [report]);

  const f = report?.features;
  const fr = report?.frameRate;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <header>
        <h1 className="font-display text-display-md">Device diagnostics</h1>
        <p className="text-body text-ink-secondary">
          Measures what this device actually grants, rather than what it reports. Run on every device
          you intend to use, then export the JSON.
        </p>
      </header>

      <video ref={videoRef} className="h-40 w-full rounded-card bg-surface-2 object-cover" playsInline muted />

      <div className="flex flex-wrap gap-2">
        <Button onClick={run} disabled={phase === 'running'}>
          {phase === 'running' ? 'Probing…' : 'Run probe'}
        </Button>
        {report && (
          <>
            <Button variant="secondary" onClick={download}>
              Download JSON
            </Button>
            <Button variant="secondary" onClick={copy}>
              Copy JSON
            </Button>
          </>
        )}
      </div>

      {status && <p className="text-caption text-ink-secondary">{status}</p>}
      {error && (
        <Card className="border border-coral-700">
          <p className="text-body text-coral-700">{error}</p>
        </Card>
      )}

      {report && f && (
        <>
          <Card>
            <h2 className="mb-2 font-display text-title">Device</h2>
            <Row label="Guessed" value={report.device.guessedName} />
            <Row label="Screen" value={`${report.device.screen.width}×${report.device.screen.height} @${report.device.screen.dpr}x`} />
            <Row label="CPU threads" value={String(f.hardwareConcurrency)} />
            <p className="mt-2 break-words text-caption text-ink-tertiary">{report.device.userAgent}</p>
          </Card>

          <Card>
            <h2 className="mb-2 font-display text-title">Platform features</h2>
            <Row label="Secure context" value={yesNo(f.secureContext)} warn={!f.secureContext} />
            <Row label="getUserMedia" value={yesNo(f.getUserMedia)} warn={!f.getUserMedia} />
            <Row label="requestVideoFrameCallback" value={yesNo(f.requestVideoFrameCallback)} warn={!f.requestVideoFrameCallback} />
            <Row label="OffscreenCanvas" value={yesNo(f.offscreenCanvas)} warn={!f.offscreenCanvas} />
            <Row label="createImageBitmap" value={yesNo(f.createImageBitmap)} warn={!f.createImageBitmap} />
            <Row label="WebGL2" value={yesNo(f.webgl2)} warn={!f.webgl2} />
            <Row label="WebGPU" value={yesNo(f.webgpu)} />
            <Row label="MediaRecorder" value={yesNo(f.mediaRecorder)} warn={!f.mediaRecorder} />
            <Row label="Recorder MIME types" value={f.mediaRecorderMimeTypes.join(', ') || 'none'} warn={f.mediaRecorderMimeTypes.length === 0} />
            <Row label="Wake Lock" value={yesNo(f.wakeLock)} />
            <Row label="RTCDataChannel" value={yesNo(f.rtcDataChannel)} warn={!f.rtcDataChannel} />
            <Row label="crossOriginIsolated" value={yesNo(f.crossOriginIsolated)} />
            <Row label="SharedArrayBuffer" value={yesNo(f.sharedArrayBuffer)} />
            <Row label="IndexedDB" value={yesNo(f.indexedDB)} warn={!f.indexedDB} />
          </Card>

          {fr && (
            <Card>
              <h2 className="mb-2 font-display text-title">Frame delivery</h2>
              <Row label="Requested" value={`${fr.requested.width}×${fr.requested.height} @${fr.requested.frameRate}fps`} />
              <Row label="Constraint ladder" value={fr.degraded ? 'stepped down' : 'first rung granted'} warn={fr.degraded} />
              <Row label="Reported by getSettings" value={`${fr.reported.width}×${fr.reported.height} @${fr.reported.frameRate ?? '?'}fps`} />
              <Row
                label="MEASURED fps"
                value={fr.measured.fps.toFixed(1)}
                warn={fr.measured.fps < CAPTURE.MIN_FPS - 2}
              />
              <Row label="Median interval" value={`${fr.measured.medianIntervalMs.toFixed(2)} ms`} />
              <Row label="p95 interval" value={`${fr.measured.p95IntervalMs.toFixed(2)} ms`} />
              <Row label="Long gaps (dropped)" value={String(fr.measured.longIntervals)} warn={fr.measured.longIntervals > 2} />
              <Row label="Frames sampled" value={`${fr.measured.frames} over ${fr.measured.durationS.toFixed(1)}s`} />
            </Card>
          )}

          {report.exposure && (
            <Card>
              <h2 className="mb-2 font-display text-title">Exposure control</h2>
              <Row label="Manual mode offered" value={yesNo(report.exposure.supported)} />
              <Row label="Manual actually applied" value={yesNo(report.exposure.manualSettable)} />
              <Row label="Modes" value={report.exposure.exposureModes.join(', ') || 'none reported'} />
              <Row
                label="exposureTime range"
                value={
                  report.exposure.exposureTimeRange
                    ? `${report.exposure.exposureTimeRange.min}–${report.exposure.exposureTimeRange.max}`
                    : 'not exposed'
                }
              />
              <Row label="Applied exposureTime" value={report.exposure.appliedExposureTime?.toString() ?? 'n/a'} />
              <Row label="Applied ISO" value={report.exposure.appliedIso?.toString() ?? 'n/a'} />
              {report.exposure.error && <p className="mt-2 text-caption text-coral-700">{report.exposure.error}</p>}
            </Card>
          )}

          {report.brightness && (
            <Card>
              <h2 className="mb-2 font-display text-title">Scene brightness</h2>
              <Row label="Mean luma" value={report.brightness.meanLuma.toFixed(1)} />
              <Row
                label="Verdict"
                value={report.brightness.classification}
                warn={report.brightness.classification !== 'good'}
              />
            </Card>
          )}

          {report.throughput && (
            <Card>
              <h2 className="mb-2 font-display text-title">Worker transfer</h2>
              <Row
                label="720p bitmap round trip (median)"
                value={report.throughput.workerRoundTripMs != null ? `${report.throughput.workerRoundTripMs.toFixed(2)} ms` : 'failed'}
                warn={(report.throughput.workerRoundTripMs ?? 0) > CAPTURE.FRAME_BUDGET_MS}
              />
              {report.throughput.error && <p className="mt-2 text-caption text-coral-700">{report.throughput.error}</p>}
            </Card>
          )}

          <Card>
            <h2 className="mb-2 font-display text-title">Cameras ({report.cameras.length})</h2>
            {report.cameras.map((c) => (
              <details key={c.deviceId} className="border-b border-border py-2 last:border-0">
                <summary className="cursor-pointer text-body">{c.label}</summary>
                <pre className="mt-2 overflow-x-auto rounded bg-surface-2 p-2 text-caption">
                  {JSON.stringify({ capabilities: c.capabilities, settings: c.settings, error: c.error }, null, 2)}
                </pre>
              </details>
            ))}
          </Card>

          {report.notes.length > 0 && (
            <Card>
              <h2 className="mb-2 font-display text-title">Notes</h2>
              <ul className="list-disc pl-5 text-body text-ink-secondary">
                {report.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
