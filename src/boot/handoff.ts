// Boot → game handoff (types only). The game imports this with `import type`, so no runtime edge exists.

import type { DeviceInfo, Recommendation, Settings } from '../shared/types.ts';

export interface BootHandoff {
  settings: Settings;
  device: DeviceInfo | null;
  recommendation: Recommendation | null;
  /** Element the boot UI lived in (the game hides it once its loading screen is up). */
  bootRoot: HTMLElement | null;
  /** Created and resumed inside the Start click (user gesture), for the audio lane. */
  audioContext?: AudioContext;
  /** Loading-status callback into the boot UI while the game initialises. */
  status(text: string): void;
}

export interface GameModule {
  startGame(h: BootHandoff): Promise<void>;
}
