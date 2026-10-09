// Voice-script trigger → line ids. The AI and the story speak in trigger names (voice-script.json `trigger`), the
// VoicePlayer plays line ids. Pass the loaded script (src/audio/voice.ts loadVoiceScript) — this module never imports
// the JSON itself (runtime modules take data as arguments).

export interface VoiceLineRef {
  id: string;
  trigger: string;
  speaker: string;
}

export function buildTriggerIndex(lines: readonly VoiceLineRef[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const l of lines) (m.get(l.trigger) ?? m.set(l.trigger, []).get(l.trigger)!).push(l.id);
  return m;
}

/** Line ids for a trigger ('ai:catch' → driver's drowning + Ada's rush; unknown → []). */
export function linesForTrigger(index: Map<string, string[]>, trigger: string): string[] {
  return index.get(trigger) ?? [];
}

/** Every trigger the AI brain and the story can emit (tests check each exists in voice-script.json). */
export const AI_VOICE_TRIGGERS = [
  'ai:look_lift',
  'ai:hide_check_look',
  'ai:look_not_him',
  'ai:listen_end',
  'ai:proximity_5m',
  'ai:chase',
  'ai:vigil_long',
  'ai:search',
  'ai:lured_arrive',
  'ai:catch',
  'c4:hand_on_hem',
] as const;

export const STORY_VOICE_TRIGGERS = [
  'b02:first_knock',
  'b05:hide_enter',
  'b07:grate_peek',
  'b10:bell_nonstop_start',
  'b10:can_plate_seen',
  'b11:locket_raised',
  'b11:front_door_opens',
  'item:ticket_read',
  'doc:letter_read',
  'doc:ledger_p1',
  'doc:ledger_p2',
  'doc:ledger_p3',
] as const;
