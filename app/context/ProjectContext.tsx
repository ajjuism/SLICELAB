'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  clearPersistedDirectoryHandle,
  ensureProjectLayout,
  isFileSystemAccessSupported,
  loadPersistedDirectoryHandle,
  persistDirectoryHandle,
  pickProjectDirectory,
  saveExportFile,
  saveSourceFileCopy,
  triggerBlobDownload,
  verifyWritableAccess,
} from '../lib/projectFolder';

const SKIP_KEY = 'slicelab-skip-project-folder';

/**
 * `supported` must not flip from false→true between server HTML and the first hydrated client render.
 * useSyncExternalStore + getServerSnapshot keeps the first client paint aligned with SSR, then notifies.
 */
function subscribeHydrated(onStoreChange: () => void): () => void {
  queueMicrotask(() => {
    onStoreChange();
  });
  return () => {};
}

function getHydratedSnapshot(): boolean {
  return true;
}

function getHydratedServerSnapshot(): boolean {
  return false;
}

export type ProjectMode = 'loading' | 'unset' | 'folder' | 'downloads';

/** Shown after a successful write to the project folder. */
export type ProjectSaveNotice = {
  id: string;
  folderName: string;
  relativePath: string;
  kindLabel: string;
};

function newNoticeId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

type Ctx = {
  mode: ProjectMode;
  /** Display name (folder name when using project folder). */
  label: string;
  supported: boolean;
  /** Project folder is active (exports go to disk). */
  hasProjectFolder: boolean;
  /** Transient confirmation after saving into the project folder. */
  saveNotice: ProjectSaveNotice | null;
  dismissSaveNotice: () => void;
  /** Copy `folder/relativePath` for pasting into Finder, Explorer, etc. */
  copySavedPath: (notice: ProjectSaveNotice) => Promise<void>;
  /** Open system folder picker and connect. */
  connectFolder: () => Promise<void>;
  /** Use browser downloads only; dismiss onboarding. */
  useDownloadsOnly: () => void;
  /** Disconnect project folder (future picks require new onboarding from settings). */
  disconnectFolder: () => Promise<void>;
  trySaveZip: (blob: Blob) => Promise<boolean>;
  trySaveLoop: (blob: Blob) => Promise<boolean>;
  trySaveGrain: (blob: Blob) => Promise<boolean>;
  trySaveOneshot: (blob: Blob) => Promise<boolean>;
  onSourceFileLoaded: (file: File) => Promise<void>;
  /** For onboarding modal visibility */
  showOnboarding: boolean;
  dismissOnboarding: () => void;
  /** Show folder picker / onboarding again (e.g. from top bar). */
  promptProjectSetup: () => void;
};

const ProjectContext = createContext<Ctx | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ProjectMode>('loading');
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderName, setFolderName] = useState<string>('');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [saveNotice, setSaveNotice] = useState<ProjectSaveNotice | null>(null);
  const saveNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useSyncExternalStore(subscribeHydrated, getHydratedSnapshot, getHydratedServerSnapshot);
  const supported = hydrated && isFileSystemAccessSupported();
  const initDone = useRef(false);

  const dismissSaveNotice = useCallback(() => {
    if (saveNoticeTimerRef.current) {
      clearTimeout(saveNoticeTimerRef.current);
      saveNoticeTimerRef.current = null;
    }
    setSaveNotice(null);
  }, []);

  const pushSaveNotice = useCallback((folder: string, relativePath: string, kindLabel: string) => {
    if (saveNoticeTimerRef.current) clearTimeout(saveNoticeTimerRef.current);
    setSaveNotice({
      id: newNoticeId(),
      folderName: folder,
      relativePath,
      kindLabel,
    });
    saveNoticeTimerRef.current = setTimeout(() => {
      setSaveNotice(null);
      saveNoticeTimerRef.current = null;
    }, 12000);
  }, []);

  const copySavedPath = useCallback(async (notice: ProjectSaveNotice) => {
    const text = `${notice.folderName}/${notice.relativePath}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }, []);

  const applyRoot = useCallback(async (handle: FileSystemDirectoryHandle | null) => {
    if (!handle) {
      setRoot(null);
      setFolderName('');
      setMode('downloads');
      return;
    }
    const ok = await verifyWritableAccess(handle);
    if (!ok) {
      setRoot(null);
      setFolderName('');
      setMode('downloads');
      await clearPersistedDirectoryHandle();
      return;
    }
    await ensureProjectLayout(handle);
    setRoot(handle);
    setFolderName(handle.name);
    setMode('folder');
    await persistDirectoryHandle(handle);
  }, []);

  useEffect(() => {
    return () => {
      if (saveNoticeTimerRef.current) clearTimeout(saveNoticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (initDone.current) return;
    initDone.current = true;

    void (async () => {
      if (!isFileSystemAccessSupported()) {
        setMode('downloads');
        setShowOnboarding(false);
        return;
      }

      const skipped = typeof localStorage !== 'undefined' && localStorage.getItem(SKIP_KEY) === '1';
      const saved = await loadPersistedDirectoryHandle();
      if (saved) {
        const ok = await verifyWritableAccess(saved);
        if (ok) {
          await ensureProjectLayout(saved);
          setRoot(saved);
          setFolderName(saved.name);
          setMode('folder');
          setShowOnboarding(false);
          return;
        }
        await clearPersistedDirectoryHandle();
      }

      setMode(skipped ? 'downloads' : 'unset');
      setShowOnboarding(!skipped);
    })();
  }, [hydrated]);

  const connectFolder = useCallback(async () => {
    const h = await pickProjectDirectory();
    if (!h) return;
    localStorage.removeItem(SKIP_KEY);
    await applyRoot(h);
    setShowOnboarding(false);
  }, [applyRoot]);

  const useDownloadsOnly = useCallback(() => {
    localStorage.setItem(SKIP_KEY, '1');
    setMode('downloads');
    setRoot(null);
    setFolderName('');
    setShowOnboarding(false);
  }, []);

  const disconnectFolder = useCallback(async () => {
    await clearPersistedDirectoryHandle();
    localStorage.removeItem(SKIP_KEY);
    setRoot(null);
    setFolderName('');
    setMode('downloads');
    setShowOnboarding(false);
  }, []);

  const trySaveZip = useCallback(
    async (blob: Blob) => {
      if (!root || mode !== 'folder') return false;
      const r = await saveExportFile(root, 'samplesZip', blob);
      if (r.ok) pushSaveNotice(folderName, r.relativePath, 'Sample zip');
      return r.ok;
    },
    [root, mode, folderName, pushSaveNotice],
  );

  const trySaveLoop = useCallback(
    async (blob: Blob) => {
      if (!root || mode !== 'folder') return false;
      const r = await saveExportFile(root, 'loopWav', blob);
      if (r.ok) pushSaveNotice(folderName, r.relativePath, 'Loop WAV');
      return r.ok;
    },
    [root, mode, folderName, pushSaveNotice],
  );

  const trySaveGrain = useCallback(
    async (blob: Blob) => {
      if (!root || mode !== 'folder') return false;
      const r = await saveExportFile(root, 'grainWav', blob);
      if (r.ok) pushSaveNotice(folderName, r.relativePath, 'Grain recording');
      return r.ok;
    },
    [root, mode, folderName, pushSaveNotice],
  );

  const trySaveOneshot = useCallback(
    async (blob: Blob) => {
      if (!root || mode !== 'folder') return false;
      const r = await saveExportFile(root, 'oneshotWav', blob);
      if (r.ok) pushSaveNotice(folderName, r.relativePath, 'Oneshot WAV');
      return r.ok;
    },
    [root, mode, folderName, pushSaveNotice],
  );

  const onSourceFileLoaded = useCallback(
    async (file: File) => {
      if (!root || mode !== 'folder') return;
      const r = await saveSourceFileCopy(root, file);
      if (r.ok) pushSaveNotice(folderName, r.relativePath, 'Source copy');
    },
    [root, mode, folderName, pushSaveNotice],
  );

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    if (mode === 'unset') {
      setMode('downloads');
      localStorage.setItem(SKIP_KEY, '1');
    }
  }, [mode]);

  const promptProjectSetup = useCallback(() => {
    if (!supported) return;
    setShowOnboarding(true);
  }, [supported]);

  const label =
    mode === 'folder' && folderName ? folderName : mode === 'downloads' ? 'Downloads (default)' : '…';

  const hasProjectFolder = mode === 'folder' && root !== null;

  const value = useMemo<Ctx>(
    () => ({
      mode,
      label,
      supported,
      hasProjectFolder,
      saveNotice,
      dismissSaveNotice,
      copySavedPath,
      connectFolder,
      useDownloadsOnly,
      disconnectFolder,
      trySaveZip,
      trySaveLoop,
      trySaveGrain,
      trySaveOneshot,
      onSourceFileLoaded,
      showOnboarding: supported && showOnboarding,
      dismissOnboarding,
      promptProjectSetup,
    }),
    [
      mode,
      label,
      supported,
      hasProjectFolder,
      saveNotice,
      dismissSaveNotice,
      copySavedPath,
      showOnboarding,
      connectFolder,
      useDownloadsOnly,
      disconnectFolder,
      trySaveZip,
      trySaveLoop,
      trySaveGrain,
      trySaveOneshot,
      onSourceFileLoaded,
      dismissOnboarding,
      promptProjectSetup,
    ],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const c = useContext(ProjectContext);
  if (!c) throw new Error('useProject must be used within ProjectProvider');
  return c;
}

/** Optional: use in components that may render outside provider (defensive). */
export function useProjectOptional(): Ctx | null {
  return useContext(ProjectContext);
}

export function fallbackDownloadZip(blob: Blob, filename: string) {
  triggerBlobDownload(blob, filename);
}

export function fallbackDownloadWav(blob: Blob, filename: string) {
  triggerBlobDownload(blob, filename);
}
