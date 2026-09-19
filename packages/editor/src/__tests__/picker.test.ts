// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mountOverlay, createPicker, HOST_ATTR } from "../picker.js";

beforeEach(() => {
  document.body.innerHTML = `<a id="link" href="/go">Go</a><p id="p">Text</p>`;
});

describe("overlay", () => {
  it("mounts one host in body and removes it on destroy", () => {
    const o = mountOverlay();
    expect(document.querySelectorAll(`[${HOST_ATTR}]`)).toHaveLength(1);
    o.destroy();
    expect(document.querySelector(`[${HOST_ATTR}]`)).toBeNull();
  });

  it("keeps its UI in a closed shadow root", () => {
    const o = mountOverlay();
    expect(o.host.shadowRoot).toBeNull();
    expect(o.root.mode).toBe("closed");
  });
});

describe("picker", () => {
  it("selects the clicked element and blocks the page's own click handling", () => {
    const pageHandler = vi.fn();
    document.getElementById("link")!.addEventListener("click", pageHandler);
    const picked: Element[] = [];
    const p = createPicker(mountOverlay(), (el) => picked.push(el));
    p.start();

    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.getElementById("link")!.dispatchEvent(ev);

    expect(picked).toEqual([document.getElementById("link")]);
    expect(ev.defaultPrevented).toBe(true);
    expect(pageHandler).not.toHaveBeenCalled();
  });

  it("ignores clicks on its own UI", () => {
    const o = mountOverlay();
    const picked: Element[] = [];
    createPicker(o, (el) => picked.push(el)).start();
    o.host.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(picked).toHaveLength(0);
  });

  it("stops listening after stop()", () => {
    const picked: Element[] = [];
    const p = createPicker(mountOverlay(), (el) => picked.push(el));
    p.start();
    p.stop();
    document.getElementById("p")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(picked).toHaveLength(0);
  });
});
