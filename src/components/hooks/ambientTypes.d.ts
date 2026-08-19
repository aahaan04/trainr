/**
 * Minimal ambient declarations for browser APIs not yet in TypeScript's lib.dom.d.ts:
 * the Generic Sensor API's AmbientLightSensor, and the PWA beforeinstallprompt event.
 */

interface AmbientLightSensorOptions {
  frequency?: number;
}

declare class AmbientLightSensor extends EventTarget {
  constructor(options?: AmbientLightSensorOptions);
  readonly illuminance: number | null;
  start(): void;
  stop(): void;
  onreading: ((this: AmbientLightSensor, ev: Event) => unknown) | null;
  onerror: ((this: AmbientLightSensor, ev: Event) => unknown) | null;
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
}
