// LOAD round (#157e): the prerendered sound bank, kept in IndexedDB between visits.
//
// The bank is pure output of OUR code (the seeded synth recipes + the seeded variation pass), so a repeat visit can
// read it back instead of synthesizing 314 variants again (measured: 3.3–4.9 s of synth per load, 71 MB of PCM; an
// IndexedDB read of the same data ≈ 90 ms + 26 ms to rebuild the AudioBuffers — scratch/load/idb-bench.mjs).
// Key = the audio code's own chunk URLs (Vite content hashes: any recipe / DSP / variation-pass change makes a new
// key) + the sample rate + the variant cap. A dev server (unhashed URLs) never caches. Every storage call is wrapped:
// blocked / private / quota-full storage simply means "synthesize", never an error.

const DB = 'the-keeping';
const STORE = 'audio-bank';
const VERSION = 1;

export interface CachedVariant {
  sampleRate: number;
  channels: Float32Array[];
}

export type CachedBank = Map<string, CachedVariant[]>;

/** The cache key for this build, or null when caching is off (dev server, no IndexedDB). */
export function bankKey(parts: { sampleRate: number; maxVariants?: number; variationPass?: boolean; urls: string[] }): string | null {
  try {
    // (a blocked-storage context may throw on the very access: typeof does not guard a throwing getter)
    if (typeof indexedDB === 'undefined' || !indexedDB) return null;
  } catch {
    return null;
  }
  // only content-hashed production chunks (…/name-AbCd1234.js): a dev URL does not change with the code
  if (!parts.urls.length || !parts.urls.every((u) => /-[A-Za-z0-9_-]{8}\.(js|mjs)(\?|$)/.test(u))) return null;
  return `bank-v${VERSION}|${parts.sampleRate}|${parts.maxVariants ?? 'all'}|${parts.variationPass === false ? 'dry' : 'var'}|${parts.urls.join('|')}`;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        try {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        } catch {
          /* resolve(null) via onerror */
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const done = (tx: IDBTransaction): Promise<boolean> =>
  new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });

/** The cached bank for `key`, or null (miss, other build, blocked storage). Never throws. */
export async function loadBank(key: string): Promise<CachedBank | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await open();
    if (!db) return null;
    const tx = db.transaction(STORE, 'readonly');
    const st = tx.objectStore(STORE);
    const rec = await new Promise<{ key: string; ids: string[]; variants: CachedVariant[][] } | null>((resolve) => {
      const r = st.get('bank');
      r.onsuccess = () => resolve((r.result as never) ?? null);
      r.onerror = () => resolve(null);
    });
    if (!rec || rec.key !== key || !Array.isArray(rec.ids) || !Array.isArray(rec.variants) || rec.ids.length !== rec.variants.length) return null;
    const bank: CachedBank = new Map();
    for (let i = 0; i < rec.ids.length; i++) {
      const vs = rec.variants[i];
      if (!Array.isArray(vs) || !vs.length || !vs.every((v) => v && v.sampleRate > 0 && Array.isArray(v.channels) && v.channels.length && v.channels.every((c) => c instanceof Float32Array))) return null;
      bank.set(rec.ids[i], vs);
    }
    return bank;
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

/** Stores the bank under `key` (one record: a half-written bank can never be read back). Never throws. */
export async function saveBank(key: string, bank: CachedBank): Promise<boolean> {
  let db: IDBDatabase | null = null;
  try {
    db = await open();
    if (!db) return false;
    const tx = db.transaction(STORE, 'readwrite');
    const ids = [...bank.keys()];
    tx.objectStore(STORE).put({ key, ids, variants: ids.map((id) => bank.get(id)!) }, 'bank');
    return await done(tx);
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}
