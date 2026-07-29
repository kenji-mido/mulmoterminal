// A single app-wide in-browser file picker, so a non-component caller (useHeaderAction's 📎
// button dispatch) can open it and get the chosen path back. The native OS file dialog opens
// on the SERVER's display — unreachable from a remote browser — so this replaces it.
//
// FilePickerHost (mounted once in App) renders the modal when a request is active; openFilePicker
// parks the request and its callback. Single pending request — the picker is modal, so a second
// open just supersedes the first.
import { ref } from "vue";

export interface FilePickRequest {
  // Where the picker opens (usually the session's cwd); null starts at home.
  start: string | null;
  // Called with the chosen absolute path(s) — an array so a future multi-select fits without
  // changing callers. Empty/na on cancel: the callback simply isn't invoked.
  onSelect: (paths: string[]) => void;
}

const request = ref<FilePickRequest | null>(null);

export function openFilePicker(req: FilePickRequest): void {
  request.value = req;
}

export function closeFilePicker(): void {
  request.value = null;
}

export function useFilePickerRequest() {
  return request;
}
