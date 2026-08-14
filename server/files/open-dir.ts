import type { Express, Request } from "express";
import { spawn } from "node:child_process";
import { resolveDirRequest } from "./dirRequest.js";
import { isWsl, toWindowsPath } from "./wsl.js";

export interface OpenDirCommand {
  cmd: string;
  /** The command is a Windows program, so it wants the Windows form of the path (WSL interop). */
  windowsPath?: boolean;
}

// The native file-manager openers for a platform, best first. The commands are a fixed
// allowlist (never built from input); the directory is passed as a separate argv entry, so
// there's no shell and no injection surface.
//
// WSL is Explorer's job even though the platform is `linux`: the distro has no desktop of its
// own, and `xdg-open` there either doesn't exist or opens a Linux app nobody can see (#1447).
// `xdg-open` still follows it, so a host wrongly read as WSL — or a WSL with interop turned off —
// falls back to what a Linux desktop would have done instead of failing outright.
export function openDirCommands(platform: NodeJS.Platform, wsl: boolean): OpenDirCommand[] {
  if (platform === "win32") return [{ cmd: "explorer" }];
  if (platform === "darwin") return [{ cmd: "open" }];
  if (wsl) return [{ cmd: "explorer.exe", windowsPath: true }, { cmd: "xdg-open" }];
  return [{ cmd: "xdg-open" }];
}

// Resolves null once the child is running, or the reason it could not start. The exit CODE is
// deliberately not waited for: `explorer.exe` returns 1 on a perfectly successful open, and the
// user is done with us the moment the window appears.
function spawnOpener(cmd: string, dir: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(cmd, [dir], { detached: true, stdio: "ignore" });
    child.on("error", (e) => resolve(e.message));
    child.on("spawn", () => {
      child.unref();
      resolve(null);
    });
  });
}

/** The path this opener wants, or null when it cannot be expressed (so the caller skips it). */
const targetFor = (candidate: OpenDirCommand, dir: string): Promise<string | null> => (candidate.windowsPath ? toWindowsPath(dir) : Promise.resolve(dir));

interface OpenDirOptions {
  isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean;
}

// POST /api/open-dir { path } — reveal an absolute, existing directory in the OS
// file manager. The server runs locally, so this is how a browser tab (which can't
// touch the filesystem) opens a folder. Guarded by the same-origin check used for
// the sockets so a random website can't drive it.
//
// It answers only once an opener has actually STARTED. It used to answer `{ok:true}` first and
// log the failure to a console the user never sees, so a host without `xdg-open` reported success
// and revealed nothing (#1447).
export function mountOpenDirRoute(app: Express, { isAllowedOrigin }: OpenDirOptions) {
  app.post("/api/open-dir", async (req: Request, res) => {
    const dir = resolveDirRequest(req, res, isAllowedOrigin);
    if (!dir) return;
    const attempts: string[] = [];
    for (const candidate of openDirCommands(process.platform, isWsl(process.platform, process.env))) {
      const target = await targetFor(candidate, dir);
      if (target === null) {
        attempts.push(`${candidate.cmd}: wslpath could not translate ${dir}`);
        continue;
      }
      const failure = await spawnOpener(candidate.cmd, target);
      if (failure === null) return res.json({ ok: true });
      attempts.push(`${candidate.cmd}: ${failure}`);
    }
    res.status(500).json({ error: `could not open ${dir} [${attempts.join("; ")}]` });
  });
}
