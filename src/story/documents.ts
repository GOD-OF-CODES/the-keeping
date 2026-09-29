// Readable documents (DESIGN "Items & documents"). Every text is ≤ 60 words (tests/story.test.ts checks it) and
// the ledger / letter match src/shared/voice-script.json's doc_* lines word for word (they are also read aloud).
// The world lane's placeholder DOCS in src/world/interactables.ts should be replaced by these (see docs/AI.md).

export type DocId = 'guest_book' | 'guest_book_sting' | 'ledger_p1' | 'ledger_p2' | 'ledger_p3' | 'letter' | 'ticket' | 'portrait' | 'pump_photo' | 'can_plate';

export interface GuestLine {
  date: string;
  name: string;
  vehicle: string;
  ruled: boolean;
}

export interface StoryDocument {
  id: DocId;
  title: string;
  /** Plain text for the journal (Tab) and the reading overlay. */
  text: string;
  /** Voice-script trigger to play when it is read (null = silent). */
  voiceTrigger: string | null;
  /** Guest book only: structured lines for the handwriting renderer (ruled through or not). */
  lines?: GuestLine[];
}

const GUESTS: GuestLine[] = [
  { date: '11/3/77', name: 'drifter', vehicle: 'on foot', ruled: true },
  { date: '6/22/79', name: 'D. Pruitt', vehicle: "'72 Dodge Dart", ruled: true },
  { date: '2/9/81', name: 'R. Haskett', vehicle: 'Ford pickup', ruled: true },
  { date: '8/14/83', name: 'M. Voss', vehicle: 'Buick', ruled: true },
  { date: '3/2/85', name: 'hitcher', vehicle: 'on foot', ruled: true },
  { date: '10/30/86', name: 'T. Brandt', vehicle: 'Chevelle', ruled: true },
  { date: '5/19/88', name: 'J. Okafor', vehicle: 'Datsun', ruled: true },
  { date: '12/1/89', name: 'C. Lusk', vehicle: 'Rambler', ruled: true },
  { date: '7/7/91', name: 'A. Pell', vehicle: 'Pontiac', ruled: true },
  { date: '9/26/92', name: 'K. Rourke', vehicle: 'Plymouth', ruled: true },
  { date: '4/4/94', name: 'S. Tamm', vehicle: 'Honda', ruled: true },
];

const guestText = (lines: GuestLine[]): string =>
  ['GUESTS. Date, name, vehicle.', ...lines.map((l) => `${l.date} ${l.name}${l.vehicle ? `, ${l.vehicle}` : ''}`.trim())].join('\n');

const TONIGHT: GuestLine = { date: '10/11/94', name: '', vehicle: '', ruled: false };
const STING: GuestLine[] = [{ date: '10/11/94', name: 'HARLAN', vehicle: '', ruled: true }, { date: '', name: '', vehicle: '', ruled: false }];

export const DOCUMENTS: Record<DocId, StoryDocument> = {
  guest_book: { id: 'guest_book', title: 'Guest book', text: guestText([...GUESTS, TONIGHT]), voiceTrigger: null, lines: [...GUESTS, TONIGHT] },
  guest_book_sting: { id: 'guest_book_sting', title: 'Guest book', text: guestText([...GUESTS, ...STING]), voiceTrigger: null, lines: [...GUESTS, ...STING] },
  ledger_p1: {
    id: 'ledger_p1',
    title: 'Ledger, page 1',
    text: "Oct 14 '76. She came up out of the well. Did like Mother's book says: took the head, gave it back to the water. Holds her one night.\n\nNailed her room shut. She can't get past nails, just stands there scratching. I won't go in either.",
    voiceTrigger: 'doc:ledger_p1',
  },
  ledger_p2: {
    id: 'ledger_p2',
    title: 'Ledger, page 2',
    text: "She can't find me if she can't see me. Covered the glass. Cut myself out of the pictures. Sleep in the sack. She goes close to every face she finds, hunting mine. If she ever sees it she'll know me, and that's the end of me. Only picture left went down the well with her, in her locket.",
    voiceTrigger: 'doc:ledger_p2',
  },
  ledger_p3: {
    id: 'ledger_p3',
    title: 'Ledger, page 3',
    text: "Every pull in the house rings in the parlor now. She always comes to the bell. Always did.\n\nShe can't hear a thing under thunder.\n\nThe drifter kept her quiet a month. Did the Pruitt boy myself; didn't hold her an hour. She has to take them herself.\n\nShe works the latches now. She learns.",
    voiceTrigger: 'doc:ledger_p3',
  },
  letter: {
    id: 'letter',
    title: 'Letter, never sent',
    text: "Ruthie, Tuesday, the 6:10 to Carvel. He found the tin, so the ticket's sewn in the hem of my wedding dress, with the locket. I can't wear his face anymore, but I won't leave it for him. He says he'll put me down the well first. Let him try. I'll be at the depot if I have to wa—",
    voiceTrigger: 'doc:letter_read',
  },
  ticket: { id: 'ticket', title: 'Bus ticket', text: 'CARVEL 6:10, TUE OCT 12 1976. One way. Never punched.', voiceTrigger: 'item:ticket_read' },
  portrait: { id: 'portrait', title: 'Wedding portrait', text: "A bride, veiled, in a lace wedding dress. The groom's face has been cut out with a knife.", voiceTrigger: null },
  pump_photo: { id: 'pump_photo', title: "Stroud's Gas & Feed, 1970", text: "A couple at the pump under the old sign. The man's face is knifed out.", voiceTrigger: null },
  can_plate: { id: 'can_plate', title: 'Jerry can', text: 'Chalked on the side of an empty can: RVX-318.', voiceTrigger: 'b10:can_plate_seen' },
};

/** Interaction action (layout props[].interaction) → document. read_ledger pages through p1 → p2 → p3. */
export const DOC_FOR_ACTION: Record<string, DocId> = {
  read_guest_book: 'guest_book',
  examine_portrait: 'portrait',
  examine_pump_photo: 'pump_photo',
  read_letter: 'letter',
  read_ticket: 'ticket',
  read_can_plate: 'can_plate',
};

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}
