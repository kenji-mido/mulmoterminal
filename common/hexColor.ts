// What counts as a colour anywhere a directory's .mulmoterminal.json supplies one. Only
// 6-digit hex: the server's schema accepts nothing else, and the UI drops what it can't
// parse rather than handing an unknown string to a style binding.
//
// In common/ because both sides decide from it: the server validates a config file with this
// rule and the browser drops what it can't paint, and a third copy of the regex is how the two
// answers start differing.
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// `unknown` rather than `string | null | undefined`: this is what a config parser asks about a
// value straight out of JSON, and narrowing the parameter would make every such site cast first.
export const isHexColor = (color: unknown): color is string => typeof color === "string" && HEX_COLOR_RE.test(color);
