import { TERMINAL_AGENTS } from "../../common/sessionAgent";
import type { LaunchAgent } from "../../common/launchAgent";

// What an empty grid cell can be started as, in the order the launch form shows them: the
// agents first (Claude leads — it is the default everywhere), then the OS default shell last.
// Derived from TERMINAL_AGENTS so a new agent reaches the form without a second list to keep
// in step; the SET is the same as LAUNCH_AGENTS, which is what the phone may ask for (#831).

export interface LaunchTargetOption {
  agent: LaunchAgent;
  label: string;
  // Only where the label alone doesn't say it. The shell is the one target that needs nothing
  // installed and nothing configured, which is the whole reason it is offered here (#1114).
  title?: string;
}

const OPTIONS: Record<LaunchAgent, Omit<LaunchTargetOption, "agent">> = {
  claude: { label: "Claude" },
  codex: { label: "Codex" },
  antigravity: { label: "Antigravity" },
  shell: { label: "Shell", title: "A plain shell ($SHELL) — no agent, nothing to configure" },
};

export const LAUNCH_TARGETS: readonly LaunchTargetOption[] = [...TERMINAL_AGENTS, "shell" as const].map((agent) => ({ agent, ...OPTIONS[agent] }));
