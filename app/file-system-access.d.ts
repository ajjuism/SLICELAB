/**
 * Augment DOM types for File System Access API (Chromium).
 * @see https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API
 */

export {};

declare global {
  interface Window {
    showDirectoryPicker(options?: {
      mode?: 'read' | 'readwrite';
      startIn?: FileSystemHandle;
    }): Promise<FileSystemDirectoryHandle>;
  }

  interface FileSystemDirectoryHandle {
    queryPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  }
}
