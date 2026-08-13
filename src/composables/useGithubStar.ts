import { computed, ref } from "vue";
import { parseStarState } from "../../common/githubRepo";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";

// The header's "star this project on GitHub" button. It has to be able to go away for good — a
// permanent ad in the user's own workspace is the failure mode this is designed around — and the
// only thing that retires it is EVIDENCE that the repo is starred, never a guess.
//
// That is why there is no "open the repo page instead" fallback. When `gh` cannot answer, one
// click cannot star anything, so the button stays hidden and NOTHING is written down: install
// `gh` later and it simply appears (the server holds an unknown for seconds, not minutes). An
// earlier revision did offer the link and retired on the click, which recorded "dealt with"
// from a page having been opened — a guess that permanently hid the button from the very users
// who had not starred, with no way back short of clearing storage by hand.
const STORAGE_KEY = "github_star_done";
// Keep the button up, confirmed, for a moment after starring. Vanishing on the click itself
// reads as "nothing happened".
const CONFIRM_MS = 1500;

// "unknown" until the server answers, so an already-starred user never sees it flash.
// "unavailable" is `gh` unable to tell us — missing, not logged in, offline.
type StarState = "unknown" | "unstarred" | "starred" | "unavailable";

const done = ref(localStorage.getItem(STORAGE_KEY) === "1");
const state = ref<StarState>("unknown");
const confirming = ref(false);
let asked = false;
let starring = false;

function retire(): void {
  localStorage.setItem(STORAGE_KEY, "1");
  done.value = true;
}

function toState(starred: boolean | null): StarState {
  if (starred === null) return "unavailable";
  return starred ? "starred" : "unstarred";
}

async function readState(): Promise<void> {
  try {
    const res = await fetchWithTimeout("/api/github/star", undefined, SLOW_COMMAND_TIMEOUT_MS);
    const starred = res.ok ? parseStarState(await res.json()) : null;
    state.value = toState(starred);
    if (starred === true) retire();
  } catch {
    state.value = "unavailable";
  }
}

async function postStar(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout("/api/github/star", { method: "POST" }, SLOW_COMMAND_TIMEOUT_MS);
    return res.ok && parseStarState(await res.json()) === true;
  } catch {
    return false;
  }
}

function confirmStarred(): void {
  state.value = "starred";
  confirming.value = true;
  setTimeout(() => {
    confirming.value = false;
    retire();
  }, CONFIRM_MS);
}

export function useGithubStar() {
  if (!asked && !done.value) {
    asked = true;
    void readState();
  }

  const visible = computed(() => !done.value && (confirming.value || state.value === "unstarred"));
  const title = computed(() => (confirming.value ? "Starred. Thank you!" : "Star MulmoTerminal on GitHub"));

  async function activate(): Promise<void> {
    if (starring || state.value !== "unstarred") return;
    starring = true;
    try {
      // A failed star leaves the button up so the click can just be repeated. If `gh` has really
      // stopped working, the next page load reads an unknown and hides it.
      if (await postStar()) confirmStarred();
    } finally {
      starring = false;
    }
  }

  return { visible, confirming, title, activate };
}
