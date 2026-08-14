// One width for the launch form's rows, as a Tailwind utility string so the styling travels with
// the markup (docs/styling.md) instead of becoming a CSS class.
//
// The DIRECTORY CHIPS are deliberately outside it and span the cell: they tile, so width buys rows
// back — 25 of them inside a 360px cap wrapped into 20 rows while the cell was 1535px wide (#1455).
// Everything else is a control, and a control gains nothing from being 1500px wide: a checkbox
// ends up an eye-journey from the label it belongs to.

export const LAUNCH_ROW = "w-full max-w-[560px]";
