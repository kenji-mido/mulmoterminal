import { browserLocale } from "./browserLocale";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { fetchWithTimeout } from "./fetchWithTimeout";

const REQUEST_TIMEOUT_MS = 8000;

// Localize one English host string via the same runtime-translation route the
// collection UX uses (the mulmoterminal host ships no static i18n). Returns the
// English input unchanged for an English locale, and on any failure — so a caller
// can assign the result unconditionally. Translated strings are server-cached, so
// the first call per sentence is the only slow one.
export async function translateUiSentence(english: string, namespace: string): Promise<string> {
  const locale = browserLocale();
  if (locale === "en") return english;

  try {
    const res = await fetchWithTimeout(
      "/api/translation",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ namespace, targetLanguage: locale, sentences: [english] }),
      },
      REQUEST_TIMEOUT_MS,
    );
    if (!res.ok) return english;
    const data: unknown = await res.json();
    const first = isRecord(data) && isUnknownArray(data.translations) ? data.translations[0] : undefined;
    return typeof first === "string" ? first : english;
  } catch {
    return english;
  }
}
