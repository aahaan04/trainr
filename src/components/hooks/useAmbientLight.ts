import { useCallback, useState } from 'react';

/** Above this illuminance (lux) it's reasonable to suggest sunlight mode. Direct sun is 10,000+ lux. */
const BRIGHT_THRESHOLD_LUX = 3000;

export type AmbientLightState = 'unsupported' | 'idle' | 'reading' | 'bright' | 'normal' | 'denied';

/**
 * One-shot ambient light read to suggest sunlight mode during setup (Section 8.3).
 * The Generic Sensor API needs a permissions-policy grant and HTTPS, and is
 * Chromium-only, so this always degrades to the manual toggle when unsupported.
 */
export function useAmbientLight() {
  const [state, setState] = useState<AmbientLightState>(
    typeof window !== 'undefined' && 'AmbientLightSensor' in window ? 'idle' : 'unsupported',
  );

  const check = useCallback(async () => {
    if (typeof window === 'undefined' || !('AmbientLightSensor' in window)) {
      setState('unsupported');
      return;
    }
    setState('reading');
    try {
      const sensor = new AmbientLightSensor({ frequency: 1 });
      await new Promise<void>((resolve, reject) => {
        const onReading = () => {
          const lux = sensor.illuminance ?? 0;
          setState(lux >= BRIGHT_THRESHOLD_LUX ? 'bright' : 'normal');
          sensor.stop();
          resolve();
        };
        const onError = () => {
          sensor.stop();
          reject(new Error('ambient-light-sensor-error'));
        };
        sensor.onreading = onReading;
        sensor.onerror = onError;
        sensor.start();
      });
    } catch {
      setState('denied');
    }
  }, []);

  return { state, check };
}
