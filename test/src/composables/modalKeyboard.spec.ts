import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h, ref, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { MODAL_FOCUSABLE } from "../../../src/utils/focusTrap";
import { modalKeydownHandler, useModalKeyboard } from "../../../src/composables/useModalKeyboard";

// jsdom only tracks document.activeElement for attached elements, so every dialog is mounted
// into document.body.
function dialog(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

function key(name: string, shift = false): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: name, shiftKey: shift, cancelable: true });
}

describe("modalKeydownHandler", () => {
  let el: HTMLElement | null = null;
  afterEach(() => {
    el?.remove();
    el = null;
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    modalKeydownHandler({ modalEl: { value: null }, onClose })(key("Escape"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("traps Tab inside the dialog", () => {
    el = dialog('<button id="a">a</button><button id="b">b</button>');
    el.querySelector<HTMLElement>("#b")?.focus();
    const e = key("Tab");
    modalKeydownHandler({ modalEl: { value: el }, onClose: vi.fn() })(e);
    expect(document.activeElement).toBe(el.querySelector("#a"));
    expect(e.defaultPrevented).toBe(true);
  });

  // The dialogs that open on demand keep this handler bound while closed, so a Tab arriving with
  // no dialog element must fall through to the page rather than be swallowed.
  it("leaves Tab alone when there is no dialog element", () => {
    const e = key("Tab");
    modalKeydownHandler({ modalEl: { value: null }, onClose: vi.fn() })(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it("passes the trap selector through, so a text field is reachable", () => {
    el = dialog('<textarea id="text"></textarea><button id="btn">b</button>');
    el.querySelector<HTMLElement>("#text")?.focus();
    const e = key("Tab", true);
    modalKeydownHandler({ modalEl: { value: el }, onClose: vi.fn(), trapSelector: MODAL_FOCUSABLE })(e);
    expect(document.activeElement).toBe(el.querySelector("#btn"));
  });

  it("ignores every other key", () => {
    const onClose = vi.fn();
    const e = key("Enter");
    modalKeydownHandler({ modalEl: { value: el }, onClose })(e);
    expect(onClose).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });
});

// A dialog that exists only while open: it listens for its whole lifetime, and must stop when it
// goes away — a handler left on the document closes a modal that is no longer there.
describe("useModalKeyboard", () => {
  const modalWith = (onClose: () => void) =>
    defineComponent({
      setup() {
        const modalEl = ref<HTMLElement>();
        useModalKeyboard({ modalEl, onClose, trapSelector: MODAL_FOCUSABLE, focusSelector: "input, button" });
        return () => h("div", { ref: modalEl }, [h("button", "close"), h("input")]);
      },
    });

  it("closes on Escape while mounted, and stops listening once unmounted", () => {
    const onClose = vi.fn();
    const wrapper = mount(modalWith(onClose), { attachTo: document.body });
    document.dispatchEvent(key("Escape"));
    expect(onClose).toHaveBeenCalledOnce();

    wrapper.unmount();
    document.dispatchEvent(key("Escape"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("focuses the dialog's first control on mount, so the trap is reachable from the keyboard", async () => {
    const wrapper = mount(modalWith(vi.fn()), { attachTo: document.body });
    await nextTick();
    expect(document.activeElement).toBe(wrapper.find("button").element);
    wrapper.unmount();
  });
});
