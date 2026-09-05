import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerServiceWorker } from "../src/lib/sw-client.js";

let fake;
beforeEach(() => {
  fake = { controller: null, listeners: {}, update: vi.fn(async () => {}) };
  fake.register = vi.fn(async () => ({ update: fake.update }));
  fake.addEventListener = (t, fn) => (fake.listeners[t] ??= []).push(fn);
  Object.defineProperty(navigator, "serviceWorker", { value: fake, configurable: true });
  document.body.innerHTML = "";
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());
const controllerChange = () => fake.listeners.controllerchange?.forEach((fn) => fn());

describe("page side of the worker", () => {
  it("first install is silent", async () => {
    registerServiceWorker("/sw.js");
    expect(fake.register).toHaveBeenCalledWith("/sw.js", undefined);
    controllerChange();
    expect(document.getElementById("itineris-update")).toBeNull();
  });
  it("a new version taking over an open page offers one reload button, once it has finished activating", () => {
    fake.controller = { state: "activated" };
    registerServiceWorker("/admin/sw.js", { scope: "/admin/" });
    expect(fake.register).toHaveBeenCalledWith("/admin/sw.js", { scope: "/admin/" });
    let onState = null;
    fake.controller = { state: "activating", addEventListener: (t, fn) => (onState = fn) };
    controllerChange();
    expect(document.getElementById("itineris-update")).toBeNull();        // still clearing old caches
    fake.controller.state = "activated"; onState();
    controllerChange(); fake.controller.state = "activated"; onState();   // a second announcement adds nothing
    const buttons = document.querySelectorAll("#itineris-update");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent("Updated · Reload");
  });
  it("long-lived pages keep checking for updates", async () => {
    registerServiceWorker("/sw.js");
    await Promise.resolve(); await Promise.resolve();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(fake.update).toHaveBeenCalledTimes(1);
  });
});
