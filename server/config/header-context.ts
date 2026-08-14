// Gather a session's live HeaderContext (cwd, git status, model, agent, …) so a merged HeaderConfig
// can be resolved for it, and merge the global (AppConfig) + per-dir (.mulmoterminal.json) configs.

import path from "node:path";
import { gitStatus } from "../git/git-status.js";
import { git } from "../git/worktrees.js";
import { repoForRemote } from "../git/forge-support.js";
import { mergeHeaderConfig, type HeaderConfig, type HeaderContext } from "./header-config.js";
import { loadDirConfig } from "./dir-config.js";
import { worktreeTask } from "./worktree-task.js";
import { worktreeEnvValues } from "./worktree-env.js";
import type { TerminalAgent } from "../../common/sessionAgent.js";

async function remoteInfo(cwd: string): Promise<{ remoteUrl: string | null; repo: string | null }> {
  const res = await git(["remote", "get-url", "origin"], cwd);
  const remoteUrl = res.ok && res.stdout.trim() ? res.stdout.trim() : null;
  const repo = remoteUrl ? (repoForRemote(remoteUrl)?.repo ?? null) : null;
  return { remoteUrl, repo };
}

export interface SessionMeta {
  session: string | null;
  agent: TerminalAgent;
  model: string | null;
}

export async function buildHeaderContext(cwd: string, meta: SessionMeta): Promise<HeaderContext> {
  const status = await gitStatus(cwd);
  const remote = status.repo ? await remoteInfo(cwd) : { remoteUrl: null, repo: null };
  return {
    dir: cwd,
    dirName: path.basename(cwd),
    branch: status.branch,
    repo: remote.repo,
    model: meta.model,
    agent: meta.agent,
    session: meta.session,
    remoteUrl: remote.remoteUrl,
    dirty: status.dirty,
    ahead: status.ahead,
    behind: status.behind,
    task: worktreeTask(cwd),
    isGitRepo: status.repo,
    prUrl: null, // resolved by the /api/header route only when a `pr` button is present
    worktreeEnv: worktreeEnvValues(cwd),
  };
}

// Merge the global header config (from AppConfig) under the per-dir one (<cwd>/.mulmoterminal.json).
export function loadHeaderConfig(cwd: string, globalConfig: HeaderConfig): HeaderConfig {
  const dir = loadDirConfig(cwd);
  return mergeHeaderConfig(globalConfig, { buttons: dir.buttons, chips: dir.chips });
}
