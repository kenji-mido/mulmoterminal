import { computed, ref, type ComputedRef } from "vue";
import { normalizeFontFamily, TERMINAL_FONT_FAMILY_DEFAULT } from "../../common/terminalFontFamily";
import { postConfigField } from "./postConfigField";

// The app-wide xterm font-family stack, hydrated from /api/config (`fontFamily` in
// ~/.mulmoterminal/config.json). A directory's `.mulmoterminal.json` fontFamily overrides it.
//
// Global, not per-browser like the font SIZE: a size is a display preference, so a phone and a
// desktop want their own, but a family names FONTS, and which fonts exist belongs to the machine
// the browser runs on — one answer for every client of one host.
//
// A ref because hydration is async and a terminal can mount before /api/config resolves, so
// Terminal.vue watches this and re-applies the family when it lands.
//
// What is stored is the CONFIGURED value, null when unset — Settings has to tell "the user chose
// this stack" from "nothing is set", so it can show the built-in as a placeholder rather than as
// text the user would then be editing.
const configured = ref<string | null>(null);

export const globalFontFamily: ComputedRef<string> = computed(() => configured.value ?? TERMINAL_FONT_FAMILY_DEFAULT);

export const configuredFontFamily: ComputedRef<string | null> = computed(() => configured.value);

// Re-validated rather than trusted: the server validates what it loads, but this is the boundary,
// and an unusable stack reaches the canvas renderer if nothing checks. null (unset or garbage)
// keeps the built-in default.
export const setGlobalFontFamily = (fontFamily: unknown): void => {
  configured.value = normalizeFontFamily(fontFamily);
};

// A blank stack saves as null — "use the built-in", which is what clearing the field means.
export async function saveGlobalFontFamily(fontFamily: string | null): Promise<boolean> {
  const r = await postConfigField("fontFamily", normalizeFontFamily(fontFamily));
  if (r.ok) setGlobalFontFamily(r.value);
  return r.ok;
}
