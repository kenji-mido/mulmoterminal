// Fetches a terminal's resolved header (action buttons + display chips) from GET /api/header —
// the server merges global + per-dir config and substitutes this session's live context (branch,
// dirty, model, …). Re-fetches when the dir/session/agent change or the window regains focus, so
// ${branch}/${dirty} etc. stay current. `chips: null` means unconfigured (the client keeps its
// default header); an empty `buttons` array means nothing extra is shown.
import { ref, type Ref } from "vue";
import { useAutoRefresh } from "./useAutoRefresh";
import type { TerminalAgent } from "../../common/sessionAgent";
import { isRecord, optionalBoolean, optionalString } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

export interface OpenTarget {
  url?: string;
  reveal?: string;
  files?: string;
  view?: string;
  terminal?: string;
  pickFile?: boolean;
}
export interface HeaderButton {
  id: string;
  emoji?: string;
  icon?: string;
  label: string;
  run: "shell" | "input" | "open";
  // No `cmd`: a shell button's command stays server-side and is re-resolved by id at exec time.
  text?: string;
  open?: OpenTarget;
}
export type ResolvedChip = { kind: "builtin"; id: string } | { kind: "custom"; label: string; text: string };

// The header arrives off /api/header, so a button becomes one only once the fields the header
// RENDERS and ACTS on are there: `label` is drawn, `id` re-resolves the command server-side at
// exec time, and `run` decides what pressing it does. A button missing one of those would draw
// blank or do nothing, which is worse than not offering it.
const isHeaderButton = (value: unknown): value is HeaderButton =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.label === "string" &&
  (value.run === "shell" || value.run === "input" || value.run === "open") &&
  optionalString(value.emoji) &&
  optionalString(value.icon) &&
  optionalString(value.text) &&
  // `open` is nested and IS read — hasPickFileButton reaches into `open.pickFile`.
  (value.open === undefined || isOpenTarget(value.open));

const isOpenTarget = (value: unknown): value is OpenTarget =>
  isRecord(value) &&
  optionalString(value.url) &&
  optionalString(value.reveal) &&
  optionalString(value.files) &&
  optionalString(value.view) &&
  optionalString(value.terminal) &&
  optionalBoolean(value.pickFile);

const isResolvedChip = (value: unknown): value is ResolvedChip =>
  isRecord(value) &&
  ((value.kind === "builtin" && typeof value.id === "string") ||
    (value.kind === "custom" && typeof value.label === "string" && typeof value.text === "string"));

// Whether the resolved header offers a file-path picker (an `open` button with `pickFile`).
// Header buttons are user-configurable and the default picker can be removed, so anything that
// points the user at "the file-picker button" must first confirm it is actually present.
export function hasPickFileButton(buttons: readonly HeaderButton[]): boolean {
  return buttons.some((b) => b.run === "open" && b.open?.pickFile === true);
}

interface Params {
  cwd: Ref<string | null>;
  session: Ref<string | null>;
  agent: Ref<TerminalAgent>;
  model?: Ref<string | null>;
}

export function useHeaderButtons(params: Params) {
  const buttons = ref<HeaderButton[]>([]);
  const chips = ref<ResolvedChip[] | null>(null);
  let requestSeq = 0;

  async function refresh(): Promise<void> {
    const cwd = params.cwd.value;
    if (!cwd) {
      buttons.value = [];
      chips.value = null;
      return;
    }
    const query = new URLSearchParams({ cwd, agent: params.agent.value });
    if (params.session.value) query.set("session", params.session.value);
    if (params.model?.value) query.set("model", params.model.value);
    const seq = ++requestSeq;
    try {
      const res = await fetchWithTimeout(`/api/header?${query.toString()}`);
      if (seq !== requestSeq) return;
      const data = res.ok ? await jsonBody(res) : {};
      if (seq !== requestSeq) return;
      buttons.value = isUnknownArray(data.buttons) ? data.buttons.filter(isHeaderButton) : [];
      chips.value = isUnknownArray(data.chips) ? data.chips.filter(isResolvedChip) : null;
    } catch {
      if (seq === requestSeq) {
        buttons.value = [];
        chips.value = null;
      }
    }
  }

  useAutoRefresh(refresh, [params.cwd, params.session, params.agent, () => params.model?.value]);

  return { buttons, chips, refresh };
}
