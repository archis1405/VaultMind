// Minimal ambient types for the File System Access API surface we use.
// TypeScript's lib.dom.d.ts ships `FileSystemDirectoryHandle` / `FileSystemFileHandle`
// but not `Window.showDirectoryPicker` nor the async-iterator `entries()` helper,
// so we declare just those gaps here.

interface FileSystemDirectoryHandleIterable extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  values(): AsyncIterableIterator<FileSystemHandle>;
  keys(): AsyncIterableIterator<string>;
}

interface Window {
  showDirectoryPicker(options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
  }): Promise<FileSystemDirectoryHandle>;
}
