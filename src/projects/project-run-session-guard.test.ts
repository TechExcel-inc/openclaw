import { describe, expect, it, vi } from "vitest";

const loadProjectsStoreMock = vi.hoisted(() => vi.fn());

vi.mock("./store.js", () => ({
  resolveProjectsStorePath: vi.fn(() => "/tmp/openclaw-projects-test.json"),
  loadProjectsStore: loadProjectsStoreMock,
}));

import {
  evaluateProjectRunChatGate,
  isProjectRunSessionKey,
  parseProjectRunExecutionIdFromSessionKey,
} from "./project-run-session-guard.js";

describe("isProjectRunSessionKey", () => {
  it("returns true for project run session keys", () => {
    expect(isProjectRunSessionKey("agent:main:main:eadproj:run:abc")).toBe(true);
  });
  it("returns false for ordinary keys", () => {
    expect(isProjectRunSessionKey("main:direct:foo")).toBe(false);
    expect(isProjectRunSessionKey(undefined)).toBe(false);
  });
});

describe("parseProjectRunExecutionIdFromSessionKey", () => {
  it("extracts execution id from project run session key", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(parseProjectRunExecutionIdFromSessionKey(`main:eadproj:run:${id}`)).toBe(id);
  });

  it("reverses colon escaping in segment", () => {
    expect(parseProjectRunExecutionIdFromSessionKey("x:eadproj:run:foo_bar_baz")).toBe(
      "foo:bar:baz",
    );
  });

  it("returns null for non-project-run keys", () => {
    expect(parseProjectRunExecutionIdFromSessionKey("main:direct:foo")).toBeNull();
  });
});

describe("evaluateProjectRunChatGate", () => {
  it("allows chat when the execution row is terminal (e.g. completed)", async () => {
    loadProjectsStoreMock.mockImplementation(async () => ({
      version: 3,
      templates: [],
      executions: [{ id: "run-1", status: "completed" } as never],
      activeTemplateId: null,
    }));
    await expect(evaluateProjectRunChatGate("agent:main:main:eadproj:run:run-1")).resolves.toEqual({
      ok: true,
    });
  });
});
