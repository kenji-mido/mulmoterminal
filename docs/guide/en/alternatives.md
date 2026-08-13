---
title: Open-source alternatives for running parallel AI coding agents
nav_title: Alternatives
layout: default
parent: English
nav_order: 11
description: An honest map of the tools that run several Claude Code / Codex sessions at once — Vibe Kanban, Nimbalyst, Parallel Code, Conductor, Claude Squad, and Claude Code's own `claude agents` — and which one fits which bottleneck. Written by the maintainer of one of them.
---

# Open-source alternatives for running parallel AI coding agents
{: .no_toc }

**Disclosure: I maintain MulmoTerminal, one of the tools on this page.** So read this as a map
drawn by someone standing inside it, not a review. What I can offer instead of neutrality is
being specific about where the others are better, and about what I have not tested.

<details open markdown="block">
  <summary>Contents</summary>
  {: .text-delta }
- TOC
{:toc}
</details>

---

## Before any of this: try what you already have

`claude agents` has been in Claude Code since **2.1.139** as a Research Preview, and I keep
meeting people who don't know it exists.

```bash
claude agents
```

It lists your **background** sessions grouped by Working / Needs input / Completed, with a
one-line summary each. Interactive sessions appear once you background them.

There's also `claude --worktree <name>` (since **2.1.49**), which cuts an isolated worktree and
starts a session in it, cleanup included.

**If that's enough, you're done.** It costs nothing, there's nothing to install, and it's
maintained by the people who make the agent. Everything below is for what happens when it isn't
enough.

---

## The three bottlenecks

Every tool here solves parallel agents. They differ in *which part of it hurts you*.

| If your problem is… | …the shape you want |
|---|---|
| **Reading** — one agent produced 4,000 characters and you can't read it in a sixth of a screen | Several live terminals visible at once |
| **Reviewing** — five branches landed and you have to judge them | Diff-first, worktree-per-task |
| **Coordinating** — you lose track of what each task even was | A board or task graph |
| **Isolating** — you don't want a permission-skipped agent on your real machine | Containers, not just worktrees |

Pick by that, not by feature count.

---

## The tools

Figures checked 2026-08-03. This space changes fast — Crystal became Nimbalyst, Terragon shut
down, and Vibe Kanban's company (Bloop) wound down in April 2026 while the project continues as
community-maintained OSS.

### Vibe Kanban

**~27,500 stars · Apache-2.0 · board-first**

The largest by a wide margin. Models the work as **tasks on a kanban board** rather than as
sessions, which is the right abstraction if what you lose track of is *what you asked for*.
Usable from a mobile browser.

Now community-maintained after its company wound down — worth knowing if you care about who is
answering issues in six months.

### Nimbalyst

**~1,379 stars · MIT · visual workspace · macOS / Windows / Linux**

Formerly Crystal. A desktop app built around **editing what the agents produce** — markdown,
mockups, diagrams — with task tracking around it, plus git management and worktrees.

**Native iOS and Android apps.** If you want a real phone app rather than a web page, this is
the one. Supports Claude Code, Codex and OpenCode.

### Parallel Code

**~716 stars · MIT · desktop · macOS / Linux**

Built solo by the maintainer of Super Productivity. Each agent gets its own worktree and branch;
the design centres on **reviewing the diffs and merging the wins**. Supports Claude Code, Codex
and **Gemini**.

If your bottleneck is judging output rather than watching it happen, this shape fits better than
mine.

### Conductor

**macOS only · proprietary**

Worktree isolation plus a well-built diff review step. Not an option on Windows or Linux.

### Claude Squad

**TUI · tmux + worktrees**

Manages agents as tmux sessions from inside the terminal. **Lighter than anything with a GUI**,
and the right answer if you don't want to leave the terminal or you're working over SSH. You see
one session at a time.

### MulmoTerminal

**MIT · browser · macOS / Linux / Windows**

Mine. A browser board of **several live terminals at once**, colour-coded by state, with a chime
and a web push when one is waiting on you. Sessions run in tmux, so closing the tab or restarting
the server doesn't end them. Claude Code, Codex and Antigravity.

The bet is that a one-line summary is good for triage and no help when you actually want to read
a long reply while five others keep running.

**What it doesn't do:** no container isolation (the Docker sandbox was removed in 4.0.0 —
worktrees are the whole story), no native mobile app, and no Gemini or OpenCode.

Machine-readable facts: [`facts.json`](https://receptron.github.io/mulmoterminal/facts.json).

---

## Side by side

| | Interface | Licence | Agents | Mobile | Isolation |
|---|---|---|---|---|---|
| **Vibe Kanban** | Web | Apache-2.0 | Many | Browser | Worktrees |
| **Nimbalyst** | Desktop | MIT | Claude, Codex, OpenCode | **Native iOS + Android** | Worktrees |
| **Parallel Code** | Desktop | MIT | Claude, Codex, **Gemini** | — | Worktrees |
| **Conductor** | Desktop (macOS) | Proprietary | Claude, Codex, Cursor | — | Worktrees |
| **Claude Squad** | TUI | OSS | Claude, Codex, OpenCode, Amp | — | Worktrees |
| **`claude agents`** | TUI | First-party | Claude | — | Worktrees |
| **MulmoTerminal** | **Browser** | MIT | Claude, Codex, Antigravity | Web + push | Worktrees |

**Notice what's the same.** Nearly everything here is open source, worktree-based, and local. If
someone tells you their differentiator is "MIT" or "runs locally," that's the floor, not a
feature.

**And what nobody in this list does:** container-per-agent isolation. If running an agent with
permissions skipped on your real machine is what keeps you up, none of these solve it — you want
a devcontainer or a VM underneath whichever one you pick.

---

## How I'd choose

- **You want to leave the terminal as little as possible** → Claude Squad, or `claude agents`.
- **You want a real phone app** → Nimbalyst.
- **You mostly need to judge diffs afterwards** → Parallel Code, or Conductor on a Mac.
- **You lose track of the tasks themselves** → Vibe Kanban.
- **You want to watch several running at once, from any device on your network** → this one.

Most of them install in a minute. Trying two is cheaper than reading about six.

---

## What I haven't tested

I use MulmoTerminal daily. The others I have read the source and documentation of, and have not
run for a sustained period. Where I've stated a capability above it comes from the project's own
README or docs, not from my own use — so if I've mischaracterised yours,
[tell me](https://github.com/receptron/mulmoterminal/issues) and I'll fix it.

---

← [English guide index](index.html)
