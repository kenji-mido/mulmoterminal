export type PortChoice = { port: number; explicit: boolean } | { error: string };
export type CwdChoice = { path: string; mustExist: boolean } | { error: string };
export declare function parsePortArg(args: string[], defaultPort: number): PortChoice;
export declare function chooseCwd(args: string[], env: Record<string, string | undefined>): CwdChoice;
export declare function portInUseMessage(port: number, explicit: boolean): string;
export declare function portInUseAction(explicit: boolean, isTTY: boolean | undefined): "ask" | "stop";
export declare function secondInstancePrompt(port: number): string;
export declare function saysYes(answer: unknown): boolean;
export declare const SECOND_INSTANCE_NOTE: string;
export declare const MIN_NODE_LABEL: string;
export declare function nodeMeetsMinimum(version: string): boolean;
export declare function serverNodeArgs(serverEntry: string, launchDir: string): string[];
export declare function serverSpawnEnv(env: Record<string, string | undefined>, port: number, cwd: string): Record<string, string | undefined>;
export interface RunningInstance {
  pid: number;
  port: number | null;
}
export declare function runningInstancesPrompt(instances: readonly RunningInstance[]): string;
