// The Settings modal's repeated utility runs, as class-string constants so the styling travels
// with the markup (docs/styling.md) instead of becoming a CSS class — which a fragment-root
// section template would silently fail to receive (#787).

// The heading over the open pane. The modal renders it from the active tab's label rather than each
// section carrying its own — the sidebar entry and the heading are the same words (settingsTabs.ts).
export const SECTION_HEADING = "mb-2 mt-3.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted";

// The <ul> around a section's saved entries. The list itself stays in each section because what
// makes it worth rendering differs (a repo string, a launcher, an MCP server); only the chrome
// is shared. The rows are SettingsListRow.
export const SETTINGS_LIST = "m-0 mb-2 flex list-none flex-col gap-1 p-0";
