import { describe, expect, it } from "vitest";
import {
  buildProjectRunContextMessage,
  buildProjectRunTerminalStatusInjectMessage,
} from "./project-run-messages.js";
import type { ProjectExecute } from "./types.js";

describe("project-run-messages", () => {
  it("buildProjectRunContextMessage includes dashboard status", () => {
    const text = buildProjectRunContextMessage({
      id: "exec-1",
      status: "running",
      paused: false,
      executorHint: undefined,
    });
    expect(text).toContain("Dashboard execution status: running");
    expect(text).toContain("exec-1");
    expect(text).toContain("authoritative");
    expect(text).toContain("plan to do next");
    expect(text).toContain("Visibility is part of job quality");
    expect(text).toContain("Cadence:");
    expect(text).toContain("sign-in or account access");
    expect(text).toContain("Do not open the target or login URL");
    expect(text).toContain("login is not successful");
    expect(text).toContain("20 seconds");
    expect(text).toContain("much sooner");
    expect(text).toContain("Credential fields:");
    expect(text).toContain("one minute");
  });

  it("buildProjectRunContextMessage notes paused state", () => {
    const text = buildProjectRunContextMessage({
      id: "exec-2",
      status: "running",
      paused: true,
      executorHint: "Wait",
    });
    expect(text).toContain("paused");
    expect(text).toContain("Latest dashboard hint: Wait");
  });

  it("buildProjectRunTerminalStatusInjectMessage summarizes terminal state", () => {
    const ex = {
      id: "e1",
      status: "cancelled",
      durationMs: 12_000,
      cancelReason: "user stop",
    } as ProjectExecute;
    const msg = buildProjectRunTerminalStatusInjectMessage(ex);
    expect(msg).toContain("ended with status: cancelled");
    expect(msg).toContain("user stop");
    expect(msg).toContain("no longer active");
  });

  it("buildProjectRunTerminalStatusInjectMessage asks for no tools and summary on operator finish", () => {
    const ex = {
      id: "e2",
      status: "completed",
      durationMs: 5000,
      operatorStopKind: "finish" as const,
    } as ProjectExecute;
    const msg = buildProjectRunTerminalStatusInjectMessage(ex);
    expect(msg).toContain("do not call any tools");
    expect(msg).toContain("summary");
  });
});
