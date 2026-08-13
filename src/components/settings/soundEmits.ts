// What the notification-sounds section reports upward. Declared once because the Settings modal
// that hosts it has to re-declare every one of them to forward it to App.vue, and a section's
// events written out twice drift apart one payload type at a time (#1289 — same reason as
// GridCellEmits).
import type { NotifyKind } from "../../../common/notifyKinds";
import type { SoundMap } from "../../composables/soundSettings";

export interface SoundEmits {
  /** The fallback file for every kind that has no sound of its own. Null = the built-in chime. */
  (e: "update-sound", file: string | null): void;
  /** Which moments beep at all. */
  (e: "update-sound-kinds", kinds: NotifyKind[]): void;
  /** The whole per-kind map, persisted as one value. */
  (e: "update-sounds", sounds: SoundMap): void;
}
