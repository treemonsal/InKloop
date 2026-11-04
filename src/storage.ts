import { type AppData, type Notebook, type Page, validateData } from "./model";

// Layout: "data" holds one small index per workspace (notebooks list pages by
// id only), "pages" holds every page as its own record. A save writes only the
// pages whose object identity changed, together with the index, atomically.
const DB = "inkloop-v1";
const DATA = "data";
const PAGES = "pages";
type StoredNotebook = Omit<Notebook, "pages"> & { pages: string[] };
type StoredIndex = Omit<AppData, "notebooks"> & {
  layout: "split";
  revision?: string;
  notebooks: StoredNotebook[];
};
// Revision each data object was read or written with. A save is incremental
// only if the stored index still carries the revision of `previous`.
const revisions = new WeakMap<object, string>();

let connection: Promise<IDBDatabase> | undefined;
function open() {
  return (connection ||= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA);
      if (!db.objectStoreNames.contains(PAGES)) db.createObjectStore(PAGES);
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => {
        db.close();
        connection = undefined;
      };
      resolve(db);
    };
    r.onerror = () => {
      connection = undefined;
      reject(r.error);
    };
    r.onblocked = () => {
      connection = undefined;
      reject(new Error("Bitte andere Inkloop-Fenster schliessen."));
    };
  }));
}

const pageKey = (workspace: string, id: string) => workspace + "\u0000" + id;
const pageRange = (workspace: string) =>
  IDBKeyRange.bound(workspace + "\u0000", workspace + "\u0001", false, true);
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const isSplit = (raw: unknown): raw is StoredIndex =>
  !!raw &&
  typeof raw === "object" &&
  (raw as { layout?: unknown }).layout === "split";

async function readRaw(workspace: string) {
  const db = await open();
  const tx = db.transaction([DATA, PAGES], "readonly");
  // All requests are issued synchronously so the transaction stays active.
  const [raw, keys, values] = await Promise.all([
    request(tx.objectStore(DATA).get(workspace)),
    request(tx.objectStore(PAGES).getAllKeys(pageRange(workspace))),
    request(tx.objectStore(PAGES).getAll(pageRange(workspace))),
  ]);
  if (!isSplit(raw))
    return { raw: raw as unknown, legacy: true, revision: undefined };
  const pages = new Map<string, Page>();
  keys.forEach((key, i) =>
    pages.set(String(key).slice(workspace.length + 1), values[i] as Page),
  );
  const { layout: _layout, revision: _revision, ...rest } = raw;
  void _layout;
  void _revision;
  return {
    legacy: false,
    revision: raw.revision,
    raw: {
      ...rest,
      notebooks: raw.notebooks.map((n) => ({
        ...n,
        pages: n.pages.map((id) => pages.get(id) ?? { id, missing: true }),
      })),
    } as unknown,
  };
}

/** Raw stored value in backup format, not validated (emergency export). */
export async function readStoredData(
  workspace = "workspace",
): Promise<unknown> {
  return (await readRaw(workspace)).raw;
}

export async function loadData(
  workspace = "workspace",
): Promise<AppData | null> {
  const { raw, legacy, revision } = await readRaw(workspace);
  if (!raw) return null;
  const data = validateData(raw);
  if (revision) revisions.set(data, revision);
  // Older versions kept everything in one record. Only valid data is migrated.
  if (legacy) await saveData(data, workspace, null);
  return data;
}

export async function saveData(
  data: AppData,
  workspace = "workspace",
  previous: AppData | null = null,
) {
  const db = await open();
  const revision = crypto.randomUUID();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([DATA, PAGES], "readwrite");
    const pages = tx.objectStore(PAGES);
    const index = tx.objectStore(DATA);
    const stored = index.get(workspace);
    stored.onsuccess = () => {
      // Incremental only if nobody else wrote since our last save or load.
      const trusted =
        previous &&
        isSplit(stored.result) &&
        !!stored.result.revision &&
        stored.result.revision === revisions.get(previous);
      const before = new Map<string, Page>();
      if (trusted)
        for (const n of previous.notebooks)
          for (const p of n.pages) before.set(p.id, p);
      const keep = new Set<string>();
      for (const n of data.notebooks)
        for (const p of n.pages) {
          keep.add(p.id);
          if (before.get(p.id) !== p) pages.put(p, pageKey(workspace, p.id));
        }
      if (trusted) {
        for (const id of before.keys())
          if (!keep.has(id)) pages.delete(pageKey(workspace, id));
      } else {
        const stale = pages.getAllKeys(pageRange(workspace));
        stale.onsuccess = () => {
          for (const key of stale.result)
            if (!keep.has(String(key).slice(workspace.length + 1)))
              pages.delete(key);
        };
      }
      const next: StoredIndex = {
        ...data,
        layout: "split",
        revision,
        notebooks: data.notebooks.map((n) => ({
          ...n,
          pages: n.pages.map((p) => p.id),
        })),
      };
      index.put(next, workspace);
    };
    tx.oncomplete = () => {
      revisions.set(data, revision);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Speichern abgebrochen."));
  });
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
