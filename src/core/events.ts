// Tiny typed event bus. Systems communicate through events instead of importing each other.

import type { P3 } from '../shared/layout-types.ts';

export interface GameEvents {
  /** A sound the chaser can hear. radius is at the source, before room-graph attenuation (metres). */
  noise: { pos: P3; room: string; radius: number; source: 'player' | 'door' | 'prop' | 'script' };
  'beat:enter': { id: string };
  'beat:exit': { id: string };
  flag: { name: string; value: boolean };
  checkpoint: { id: string };
  'player:death': { cause: string };
  'player:respawn': { checkpoint: string };
  'player:hide': { hideId: string; inside: boolean };
  'player:breath': { holding: boolean };
  interact: { id: string; action: string };
  'ai:state': { from: string; to: string };
  lightning: { strength: number; durationMs: number };
  thunder: { delayMs: number; durationMs: number; distance: number };
  'voice:play': { lineId: string };
  'voice:end': { lineId: string };
  subtitle: { speaker: string; text: string; durationMs: number } | null;
  'cutscene:start': { id: string };
  'cutscene:end': { id: string; skipped: boolean };
  'settings:changed': { key: string };
  pause: { paused: boolean };
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object = GameEvents> {
  private handlers = new Map<keyof E, Set<Handler<any>>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  once<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
