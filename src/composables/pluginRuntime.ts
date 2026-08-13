// MulmoTerminal's BrowserPluginRuntime provider (task #6 Phase 4). The
// @mulmoclaude/markdown-plugin View reaches host capabilities via
// gui-chat-protocol's useRuntime() — dispatch / pubsub / locale / openUrl — which
// requires a host to provide() one under PLUGIN_RUNTIME_KEY. MulmoTerminal had no
// such provider; this is it, wired to MulmoTerminal's own transport:
//   - dispatch  → POST /api/plugin/<toolName> (the same route the MCP broker uses;
//                 execute() routes by args.kind, so the View's dispatch and the
//                 LLM tool-call share one endpoint).
//   - pubsub    → the existing socket.io usePubSub, on `plugin:<scope>:<event>`
//                 channels (the server forwards file changes to
//                 plugin:markdown:file:<path> — see server/backends/markdown.js).
//   - locale    → a fixed "en" ref (MulmoTerminal has no locale picker; the
//                 package's bundled i18n falls back to English).
//   - openUrl   → scheme-allowlisted window.open.
import { defineComponent, h, markRaw, provide, ref, type Component, type Ref } from "vue";
import { PLUGIN_RUNTIME_KEY, type BrowserPluginRuntime, type SubscribeOptions } from "gui-chat-protocol/vue";
import { usePubSub } from "./usePubSub";
import { isOpenablePluginUrl } from "./pluginUrlPolicy";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";

function pluginChannelName(scope: string, eventName: string): string {
  return `plugin:${scope}:${eventName}`;
}

function makeOpenUrl(scope: string): BrowserPluginRuntime["openUrl"] {
  return (url: string) => {
    // The scheme allowlist is the security boundary — see pluginUrlPolicy.ts.
    if (!isOpenablePluginUrl(url)) {
      console.warn(`[plugin/${scope}] openUrl rejected non-http(s) or unparseable URL`, { url });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };
}

function makeDispatch(toolName: string): BrowserPluginRuntime["dispatch"] {
  const url = `/api/plugin/${encodeURIComponent(toolName)}`;

  async function post(args: object): Promise<unknown> {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args ?? {}),
      },
      SLOW_COMMAND_TIMEOUT_MS,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`plugin/${toolName} dispatch failed (${res.status}): ${text || res.statusText}`);
    }
    const raw: unknown = await res.json();
    return raw;
  }

  async function dispatch(args: object): Promise<unknown>;
  async function dispatch<T>(args: object, parse: (raw: unknown) => T): Promise<T>;
  async function dispatch<T>(args: object, parse?: (raw: unknown) => T) {
    const raw = await post(args);
    return parse ? parse(raw) : raw;
  }
  return dispatch;
}

type PluginSubscribe = BrowserPluginRuntime["pubsub"]["subscribe"];

// Both overloads land on one implementation that reads its trailing arguments off a
// tuple UNION narrowed by `rest.length` — the shape gui-chat-protocol's reference host
// uses, and the reason neither `opts` nor `handler` needs an assertion to be read.
function makeSubscribe(scope: string, onChannel: (channel: string, handler: (data: unknown) => void) => () => void): PluginSubscribe {
  function subscribe(eventName: string, handler: (payload: unknown) => void): () => void;
  function subscribe<T>(eventName: string, opts: SubscribeOptions<T>, handler: (payload: T) => void): () => void;
  function subscribe<T>(
    eventName: string,
    ...rest: [handler: (payload: unknown) => void] | [opts: SubscribeOptions<T>, handler: (payload: T) => void]
  ): () => void {
    const channel = pluginChannelName(scope, eventName);
    if (rest.length === 1) return onChannel(channel, rest[0]);
    const [opts, handler] = rest;
    return onChannel(channel, (raw) => {
      // A throwing `parse` drops the frame rather than the channel. The reader idiom the
      // protocol documents is `Schema.parse(raw)` and Zod's `parse` throws, so without
      // this one malformed frame would take down every other subscriber on it too.
      let payload: T | null;
      try {
        payload = opts.parse(raw);
      } catch (error) {
        console.warn(`[plugin/${scope}] dropped an unparseable frame on ${eventName}`, error);
        return;
      }
      if (payload !== null) handler(payload);
    });
  }
  return subscribe;
}

// Shared "en" locale — MulmoTerminal has no locale switcher.
const sharedLocale: Ref<string> = ref("en");

interface MakeRuntimeDeps {
  /** Channel namespace for pubsub (e.g. "markdown"); matches the server forward. */
  scope: string;
  /** Tool name the dispatch route resolves (e.g. "presentDocument"). */
  toolName: string;
}

export function makeBrowserPluginRuntime(deps: MakeRuntimeDeps): BrowserPluginRuntime {
  const { scope, toolName } = deps;
  const { subscribe } = usePubSub();
  const tag = `[plugin/${scope}]`;
  return {
    pubsub: { subscribe: makeSubscribe(scope, subscribe) },
    locale: sharedLocale,
    log: {
      debug: (msg, data) => console.debug(tag, msg, data),
      info: (msg, data) => console.info(tag, msg, data),
      warn: (msg, data) => console.warn(tag, msg, data),
      error: (msg, data) => console.error(tag, msg, data),
    },
    openUrl: makeOpenUrl(scope),
    dispatch: makeDispatch(toolName),
    // `endpoints` is left OFF rather than set to undefined: the protocol spells it exact, so
    // the key holding undefined is a different type from no key. Every plugin here is the
    // single-dispatch shape, so there is no URL map to expose (MulmoClaude passes one through
    // for its multi-URL built-ins).
  };
}

/** Wrap a plugin view so its descendants can call useRuntime(). Mirrors
 *  MulmoClaude's wrapWithScope — builds the runtime once and provides it under
 *  PLUGIN_RUNTIME_KEY; the PluginFrame Teleport preserves Vue context, so the
 *  provide reaches the teleported view. */
export function wrapWithPluginRuntime(scope: string, toolName: string, inner: Component): Component {
  return markRaw(
    defineComponent({
      name: `PluginRuntimeScope:${scope}`,
      inheritAttrs: false,
      setup(_props, { attrs, slots }) {
        const runtime = makeBrowserPluginRuntime({ scope, toolName });
        provide(PLUGIN_RUNTIME_KEY, runtime);
        return () => h(inner, attrs, slots);
      },
    }),
  );
}
