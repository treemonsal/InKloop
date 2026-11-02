import { type AppData, parseBackup } from "./model";
const DB = "inkloop-v1";
let connection: Promise<IDBDatabase> | undefined;
function open() {
  return (connection ||= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("data");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () =>
      reject(new Error("Bitte andere Inkloop-Fenster schließen."));
  }));
}
export async function readStoredData(): Promise<unknown> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("data", "readonly");
    const r = tx.objectStore("data").get("workspace");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function loadData(): Promise<AppData | null> {
  const raw = await readStoredData();
  return raw ? parseBackup(JSON.stringify(raw), Infinity) : null;
}
export async function saveData(data: AppData) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("data", "readwrite");
    tx.objectStore("data").put(data, "workspace");
    tx.oncomplete = () => resolve();
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
