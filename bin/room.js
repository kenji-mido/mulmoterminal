// `mulmoterminal room post|read <room> …` — taking part in a conversation room from a shell (#1456).
//
// This is how everything that is NOT an agent joins in: a person at a prompt, a shell cell beside
// the agents, a CI job posting a test result into the discussion. The agents themselves call
// nothing — the round-table runner reads their turns and writes for them — so this CLI and the
// runner are the room's only writers, and both are things a human started.
//
// It talks to a RUNNING server over loopback rather than touching the room file directly: the
// server owns the append, so one writer cannot half-write a line another is reading.

const DEFAULT_PORT = 34567;

const usage = () => {
  console.log(`
Usage: mulmoterminal room <command>

  room read <room> [--since <epoch-ms>]   Print what has been said
  room post <room> <text…>                Add a message
  room list                               Rooms that exist

Options:
  --port <n>    Server port (default: ${DEFAULT_PORT})
  --from <name> Who the message is from (default: your username, or "cli")

The server must be running — this posts over http://localhost:<port>.
`);
};

/** The flags this CLI knows, and that each takes a value. Everything else is TEXT.
 *
 *  Named explicitly rather than "anything starting with --", because the text being parsed is a
 *  MESSAGE somebody is posting: `room post standup "use --force carefully"` would otherwise lose
 *  both `--force` and the word after it, silently (Codex review on #1456). A message is the one
 *  argument that must survive whatever it happens to contain. */
const VALUE_FLAGS = new Set(["--port", "--from", "--since"]);

/**
 * argv cut at the first `--`: what may still be read as options, and what is literally text.
 *
 * Cut ONCE, here, and every reader below takes `options` — a second reader scanning the whole argv
 * is what made `--` only half true: the message text was kept intact while `--from` and `--port`
 * were still picked up from inside it, so `room post r -- ask about --from ci` posted as "ci"
 * (Codex review on #1456). `--` has to mean the same thing to every parser or it means nothing.
 */
function splitAtTerminator(args) {
  const at = args.indexOf("--");
  return at < 0 ? { options: args, literal: [] } : { options: args.slice(0, at), literal: args.slice(at + 1) };
}

/** The port to talk to: `--port`, else PORT from the environment, else the default. Read the same
 *  way the server itself reads it, so a user who moved the server does not have to say so twice. */
function portFrom(options) {
  const at = options.indexOf("--port");
  const named = at >= 0 ? Number(options[at + 1]) : Number(process.env.PORT);
  return Number.isFinite(named) && named > 0 ? named : DEFAULT_PORT;
}

function flag(options, name) {
  const at = options.indexOf(name);
  return at >= 0 && VALUE_FLAGS.has(name) ? options[at + 1] : undefined;
}

/** Everything in the option half that is not a known flag or its value — the command, the room id,
 *  and any message text typed before a `--`. */
function positionalOptions(options) {
  const out = [];
  for (let i = 0; i < options.length; i++) {
    if (VALUE_FLAGS.has(options[i])) {
      i++; // its value
      continue;
    }
    out.push(options[i]);
  }
  return out;
}

/** The command, the room and the message, with everything after `--` kept exactly as typed. */
const positional = (args) => {
  const { options, literal } = splitAtTerminator(args);
  return [...positionalOptions(options), ...literal];
};

export const positionalForTest = positional;
export const flagForTest = (args, name) => flag(splitAtTerminator(args).options, name);
export const portForTest = (args) => portFrom(splitAtTerminator(args).options);

const speaker = (options) => flag(options, "--from") || process.env.USER || "cli";

async function request(port, path, init) {
  const url = `http://localhost:${port}${path}`;
  try {
    // Origin, because posting is same-origin guarded: this IS the local machine, and saying so is
    // what the guard asks for.
    const res = await fetch(url, { ...init, headers: { ...(init?.headers ?? {}), Origin: `http://localhost:${port}` } });
    if (!res.ok) {
      console.error(`mulmoterminal room: server answered ${res.status}`);
      return null;
    }
    return await res.json();
  } catch {
    console.error(`mulmoterminal room: could not reach the server at ${url} — is it running?`);
    return null;
  }
}

export async function runRoom(args) {
  const { options } = splitAtTerminator(args);
  const [command, room, ...rest] = positional(args);
  const port = portFrom(options);

  if (!command || command === "--help" || command === "help") return usage();

  if (command === "list") {
    const body = await request(port, "/api/rooms");
    if (body) (body.rooms ?? []).forEach((name) => console.log(name));
    return;
  }

  if (!room) {
    console.error("mulmoterminal room: which room?");
    return usage();
  }

  if (command === "read") {
    const since = Number(flag(options, "--since")) || 0;
    const body = await request(port, `/api/rooms/${encodeURIComponent(room)}?since=${since}`);
    if (!body) return;
    (body.messages ?? []).forEach((message) => {
      console.log(`--- ${message.from} ---`);
      console.log(message.text);
      console.log("");
    });
    return;
  }

  if (command === "post") {
    const text = rest.join(" ").trim();
    if (!text) {
      console.error("mulmoterminal room: nothing to post");
      return;
    }
    const body = await request(port, `/api/rooms/${encodeURIComponent(room)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: speaker(options), text }),
    });
    if (body?.ok) console.log(`posted to ${room}`);
    return;
  }

  console.error(`mulmoterminal room: unknown command ${JSON.stringify(command)}`);
  usage();
}
