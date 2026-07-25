// Whether this is a touch device (a phone/tablet). The reliable signal — unlike hostname,
// which an SSH port-forward defeats — for surfacing on-screen input aids the desktop doesn't
// need, and for falling host-desktop actions (the native file manager) back to their in-app
// equivalent. Checks several signals because `pointer: coarse` alone misses some mobile
// browsers (desktop-mode, quirky reporting): a coarse pointer being present at all, or the
// device reporting touch points, is enough.
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  const mm = window.matchMedia;
  const coarse = !!mm && (mm("(pointer: coarse)").matches || mm("(any-pointer: coarse)").matches);
  const hasTouchPoints = typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0;
  return coarse || hasTouchPoints;
}
