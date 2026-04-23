import { describe, expect, it } from "vitest";

import { SessionManager } from "../src/session-manager";

describe("SessionManager", () => {
  it("starts without an active session", () => {
    const manager = new SessionManager();

    expect(manager.getActiveSessionId()).toBeNull();
  });

  it("stores a new session id", () => {
    const manager = new SessionManager();

    manager.setActiveSessionId("session-123");

    expect(manager.getActiveSessionId()).toBe("session-123");
  });

  it("clears the active session", () => {
    const manager = new SessionManager();

    manager.setActiveSessionId("session-123");
    manager.clearActiveSessionId();

    expect(manager.getActiveSessionId()).toBeNull();
  });
});
