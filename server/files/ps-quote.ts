// A value going INTO a PowerShell script literal. The picker scripts used to interpolate nothing
// but constants; a start folder derived from the host's home directory is the first runtime value,
// and a single quote in a user name would otherwise end the literal early (#1447).
//
// Single-quoted, so PowerShell does no expansion at all — `$`, backtick and `\` stay themselves,
// and the only escape is a doubled quote.
export const psSingleQuoted = (value: string): string => `'${value.replace(/'/g, "''")}'`;
