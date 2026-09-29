// Pure voice/subtitle timing (unit-tested; no DOM, no Web Audio).
//  - Subtitle-only fallback: lines without generated audio are timed at ~2.7 words/s (PLAN §2.9), with
//    punctuation pauses, a minimum on-screen time and a reading tail.
//  - Mapping ElevenLabs word timings (public/assets/voice/<clip>.json, produced by scripts/voices.mjs from the
//    character alignment, audio tags removed) onto the tag-free subtitle text.

import type { VoiceTiming } from '../shared/voice-types.ts';

export const WORDS_PER_SEC = 2.7;
export const MIN_SUBTITLE_SEC = 1.4;
/** Extra time a subtitle stays up after the last word so it can be finished reading. */
export const READ_TAIL_SEC = 0.6;

export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

/** public/assets/voice/index.json — written by `scripts/voices.mjs speak`. Absent = subtitle-only mode. */
export interface VoiceIndex {
  version: 1;
  generatedAt?: string;
  /** lineId → generated takes. `files[k]` is relative to the voice dir, e.g. "ada_harlan_1_v2.mp3"; timing JSON sits beside it. */
  clips: Record<string, { files: string[]; durations: number[] }>;
}

export function splitWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** Strip ElevenLabs audio tags like [whispers] / [exhales] and collapse whitespace. */
export function stripTags(text: string): string {
  return text.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
}

function pauseAfter(word: string): number {
  if (/(\.\.\.|…|—|–)$/.test(word)) return 0.45;
  if (/[.?!]["”’)]*$/.test(word)) return 0.35;
  if (/[,;:]["”’)]*$/.test(word)) return 0.18;
  return 0;
}

/**
 * Subtitle-only timing at `wps` words/s. Each word's share is weighted by its length (long words take longer to
 * say), punctuation adds pauses. Returns word spans and the total on-screen duration (including the read tail).
 */
export function fallbackTiming(text: string, wps = WORDS_PER_SEC): { words: TimedWord[]; durationSec: number; speechSec: number } {
  const words = splitWords(text);
  if (!words.length) return { words: [], durationSec: MIN_SUBTITLE_SEC, speechSec: 0 };
  const base = words.length / wps;
  const weights = words.map((w) => 0.55 + 0.45 * Math.min(3, w.replace(/[^\p{L}\p{N}']/gu, '').length / 5));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const out: TimedWord[] = [];
  let t = 0;
  words.forEach((w, i) => {
    const d = (base * weights[i]) / wsum;
    out.push({ text: w, start: t, end: t + d });
    t += d + (i < words.length - 1 ? pauseAfter(w) : 0);
  });
  const speechSec = t;
  return { words: out, durationSec: Math.max(MIN_SUBTITLE_SEC, speechSec + READ_TAIL_SEC), speechSec };
}

/**
 * Map generated word timings onto the subtitle's words. Equal counts map 1:1 (subtitle spelling wins). Otherwise
 * each subtitle word takes the proportional slice of the spoken span, so reveal still tracks the audio.
 */
export function mapTimingToSubtitle(subtitle: string, timing: Pick<VoiceTiming, 'words' | 'durationSec'>): TimedWord[] {
  const sub = splitWords(subtitle);
  const spoken = timing.words.filter((w) => stripTags(w.text).length > 0);
  if (!sub.length) return [];
  if (!spoken.length) {
    const d = timing.durationSec / sub.length;
    return sub.map((w, i) => ({ text: w, start: i * d, end: (i + 1) * d }));
  }
  if (spoken.length === sub.length) return sub.map((w, i) => ({ text: w, start: spoken[i].start, end: spoken[i].end }));
  const t0 = spoken[0].start;
  const t1 = spoken[spoken.length - 1].end;
  const n = sub.length;
  return sub.map((w, i) => {
    // proportional position in the spoken words, then in time
    const a = (i / n) * spoken.length;
    const b = ((i + 1) / n) * spoken.length;
    const ia = Math.min(spoken.length - 1, Math.floor(a));
    const ib = Math.min(spoken.length - 1, Math.max(ia, Math.ceil(b) - 1));
    return { text: w, start: Math.max(t0, spoken[ia].start), end: Math.min(t1, spoken[ib].end) };
  });
}

/** How many words are revealed at time t (a word appears when it starts). */
export function revealCount(words: readonly TimedWord[], t: number): number {
  let n = 0;
  for (const w of words) if (w.start <= t + 1e-6) n++;
  return n;
}

/**
 * ElevenLabs character alignment → words (the same algorithm scripts/voices.mjs uses when writing <clip>.json):
 * characters inside [audio tags] are dropped; whitespace separates words.
 */
export function alignmentToWords(a: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }): TimedWord[] {
  const out: TimedWord[] = [];
  let cur: TimedWord | null = null;
  let inTag = false;
  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i];
    if (ch === '[') { inTag = true; continue; }
    if (inTag) { if (ch === ']') inTag = false; continue; }
    if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    const s = a.character_start_times_seconds[i];
    const e = a.character_end_times_seconds[i];
    if (!cur) cur = { text: ch, start: s, end: e };
    else {
      cur.text += ch;
      cur.end = e;
    }
  }
  if (cur) out.push(cur);
  return out;
}
