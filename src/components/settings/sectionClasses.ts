// The Settings modal's repeated utility runs, as class-string constants so the styling travels
// with the markup (docs/styling.md) instead of becoming a CSS class — which a fragment-root
// section template would silently fail to receive (#787).

// Every section is headed the same way. One constant rather than the same six utilities per
// section, so the headings cannot drift apart one edit at a time.
export const SECTION_HEADING = "mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted";

// The <ul> around a section's saved entries. The list itself stays in each section because what
// makes it worth rendering differs (a repo string, a launcher, an MCP server); only the chrome
// is shared. The rows are SettingsListRow.
export const SETTINGS_LIST = "m-0 mb-2 flex list-none flex-col gap-1 p-0";
