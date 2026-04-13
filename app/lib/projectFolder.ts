/**
 * Project folder layout (File System Access API) + IndexedDB persistence.
 * Falls back to ordinary downloads when the API is unavailable or the user skips.
 */

const IDB_NAME = 'slicelab-project';
const IDB_STORE = 'kv';
const IDB_KEY_ROOT = 'directory';
const MANIFEST_NAME = 'project.json';

export type ProjectManifest = {
  version: 1;
  counters: {
    samplesZip: number;
    loopWav: number;
    grainWav: number;
    oneshotWav: number;
    /** Numbered batch ZIP exports from Oneshots (slicelab_oneshot_batch_NNN.zip). */
    oneshotBatchZip: number;
  };
};

const defaultManifest = (): ProjectManifest => ({
  version: 1,
  counters: {
    samplesZip: 0,
    loopWav: 0,
    grainWav: 0,
    oneshotWav: 0,
    oneshotBatchZip: 0,
  },
});

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function pickProjectDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) return null;
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    return null;
  }
}

export async function verifyWritableAccess(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const q = await handle.queryPermission({ mode: 'readwrite' });
    if (q === 'granted') return true;
    const r = await handle.requestPermission({ mode: 'readwrite' });
    return r === 'granted';
  } catch {
    return false;
  }
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
  });
}

export async function persistDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY_ROOT);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadPersistedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openIdb();
  const handle = await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY_ROOT);
    req.onsuccess = () => resolve(req.result as FileSystemDirectoryHandle | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return handle ?? null;
}

export async function clearPersistedDirectoryHandle(): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(IDB_KEY_ROOT);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function ensureNestedDir(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle> {
  const parts = path.split('/').filter(Boolean);
  let h = root;
  for (const p of parts) {
    h = await h.getDirectoryHandle(p, { create: true });
  }
  return h;
}

/** Creates source/, exports/samples/, exports/loops/, exports/grains/, exports/oneshots/ and writes project.json if missing. */
export async function ensureProjectLayout(root: FileSystemDirectoryHandle): Promise<void> {
  await ensureNestedDir(root, 'source');
  await ensureNestedDir(root, 'exports/samples');
  await ensureNestedDir(root, 'exports/loops');
  await ensureNestedDir(root, 'exports/grains');
  await ensureNestedDir(root, 'exports/oneshots');

  let hasManifest = false;
  try {
    await root.getFileHandle(MANIFEST_NAME);
    hasManifest = true;
  } catch {
    hasManifest = false;
  }
  if (!hasManifest) {
    const fh = await root.getFileHandle(MANIFEST_NAME, { create: true });
    const w = await fh.createWritable();
    await w.write(new Blob([JSON.stringify(defaultManifest(), null, 2)], { type: 'application/json' }));
    await w.close();
  }
}

async function readManifest(root: FileSystemDirectoryHandle): Promise<ProjectManifest> {
  try {
    const fh = await root.getFileHandle(MANIFEST_NAME);
    const file = await fh.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text) as ProjectManifest;
    if (parsed?.version === 1 && parsed.counters) {
      const c = parsed.counters;
      if (typeof c.oneshotWav !== 'number') c.oneshotWav = 0;
      if (typeof c.oneshotBatchZip !== 'number') c.oneshotBatchZip = 0;
      return parsed;
    }
  } catch {
    /* new */
  }
  return defaultManifest();
}

async function writeManifest(root: FileSystemDirectoryHandle, m: ProjectManifest): Promise<void> {
  const fh = await root.getFileHandle(MANIFEST_NAME, { create: true });
  const w = await fh.createWritable();
  await w.write(new Blob([JSON.stringify(m, null, 2)], { type: 'application/json' }));
  await w.close();
}

async function writeBlobToDir(dir: FileSystemDirectoryHandle, name: string, blob: Blob): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  await writable.write(blob);
  await writable.close();
}

function sanitizeFileName(name: string): string {
  const base = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'source';
  return base.length > 200 ? base.slice(0, 200) : base;
}

async function fileExistsInDir(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

export async function saveSourceFileCopy(
  root: FileSystemDirectoryHandle,
  file: File,
): Promise<{ ok: true; relativePath: string } | { ok: false; error: string }> {
  try {
    const sourceDir = await ensureNestedDir(root, 'source');
    let name = sanitizeFileName(file.name);
    if (!(name.toLowerCase().endsWith('.wav') || name.toLowerCase().match(/\.(mp3|m4a|aac|ogg|flac)$/i))) {
      if (!name.includes('.')) name = `${name}.audio`;
    }
    let finalName = name;
    let n = 2;
    while (await fileExistsInDir(sourceDir, finalName)) {
      const m = name.match(/^(.+)(\.[^.]+)$/);
      if (m) finalName = `${m[1]}_${n}${m[2]}`;
      else finalName = `${name}_${n}`;
      n += 1;
    }
    const buf = await file.arrayBuffer();
    await writeBlobToDir(sourceDir, finalName, new Blob([buf], { type: file.type || 'application/octet-stream' }));
    return { ok: true, relativePath: `source/${finalName}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'write failed' };
  }
}

export type ExportKind =
  | 'samplesZip'
  | 'loopWav'
  | 'grainWav'
  | 'oneshotWav'
  | 'oneshotBatchZip';

export async function saveExportFile(
  root: FileSystemDirectoryHandle,
  kind: ExportKind,
  blob: Blob,
): Promise<{ ok: true; relativePath: string; fileName: string } | { ok: false; error: string }> {
  try {
    const manifest = await readManifest(root);
    let sub: string;
    let ext: string;
    let base: string;
    let counterKey: keyof ProjectManifest['counters'];

    switch (kind) {
      case 'samplesZip':
        sub = 'exports/samples';
        ext = 'zip';
        base = 'slicelab_samples';
        counterKey = 'samplesZip';
        break;
      case 'loopWav':
        sub = 'exports/loops';
        ext = 'wav';
        base = 'slicelab_loop';
        counterKey = 'loopWav';
        break;
      case 'grainWav':
        sub = 'exports/grains';
        ext = 'wav';
        base = 'slicelab_grain';
        counterKey = 'grainWav';
        break;
      case 'oneshotWav':
        sub = 'exports/oneshots';
        ext = 'wav';
        base = 'slicelab_oneshot';
        counterKey = 'oneshotWav';
        break;
      case 'oneshotBatchZip':
        sub = 'exports/oneshots';
        ext = 'zip';
        base = 'slicelab_oneshot_batch';
        counterKey = 'oneshotBatchZip';
        break;
      default: {
        const _exhaustive: never = kind;
        return { ok: false, error: `unknown export kind: ${_exhaustive}` };
      }
    }

    manifest.counters[counterKey] += 1;
    const num = manifest.counters[counterKey];
    const fileName = `${base}_${String(num).padStart(3, '0')}.${ext}`;

    const dir = await ensureNestedDir(root, sub);
    await writeBlobToDir(dir, fileName, blob);
    await writeManifest(root, manifest);

    return { ok: true, relativePath: `${sub}/${fileName}`, fileName };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'write failed' };
  }
}

/** Browser download fallback. */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
