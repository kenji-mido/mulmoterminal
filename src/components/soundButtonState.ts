// The toolbar's attention-sound button has three states, not two. "On" and "off" are the user's
// setting; the third is the browser refusing to play until the page has been clicked, which the
// button used to render as plain "on" — so it said sound was working while notifications were
// being lost (#1152).
//
// Same shape as sortModeButton: the .vue asks for icon + label and renders them.

export interface SoundButtonState {
  icon: string;
  label: string;
  /** Whether the button reads as pressed. Blocked is still "on", so it stays true. */
  active: boolean;
  /** Which active fill to use: blocked is a warning, not a selection. */
  tone: "accent" | "warn";
}

// A bell with a pause mark, rather than a second off-looking icon: the setting IS on, and a
// suspended AudioContext is literally paused. Reusing `notifications_off` would make the blocked
// state indistinguishable from the one the user chose.
const BLOCKED_ICON = "notifications_paused";

export function soundButtonState(enabled: boolean, blocked: boolean): SoundButtonState {
  if (!enabled) return { icon: "notifications_off", label: "Attention sound off", active: false, tone: "accent" };
  if (blocked) return { icon: BLOCKED_ICON, label: "Attention sound blocked - click anywhere to enable", active: true, tone: "warn" };
  return { icon: "notifications_active", label: "Attention sound on", active: true, tone: "accent" };
}
