/**
 * A key-value store on IndexedDB, one database per signed-in user, so two people who share a
 * browser never read each other's notes. No dependency: four calls cover what the offline layer
 * needs. Every call fails soft (resolves undefined / does nothing) where IndexedDB is missing or
 * blocked, as in some private windows; the app then simply works online only.
 */

const STORE = "kv";
export const DB_PREFIX = "nexus-offline-";

/** A stable, non-reversible key for a user: the database name never shows the email. */
export function userKey(email: string): string {
  // cyrb53: a fast 53-bit string hash. Enough to keep users apart on one device.
  const s = email.trim().toLowerCase();
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const done = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export type KV = {
  get: <T>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
  del: (key: string) => Promise<void>;
  close: () => void;
};

export async function openKV(name: string): Promise<KV | null> {
  if (typeof indexedDB === "undefined") return null;
  let db: IDBDatabase;
  try {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    db = await done(req);
  } catch {
    return null;
  }
  // Another tab deleting this database (signing out) must not be blocked by this connection.
  db.onversionchange = () => db.close();
  const tx = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  return {
    get: async <T>(key: string) => {
      try {
        return (await done(tx("readonly").get(key))) as T | undefined;
      } catch {
        return undefined;
      }
    },
    set: async (key, value) => {
      try {
        await done(tx("readwrite").put(value, key));
      } catch {}
    },
    del: async (key) => {
      try {
        await done(tx("readwrite").delete(key));
      } catch {}
    },
    close: () => db.close(),
  };
}

export async function deleteKV(name: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}
