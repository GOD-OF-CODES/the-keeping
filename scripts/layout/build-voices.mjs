#!/usr/bin/env node
// Generates src/shared/voice-script.json (schema: src/shared/voice-types.ts). Consumed by scripts/voices.mjs and
// src/audio/voice.ts. All voices are DESIGNED from the descriptions below (ElevenLabs Voice Design, no library voices);
// every line is original. Sparse on purpose: silence and sound carry the dread.
// Triggers are `scope:event` strings raised by src/story, src/ai and src/cutscenes. beat = Bnn, AI (systemic) or ANY.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const speakers = [
  {
    id: 'driver',
    displayName: 'The Driver',
    voiceDescription:
      'A man in his mid-thirties, American, from somewhere flat and Midwestern. Tired and a little hoarse after six hours behind the wheel at night, soft-spoken and close to the microphone, as if talking to himself inside a small car. An ordinary, decent man, not a hero: when he is frightened the voice thins, catches and drops to a whisper, his breathing goes shallow, but he keeps it low and holds himself together. Dry, intimate, no reverb.',
    previewText:
      "Come on... come on, don't do this to me. Forty-eight miles to anything, and the needle's been sitting under the E since the county line. There's a light up there on the rise. A sign. Rooms. Okay. Okay, that's fine, somebody's awake at least. They'll have to put me up for the night. I'll pay whatever they want, I just need somewhere dry until morning.",
    seed: 3194,
    settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, speed: 0.95, use_speaker_boost: true },
    defaultChain: 'in_head',
  },
  {
    id: 'harlan',
    displayName: 'Harlan Stroud',
    voiceDescription:
      'An old rural American man in his sixties, big-chested and stooped. A deep, gravelly, nearly toneless monotone; slow words with long gaps between them and heavy breath through the nose. Quiet, patient menace, never raises his voice, sounds worn down to the bone. Flat Plains accent. Muffled and close, as though he is speaking through a coarse burlap sack pulled over his head.',
    previewText:
      "Rain's been on the road since noon. They always come in the rain. You hear the bell, you come on in, that's all there is to it. I don't do the taking. Never did. I just keep the door and I keep the book, and I sharpen what needs sharpening. Go on, then. Go on up. She'll find you, friend. She always does.",
    seed: 1110,
    settings: { stability: 0.72, similarity_boost: 0.8, style: 0.1, speed: 0.85, use_speaker_boost: true },
    defaultChain: 'sack',
  },
  {
    id: 'ada',
    displayName: 'Ada Stroud',
    voiceDescription:
      'A woman in her late twenties from a small rural town in 1970s America, a seamstress. Warm, low and slightly husky; exhausted but quietly determined, choosing each word with care, with a thread of dry humour under the tiredness. Intimate and unhurried, close to the microphone. When she whispers the voice becomes breathy, wet and broken, catching on the edges of the words.',
    previewText:
      "Ruthie, it's late and my hands are shaking, so forgive the writing. I've got it all worked out this time. Tuesday, the six-ten, the early one, before he's up. I've sewn what matters where he won't look. Don't write back to the house. Don't tell Mama. Just be there, at the depot, the way you promised, and if I'm late, wait for me. I'll come. Whatever it takes, I'll come.",
    seed: 1968,
    settings: { stability: 0.35, similarity_boost: 0.75, style: 0.35, speed: 0.9, use_speaker_boost: true },
    defaultChain: 'revenant',
  },
  {
    id: 'traveler2',
    displayName: 'The Next Traveler',
    voiceDescription:
      'A woman in her forties, American, polite and nervous, rain-soaked and short of breath from hurrying up a porch in a storm. Mid-pitched, slightly apologetic, trying hard to sound friendly to a stranger\'s door late at night. Natural and clear, close to the microphone.',
    previewText:
      "Oh, thank God. Rooms. Okay. Hello? Hi, I'm so sorry, I know how late it is, I saw the sign from the road. My car ran out of gas about a mile back, and there's nothing out here, no phone, nothing. I can pay. I just need somewhere dry until it's light. Hello? Is anyone there? I heard the bell ring. I'm sorry to bother you.",
    seed: 4127,
    settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2, speed: 1.0, use_speaker_boost: true },
    defaultChain: 'clean',
  },
];

const lines = [];
/** L(id, speaker, beat, trigger, text, subtitle, o) */
function L(id, speaker, beat, trigger, text, subtitle, o = {}) {
  lines.push({
    id, speaker, text, subtitle,
    ...(o.caption ? { caption: o.caption } : {}),
    beat, trigger,
    chain: o.chain ?? speakers.find((s) => s.id === speaker).defaultChain,
    kind: o.kind ?? 'line',
    variants: o.variants ?? 1,
    ...(o.prev ? { previousText: o.prev } : {}),
    ...(o.next ? { nextText: o.next } : {}),
    priority: o.priority ?? 5,
    milestone: o.ms ?? 'M1',
  });
}

// ------------------------------------------------------------ THE DRIVER (spoken, sparse)
L('b01_come_on', 'driver', 'B01', 'c1:fuel_chime',
  "[tired, under his breath] Come on... [exhales] come on, don't do this to me.",
  "Come on… come on, don't do this to me.", { priority: 6 });
L('b01_put_me_up', 'driver', 'B01', 'c1:engine_dead',
  "[quietly, to himself] Forty-eight miles to anything... [sighs] They'll have to put me up for the night.",
  "Forty-eight miles to anything. They'll have to put me up for the night.", { priority: 8 });
L('b02_hello', 'driver', 'B02', 'b02:first_knock',
  "[raising his voice over the rain, hesitant] Hello? [short pause] ...Sorry to bother you this late. My car ran out of gas.",
  "Hello? …Sorry to bother you this late. My car ran out of gas.", { priority: 7 });
L('b04_door_rattle', 'driver', 'B04', 'b04:front_door_rattle',
  "[panicked, breathless whisper] No, no, no, come on, open—",
  "No, no, no, come on, open—", { chain: 'whisper_in_head', priority: 7 });
L('b05_dont_breathe', 'driver', 'B05', 'b05:hide_enter',
  "[whispers, shaking] Don't breathe. [short, shaky breath] Don't breathe.",
  "Don't breathe. Don't breathe.", { chain: 'whisper_in_head', priority: 8 });
L('b07_my_car', 'driver', 'B07', 'c3:flash_car',
  "[barely audible, stunned] That's... [swallows] that's my car.",
  "That's… that's my car.", { chain: 'whisper_in_head', priority: 8, ms: 'M2' });
L('b09_ticket', 'driver', 'B09', 'item:ticket_read',
  "[reading under his breath] Carvel, six-ten... Tuesday, October twelfth. [pause] Nineteen seventy-six.",
  'Carvel, 6:10… Tuesday, October 12th. 1976.', { chain: 'whisper_in_head', priority: 4, ms: 'M2' });
L('b10_my_plate', 'driver', 'B10', 'b10:can_plate_seen',
  "[whispers] R-V-X... [swallows hard] that's my plate.",
  "RVX… that's my plate.", { chain: 'whisper_in_head', priority: 8, ms: 'M2' });
L('b11_look', 'driver', 'B11', 'b11:locket_raised',
  "[a shaking, pleading whisper] Look. [breath] It's him. [breath] It's him you want.",
  "Look. It's him. It's him you want.", { chain: 'whisper_in_head', priority: 9, ms: 'M2' });
L('b12_catches', 'driver', 'B12', 'c6:engine_catches',
  "[half laughing, half crying] Come on... come on— [exhales hard] yes. Yes.",
  'Come on… come on— yes. Yes.', { priority: 8, ms: 'M2', prev: "Come on... come on, don't do this to me." });

// ------------------------------------------------------------ DRIVER vocal bank (no subtitle, caption only)
const V = (id, trigger, text, caption, variants, o = {}) => L(id, 'driver', o.beat ?? 'ANY', trigger, text, '', { kind: 'vocal', caption, variants, priority: o.priority ?? 3, chain: o.chain ?? 'in_head', ms: o.ms ?? 'M1' });
V('drv_breath_calm', 'player:breath_calm', '[slow, tired breathing through the nose] Hhh... hhh...', '(breathing)', 3, { priority: 1 });
V('drv_breath_scared', 'player:breath_scared', '[fast, shallow, frightened breathing] Hh— hh— hhh— hh—', '(frightened breathing)', 3, { priority: 2 });
V('drv_breath_hold', 'player:breath_hold_start', '[sharp inhale, then holds his breath] Hhp— mm.', '(holds breath)', 2, { chain: 'whisper_in_head', priority: 4 });
V('drv_breath_strain', 'player:breath_hold_strain', '[straining to hold his breath, a tiny leak through the nose] Mmm— mm—', '(straining to hold breath)', 2, { chain: 'whisper_in_head', priority: 4 });
V('drv_breath_release', 'player:breath_hold_release', '[slow, silent, shaking exhale, trying not to make a sound] Hhhhh...', '(shaky exhale)', 3, { chain: 'whisper_in_head', priority: 4 });
V('drv_gasp', 'player:gasp', '[a sudden gasp for air he can\'t hold back] Hhah—!', '(gasps)', 3, { priority: 7 });
V('drv_panting', 'player:panting', '[panting hard after running, trying to be quiet] Hah... hah... hah... hah...', '(panting)', 4, { priority: 3 });
V('drv_whimper', 'player:whimper', '[a stifled whimper, lips pressed shut] Mm— nnh.', '(stifled whimper)', 2, { chain: 'whisper_in_head', priority: 3 });
V('drv_startle', 'player:startle', '[startled sharp intake of breath, frozen] Hh—', '(sharp breath)', 3, { priority: 6 });
V('drv_threshold', 'b03:threshold_freeze', '[a sharp intake of breath that stops dead, then nothing, he cannot breathe]  Hh—', '(breath catches)', 1, { beat: 'B03', priority: 8 });
V('drv_pry_effort', 'b08:pry_hold', '[quiet grunt of effort through clenched teeth] Nngh... hhn...', '(straining)', 3, { beat: 'B08', priority: 3, ms: 'M2' });
V('drv_death', 'ai:catch', '[choking, a wet hand over his mouth, drowning] Hgh— ghh— mmf—', '(choking)', 2, { priority: 10 });
V('drv_relief', 'b11:front_door_opens', '[a long, trembling exhale of disbelief] Hhhhhh... oh...', '(trembling breath)', 1, { beat: 'B11', priority: 6, ms: 'M2' });

// ------------------------------------------------------------ ADA (revenant: same voice, whispered, processed at runtime)
L('ada_look_harlan', 'ada', 'AI', 'ai:look_lift',
  '[a wet, broken whisper, searching] ...Harlan?', '…Harlan?', { variants: 5, priority: 6 });
L('ada_look_harlan_close', 'ada', 'AI', 'ai:hide_check_look',
  '[whispers, inches away, trembling, waterlogged] Har... lan?', '…Harlan?', { variants: 3, priority: 7 });
L('ada_not_him', 'ada', 'AI', 'ai:look_not_him',
  '[a disappointed, gurgling exhale, water in the throat] Hhhh— ghh...', '', { kind: 'vocal', caption: '(a wet, disappointed breath)', variants: 4, priority: 5 });
L('ada_wet_breath', 'ada', 'AI', 'ai:listen_end',
  '[slow, bubbling, waterlogged breathing] Hhhh... hhhh...', '', { kind: 'vocal', caption: '(wet breathing)', variants: 4, priority: 2 });
L('ada_gurgle', 'ada', 'AI', 'ai:proximity_5m',
  '[a low gurgle deep in the throat] Ghhhh...', '', { kind: 'vocal', caption: '(gurgling, close)', variants: 3, priority: 4 });
L('ada_chase_breath', 'ada', 'AI', 'ai:chase',
  '[ragged, wet, gasping breaths while lurching forward] Hah— hhah— hah—', '', { kind: 'vocal', caption: '(ragged wet breathing, coming fast)', variants: 3, priority: 5 });
L('ada_vigil_whisper', 'ada', 'AI', 'ai:vigil_long',
  '[barely a whisper, forehead against the wood] ...my room...', '…my room…', { variants: 2, priority: 2 });
L('ada_search_whisper', 'ada', 'AI', 'ai:search',
  '[whispering, wet, drifting] ...where are you...', '…where are you…', { variants: 2, priority: 3, ms: 'M2' });
L('ada_lured_whisper', 'ada', 'AI', 'ai:lured_arrive',
  '[whispering against a door, patient, wet] ...Harlan... I hear you...', '…Harlan… I hear you…', { chain: 'through_floor', variants: 2, priority: 4, ms: 'M2' });
L('ada_catch', 'ada', 'AI', 'ai:catch',
  '[a sudden wet rush of breath right against the face] Hhhaaah—', '', { kind: 'vocal', caption: '(a wet breath against your face)', variants: 2, priority: 10 });
L('b09_dress_sob', 'ada', 'B09', 'c4:hand_on_hem',
  '[a near-sob, wet and breaking, almost no voice] ...my ticket... [a shuddering, bubbling breath] hhh...', '…my ticket…', { priority: 9, ms: 'M2' });
L('b11_recognition', 'ada', 'B11', 'c5:recognition',
  '[a long wet breath, then softly, with terrible certainty] ...Harlan.', '…Harlan.', { priority: 10, ms: 'M2', prev: '...Harlan?' });

// Ada in 1976 — her unsent letter, read in her living voice (memory chain). <= 60 words, ends mid-word.
L('doc_letter', 'ada', 'B09', 'doc:letter_read',
  "[warm, tired, determined, reading her own letter aloud] Ruthie. Tuesday, the six-ten to Carvel. He found the tin, so the ticket's sewn in the hem of my wedding dress, with the locket. [pause] I can't wear his face anymore, but I won't leave it for him. [quieter] He says he'll put me down the well first. [a small, defiant breath] Let him try. I'll be at the depot if I have to wa—",
  "Ruthie, Tuesday, the 6:10 to Carvel. He found the tin, so the ticket's sewn in the hem of my wedding dress, with the locket. I can't wear his face anymore, but I won't leave it for him. He says he'll put me down the well first. Let him try. I'll be at the depot if I have to wa—",
  { kind: 'reading', chain: 'memory', priority: 6, ms: 'M2' });

// ------------------------------------------------------------ HARLAN (5–7 rare, slow lines + his ledger)
L('b03_go_on', 'harlan', 'B03', 'c2:rope_slip',
  '[low, slow, flat, through a burlap sack] Go on, then.', 'Go on, then.', { priority: 10 });
L('b07_grate', 'harlan', 'B07', 'b07:grate_peek',
  '[slow, muffled, tilting his head up toward the ceiling] She\'ll find you, friend. [a long breath through the sack] She always does.',
  "She'll find you, friend. She always does.", { chain: 'through_floor', priority: 8, ms: 'M2' });
L('b10_company', 'harlan', 'B10', 'b10:bell_nonstop_start',
  '[flat, patient, calling through the wall over a ringing bell] Come on, Ada. [pause] Company.',
  'Come on, Ada. Company.', { chain: 'through_floor', priority: 8, ms: 'M2' });
L('c5_door_crack', 'harlan', 'B11', 'c5:door_crack',
  '[a startled, hoarse whisper through the sack] Ada?... [his breath catches] No. No, no—',
  'Ada?… No. No, no—', { priority: 10, ms: 'M2' });
const P1 = "Oct 14 '76. She came up out of the well. Did like Mother's book says: took the head, gave it back to the water. Holds her one night. Nailed her room shut. She can't get past nails, just stands there scratching. I won't go in either.";
const P2 = "She can't find me if she can't see me. Covered the glass. Cut myself out of the pictures. Sleep in the sack. She goes close to every face she finds, hunting mine. If she ever sees it she'll know me, and that's the end of me. Only picture left went down the well with her, in her locket.";
const P3 = "Every pull in the house rings in the parlor now. She always comes to the bell. Always did. She can't hear a thing under thunder. The drifter kept her quiet a month. Did the Pruitt boy myself; didn't hold her an hour. She has to take them herself. She works the latches now. She learns.";
L('doc_ledger_1', 'harlan', 'B06', 'doc:ledger_p1',
  "[slow, flat, reading his own ledger, tired] October fourteen, seventy-six. She came up out of the well. [pause] Did like Mother's book says: took the head, gave it back to the water. Holds her one night. [pause] Nailed her room shut. She can't get past nails, just stands there scratching. [low] I won't go in either.",
  P1, { kind: 'reading', chain: 'memory', priority: 6, ms: 'M2', next: P2.slice(0, 60) });
L('doc_ledger_2', 'harlan', 'B06', 'doc:ledger_p2',
  "[slow, flat, reading] She can't find me if she can't see me. Covered the glass. Cut myself out of the pictures. Sleep in the sack. [pause] She goes close to every face she finds, hunting mine. [lower, almost afraid] If she ever sees it she'll know me, and that's the end of me. [pause] Only picture left went down the well with her. In her locket.",
  P2, { kind: 'reading', chain: 'memory', priority: 6, ms: 'M2', prev: P1.slice(-60), next: P3.slice(0, 60) });
L('doc_ledger_3', 'harlan', 'B06', 'doc:ledger_p3',
  "[slow, flat, reading] Every pull in the house rings in the parlor now. She always comes to the bell. [pause] Always did. [pause] She can't hear a thing under thunder. [pause] The drifter kept her quiet a month. Did the Pruitt boy myself; didn't hold her an hour. She has to take them herself. [a long breath] She works the latches now. [quietly] She learns.",
  P3, { kind: 'reading', chain: 'memory', priority: 6, ms: 'M2', prev: P2.slice(-60) });

// ------------------------------------------------------------ THE NEXT TRAVELER (C7 sting, shot for shot)
L('b13_rooms', 'traveler2', 'B13', 'c7:sign_seen',
  '[relieved, to herself, breathless] Oh, thank God. [exhales] Rooms.', 'Oh, thank God. Rooms.', { priority: 6, ms: 'M2' });
L('b13_hello', 'traveler2', 'B13', 'c7:knock',
  "[raising her voice over the rain, polite, nervous] Hello? [short pause] ...Sorry to bother you this late. My car ran out of gas.",
  'Hello? …Sorry to bother you this late. My car ran out of gas.', { priority: 7, ms: 'M2' });
L('b13_gasp', 'traveler2', 'B13', 'c7:tableau',
  '[a sharp gasp that stops dead in her throat] Hh—', '', { kind: 'vocal', caption: '(a gasp)', priority: 8, ms: 'M2' });

const script = { version: 1, model: 'eleven_v3', designModel: 'eleven_ttv_v3', outputFormat: 'mp3_44100_128', speakers, lines };
writeFileSync(resolve(ROOT, 'src/shared/voice-script.json'), JSON.stringify(script, null, 1) + '\n');
const takes = lines.reduce((a, l) => a + l.variants, 0);
console.log(`voice-script.json: ${speakers.length} speakers, ${lines.length} lines, ${takes} takes, ${lines.reduce((a, l) => a + l.text.length * l.variants, 0)} TTS chars`);
