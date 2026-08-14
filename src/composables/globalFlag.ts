import { computed, ref, type ComputedRef } from "vue";
import { postConfigField } from "./postConfigField";

export interface GlobalFlag {
  /** For a template. */
  state: ComputedRef<boolean>;
  /** For code that reads the answer at event time rather than through a render. */
  read: () => boolean;
  /** Adopt what /api/config sent. */
  set: (value: unknown) => void;
  /** Persist as a partial POST, then adopt the server's echo. */
  save: (on: boolean) => Promise<boolean>;
}

// One boolean in ~/.mulmoterminal/config.json that the browser both renders and writes. Six of
// them had the same ref + getter + setter + saver spelled out, which is five chances for one of
// them to read a missing key differently from the server.
//
// `defaultOn` mirrors the key's own sanitizer on the server, and it is the whole reason this takes
// an argument: a MISSING key is not uniformly false. The opt-in flags stay off unless the config
// says `true`, while `prWorkdirFooter` and `appendSystemPrompt` are on unless it says `false`.
// Getting that backwards surfaces only as a checkbox that disagrees with what the server does.
export function createGlobalFlag(field: string, defaultOn: boolean): GlobalFlag {
  const enabled = ref(defaultOn);
  const set = (value: unknown): void => {
    enabled.value = defaultOn ? value !== false : value === true;
  };
  const save = async (on: boolean): Promise<boolean> => {
    const r = await postConfigField(field, on);
    if (r.ok) set(r.value);
    return r.ok;
  };
  return { state: computed(() => enabled.value), read: () => enabled.value, set, save };
}
