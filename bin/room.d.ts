export declare function runRoom(args: string[]): Promise<void>;
/** Exported for the spec: `bin/*.js` has no other way in, and the argument parsing is where a
 *  posted message can silently lose part of itself — or have a flag read out of its own text. */
export declare function positionalForTest(args: string[]): string[];
export declare function flagForTest(args: string[], name: string): string | undefined;
export declare function portForTest(args: string[]): number;
