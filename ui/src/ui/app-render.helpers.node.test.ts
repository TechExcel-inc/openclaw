import { describe, expect, it } from "vitest";
import type { ProjectExecute } from "../../../src/projects/types.js";
import {
  formatExecutionStatusForUi,
  isCronSessionKey,
  parseSessionKey,
  pickAdjacentProjectRunIdForNav,
  PROJECT_RUN_NAV_MAX,
  projectRunScreenshotSteps,
  resolveActiveTemplateIdForProjectNav,
  resolveExecutionForProjectRun,
  resolveSessionDisplayName,
  visibleGlobalExecutionsForNav,
  visibleTemplateExecutionsChronological,
} from "./app-render.helpers.ts";
import type { AppViewState } from "./app-view-state.ts";
import type { SessionsListResult } from "./types.ts";

function projectNavState(partial: Partial<AppViewState>): AppViewState {
  return {
    templatesList: [],
    chatActiveTemplateId: null,
    activeTemplateId: null,
    templateDetail: null,
    globalExecutionsList: [],
    executionDetail: null,
    hiddenProjectRunNavIds: [],
    ...partial,
  } as AppViewState;
}

type SessionRow = SessionsListResult["sessions"][number];

function row(overrides: Partial<SessionRow> & { key: string }): SessionRow {
  return { kind: "direct", updatedAt: 0, ...overrides };
}

/* ================================================================
 *  parseSessionKey – low-level key → type / fallback mapping
 * ================================================================ */

describe("parseSessionKey", () => {
  it("identifies main session (bare 'main')", () => {
    expect(parseSessionKey("main")).toEqual({ prefix: "", fallbackName: "Main Session" });
  });

  it("identifies main session (agent:main:main)", () => {
    expect(parseSessionKey("agent:main:main")).toEqual({
      prefix: "",
      fallbackName: "Main Session",
    });
  });

  it("identifies subagent sessions", () => {
    expect(parseSessionKey("agent:main:subagent:18abfefe-1fa6-43cb-8ba8-ebdc9b43e253")).toEqual({
      prefix: "Subagent:",
      fallbackName: "Subagent:",
    });
  });

  it("identifies cron sessions", () => {
    expect(parseSessionKey("agent:main:cron:daily-briefing-uuid")).toEqual({
      prefix: "Cron:",
      fallbackName: "Cron Job:",
    });
    expect(parseSessionKey("cron:daily-briefing-uuid")).toEqual({
      prefix: "Cron:",
      fallbackName: "Cron Job:",
    });
  });

  it("identifies direct chat with known channel", () => {
    expect(parseSessionKey("agent:main:bluebubbles:direct:+19257864429")).toEqual({
      prefix: "",
      fallbackName: "iMessage · +19257864429",
    });
  });

  it("identifies direct chat with telegram", () => {
    expect(parseSessionKey("agent:main:telegram:direct:user123")).toEqual({
      prefix: "",
      fallbackName: "Telegram · user123",
    });
  });

  it("identifies group chat with known channel", () => {
    expect(parseSessionKey("agent:main:discord:group:guild-chan")).toEqual({
      prefix: "",
      fallbackName: "Discord Group",
    });
  });

  it("capitalises unknown channels in direct/group patterns", () => {
    expect(parseSessionKey("agent:main:mychannel:direct:user1")).toEqual({
      prefix: "",
      fallbackName: "Mychannel · user1",
    });
  });

  it("identifies channel-prefixed legacy keys", () => {
    expect(parseSessionKey("bluebubbles:g-agent-main-bluebubbles-direct-+19257864429")).toEqual({
      prefix: "",
      fallbackName: "iMessage Session",
    });
    expect(parseSessionKey("discord:123:456")).toEqual({
      prefix: "",
      fallbackName: "Discord Session",
    });
  });

  it("handles bare channel name as key", () => {
    expect(parseSessionKey("telegram")).toEqual({
      prefix: "",
      fallbackName: "Telegram Session",
    });
  });

  it("returns raw key for unknown patterns", () => {
    expect(parseSessionKey("something-unknown")).toEqual({
      prefix: "",
      fallbackName: "something-unknown",
    });
  });
});

/* ================================================================
 *  resolveSessionDisplayName – full resolution with row data
 * ================================================================ */

describe("resolveSessionDisplayName", () => {
  // ── Key-only fallbacks (no row) ──────────────────

  it("returns 'Main Session' for agent:main:main key", () => {
    expect(resolveSessionDisplayName("agent:main:main")).toBe("Main Session");
  });

  it("returns 'Main Session' for bare 'main' key", () => {
    expect(resolveSessionDisplayName("main")).toBe("Main Session");
  });

  it("returns 'Subagent:' for subagent key without row", () => {
    expect(resolveSessionDisplayName("agent:main:subagent:abc-123")).toBe("Subagent:");
  });

  it("returns 'Cron Job:' for cron key without row", () => {
    expect(resolveSessionDisplayName("agent:main:cron:abc-123")).toBe("Cron Job:");
  });

  it("parses direct chat key with channel", () => {
    expect(resolveSessionDisplayName("agent:main:bluebubbles:direct:+19257864429")).toBe(
      "iMessage · +19257864429",
    );
  });

  it("parses channel-prefixed legacy key", () => {
    expect(resolveSessionDisplayName("discord:123:456")).toBe("Discord Session");
  });

  it("returns raw key for unknown patterns", () => {
    expect(resolveSessionDisplayName("something-custom")).toBe("something-custom");
  });

  // ── With row data (label / displayName) ──────────

  it("returns parsed fallback when row has no label or displayName", () => {
    expect(resolveSessionDisplayName("agent:main:main", row({ key: "agent:main:main" }))).toBe(
      "Main Session",
    );
  });

  it("returns parsed fallback when displayName matches key", () => {
    expect(resolveSessionDisplayName("mykey", row({ key: "mykey", displayName: "mykey" }))).toBe(
      "mykey",
    );
  });

  it("returns parsed fallback when label matches key", () => {
    expect(resolveSessionDisplayName("mykey", row({ key: "mykey", label: "mykey" }))).toBe("mykey");
  });

  it("uses label alone when available", () => {
    expect(
      resolveSessionDisplayName(
        "discord:123:456",
        row({ key: "discord:123:456", label: "General" }),
      ),
    ).toBe("General");
  });

  it("falls back to displayName when label is absent", () => {
    expect(
      resolveSessionDisplayName(
        "discord:123:456",
        row({ key: "discord:123:456", displayName: "My Chat" }),
      ),
    ).toBe("My Chat");
  });

  it("prefers label over displayName when both are present", () => {
    expect(
      resolveSessionDisplayName(
        "discord:123:456",
        row({ key: "discord:123:456", displayName: "My Chat", label: "General" }),
      ),
    ).toBe("General");
  });

  it("ignores whitespace-only label and falls back to displayName", () => {
    expect(
      resolveSessionDisplayName(
        "discord:123:456",
        row({ key: "discord:123:456", displayName: "My Chat", label: "   " }),
      ),
    ).toBe("My Chat");
  });

  it("uses parsed fallback when whitespace-only label and no displayName", () => {
    expect(
      resolveSessionDisplayName("discord:123:456", row({ key: "discord:123:456", label: "   " })),
    ).toBe("Discord Session");
  });

  it("trims label and displayName", () => {
    expect(resolveSessionDisplayName("k", row({ key: "k", label: "  General  " }))).toBe("General");
    expect(resolveSessionDisplayName("k", row({ key: "k", displayName: "  My Chat  " }))).toBe(
      "My Chat",
    );
  });

  // ── Type prefixes applied to labels / displayNames ──

  it("prefixes subagent label with Subagent:", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:subagent:abc-123",
        row({ key: "agent:main:subagent:abc-123", label: "maintainer-v2" }),
      ),
    ).toBe("Subagent: maintainer-v2");
  });

  it("prefixes subagent displayName with Subagent:", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:subagent:abc-123",
        row({ key: "agent:main:subagent:abc-123", displayName: "Task Runner" }),
      ),
    ).toBe("Subagent: Task Runner");
  });

  it("prefixes cron label with Cron:", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:cron:abc-123",
        row({ key: "agent:main:cron:abc-123", label: "daily-briefing" }),
      ),
    ).toBe("Cron: daily-briefing");
  });

  it("prefixes cron displayName with Cron:", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:cron:abc-123",
        row({ key: "agent:main:cron:abc-123", displayName: "Nightly Sync" }),
      ),
    ).toBe("Cron: Nightly Sync");
  });

  it("does not double-prefix cron labels that already include Cron:", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:cron:abc-123",
        row({ key: "agent:main:cron:abc-123", label: "Cron: Nightly Sync" }),
      ),
    ).toBe("Cron: Nightly Sync");
  });

  it("does not double-prefix subagent display names that already include Subagent:", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:subagent:abc-123",
        row({ key: "agent:main:subagent:abc-123", displayName: "Subagent: Runner" }),
      ),
    ).toBe("Subagent: Runner");
  });

  it("does not prefix non-typed sessions with labels", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:bluebubbles:direct:+19257864429",
        row({ key: "agent:main:bluebubbles:direct:+19257864429", label: "Tyler" }),
      ),
    ).toBe("Tyler");
  });
});

describe("isCronSessionKey", () => {
  it("returns true for cron: prefixed keys", () => {
    expect(isCronSessionKey("cron:abc-123")).toBe(true);
    expect(isCronSessionKey("cron:weekly-agent-roundtable")).toBe(true);
    expect(isCronSessionKey("agent:main:cron:abc-123")).toBe(true);
    expect(isCronSessionKey("agent:main:cron:abc-123:run:run-1")).toBe(true);
  });

  it("returns false for non-cron keys", () => {
    expect(isCronSessionKey("main")).toBe(false);
    expect(isCronSessionKey("discord:group:eng")).toBe(false);
    expect(isCronSessionKey("agent:main:slack:cron:job:run:uuid")).toBe(false);
  });
});

describe("resolveExecutionForProjectRun", () => {
  const base = (id: string): ProjectExecute => ({
    id,
    linkedTemplateId: "t",
    name: "n",
    description: "",
    targetUrl: "",
    aiPrompt: "",
    status: "running",
    steps: [],
    progressPercentage: 10,
    startTime: Date.now(),
    durationMs: null,
    results: [],
  });

  it("prefers the row with more steps when both executionDetail and globalExecutionsList match", () => {
    const id = "00000000-0000-4000-8000-0000000000e1";
    const stale = base(id);
    const fresh = {
      ...base(id),
      steps: [
        {
          stepId: "s1",
          title: "Milestone",
          status: "completed" as const,
          summary: "Done",
          artifacts: [],
        },
      ],
      progressPercentage: 50,
    };
    expect(
      resolveExecutionForProjectRun(
        projectNavState({
          globalExecutionsList: [fresh],
          executionDetail: stale,
        }),
        id,
      ),
    ).toEqual(fresh);
  });

  it("prefers executionDetail when it has richer progressLog than the list row", () => {
    const id = "00000000-0000-4000-8000-0000000000e2";
    const listRow = base(id);
    const detailRow = {
      ...base(id),
      progressLog: [
        {
          ts: Date.now(),
          kind: "tool_use" as const,
          text: "",
          toolName: "browser",
        },
      ],
    };
    expect(
      resolveExecutionForProjectRun(
        projectNavState({
          globalExecutionsList: [listRow],
          executionDetail: detailRow,
        }),
        id,
      ),
    ).toEqual(detailRow);
  });
});

describe("resolveActiveTemplateIdForProjectNav", () => {
  it("resolves linkedTemplateId when chat id is an execution id and templatesList is empty", () => {
    const execId = "00000000-0000-4000-8000-000000000001";
    const tplId = "00000000-0000-4000-8000-000000000002";
    const ex: ProjectExecute = {
      id: execId,
      linkedTemplateId: tplId,
      name: "Plan",
      description: "",
      targetUrl: "",
      aiPrompt: "",
      status: "running",
      steps: [],
      progressPercentage: 0,
      startTime: Date.now(),
      durationMs: null,
      results: [],
    };
    expect(
      resolveActiveTemplateIdForProjectNav(
        projectNavState({
          chatActiveTemplateId: execId,
          globalExecutionsList: [ex],
        }),
      ),
    ).toBe(tplId);
  });

  it("falls back to executionDetail when the run is not yet in globalExecutionsList", () => {
    const execId = "00000000-0000-4000-8000-000000000003";
    const tplId = "00000000-0000-4000-8000-000000000004";
    const ex: ProjectExecute = {
      id: execId,
      linkedTemplateId: tplId,
      name: "Plan",
      description: "",
      targetUrl: "",
      aiPrompt: "",
      status: "pending",
      steps: [],
      progressPercentage: 0,
      startTime: Date.now(),
      durationMs: null,
      results: [],
    };
    expect(
      resolveActiveTemplateIdForProjectNav(
        projectNavState({
          chatActiveTemplateId: execId,
          globalExecutionsList: [],
          executionDetail: ex,
        }),
      ),
    ).toBe(tplId);
  });
});

describe("formatExecutionStatusForUi", () => {
  it("maps natural completed to AI Finished", () => {
    expect(formatExecutionStatusForUi("completed", false)).toBe("AI Finished");
  });

  it("maps operator finish stop to Stop — Finish", () => {
    expect(formatExecutionStatusForUi("completed", false, { operatorStopKind: "finish" })).toBe(
      "Stop — Finish",
    );
  });

  it("maps operator cancel stop to Stop — Cancel", () => {
    expect(formatExecutionStatusForUi("cancelled", false, { operatorStopKind: "cancel" })).toBe(
      "Stop — Cancel",
    );
  });

  it("maps non-operator cancelled to AI Canceled", () => {
    expect(formatExecutionStatusForUi("cancelled", false, {})).toBe("AI Canceled");
  });

  it("shows Running when running even if paused (paused is not a separate label)", () => {
    expect(formatExecutionStatusForUi("running", true)).toBe("Running");
  });

  it("shows Running when running and not paused", () => {
    expect(formatExecutionStatusForUi("running", false)).toBe("Running");
  });

  it("returns Loading when status is undefined", () => {
    expect(formatExecutionStatusForUi(undefined, false)).toBe("Loading…");
  });

  it("maps failed to AI Failed", () => {
    expect(formatExecutionStatusForUi("failed", false)).toBe("AI Failed");
  });
});

describe("pickAdjacentProjectRunIdForNav", () => {
  const tpl = "00000000-0000-4000-8000-0000000000aa";
  const mk = (id: string, start: number): ProjectExecute => ({
    id,
    linkedTemplateId: tpl,
    name: "p",
    description: "",
    targetUrl: "",
    aiPrompt: "",
    status: "completed",
    steps: [],
    progressPercentage: 100,
    startTime: start,
    durationMs: 1,
    results: [],
  });

  it("prefers the run below when removing a middle item", () => {
    const a = mk("a", 1);
    const b = mk("b", 2);
    const c = mk("c", 3);
    expect(
      pickAdjacentProjectRunIdForNav(
        projectNavState({
          chatActiveTemplateId: "b",
          globalExecutionsList: [a, b, c],
        }),
        "b",
      ),
    ).toBe("c");
  });

  it("uses the run above when removing the last item", () => {
    const a = mk("a", 1);
    const b = mk("b", 2);
    expect(
      pickAdjacentProjectRunIdForNav(
        projectNavState({
          chatActiveTemplateId: "b",
          globalExecutionsList: [a, b],
        }),
        "b",
      ),
    ).toBe("a");
  });

  it("returns null when removing the only run", () => {
    const b = mk("b", 1);
    expect(
      pickAdjacentProjectRunIdForNav(
        projectNavState({
          chatActiveTemplateId: "b",
          globalExecutionsList: [b],
        }),
        "b",
      ),
    ).toBeNull();
  });

  it("prefers the next run in global time order across templates", () => {
    const tplA = "aaaaaaaa-aaaa-4000-8000-0000000000aa";
    const tplB = "bbbbbbbb-bbbb-4000-8000-0000000000bb";
    const mkTpl = (id: string, start: number, linked: string): ProjectExecute => ({
      id,
      linkedTemplateId: linked,
      name: "p",
      description: "",
      targetUrl: "",
      aiPrompt: "",
      status: "completed",
      steps: [],
      progressPercentage: 100,
      startTime: start,
      durationMs: 1,
      results: [],
    });
    const a = mkTpl("a", 1, tplA);
    const b = mkTpl("b", 2, tplB);
    const c = mkTpl("c", 3, tplA);
    expect(
      pickAdjacentProjectRunIdForNav(
        projectNavState({
          chatActiveTemplateId: tplA,
          globalExecutionsList: [a, b, c],
        }),
        "b",
      ),
    ).toBe("c");
  });
});

describe("visibleGlobalExecutionsForNav", () => {
  const tpl = "00000000-0000-4000-8000-0000000000aa";
  const tplB = "11111111-1111-4000-8000-0000000000bb";
  const mkRun = (id: string, start: number, linked: string): ProjectExecute => ({
    id,
    linkedTemplateId: linked,
    name: "p",
    description: "",
    targetUrl: "",
    aiPrompt: "",
    status: "completed",
    steps: [],
    progressPercentage: 100,
    startTime: start,
    durationMs: 1,
    results: [],
  });

  it(`lists at most ${PROJECT_RUN_NAV_MAX} runs across all test plans, newest first`, () => {
    const runs = [
      ...Array.from({ length: 12 }, (_, i) => mkRun(`a-${i}`, i + 1, tpl)),
      mkRun("other", 99, tplB),
    ];
    const state = projectNavState({
      chatActiveTemplateId: tpl,
      globalExecutionsList: runs,
    });
    const nav = visibleGlobalExecutionsForNav(state);
    expect(nav).toHaveLength(PROJECT_RUN_NAV_MAX);
    expect(nav[0]?.id).toBe("other");
    expect(nav[1]?.id).toBe("a-11");
  });

  it("keeps per-template chronological list for ordinals", () => {
    const runs = Array.from({ length: 12 }, (_, i) => mkRun(`run-${i}`, i + 1, tpl));
    const state = projectNavState({
      chatActiveTemplateId: tpl,
      globalExecutionsList: runs,
    });
    expect(visibleTemplateExecutionsChronological(state, tpl)).toHaveLength(12);
  });
});

describe("projectRunScreenshotSteps", () => {
  it("flattens screenshot URLs from nested results", () => {
    const ex: ProjectExecute = {
      id: "e1",
      linkedTemplateId: "t1",
      name: "n",
      description: "",
      targetUrl: "",
      aiPrompt: "",
      status: "running",
      steps: [],
      progressPercentage: 50,
      startTime: Date.now(),
      durationMs: null,
      results: [
        {
          nodeId: "n1",
          nodeKey: "k",
          type: "page",
          title: "T",
          status: "Success",
          testCaseRuns: [
            {
              caseId: "c1",
              title: "Case",
              status: "Success",
              testCaseStepRuns: [
                {
                  stepId: "s1",
                  sortOrder: 1,
                  procedureText: "Step A",
                  expectedResult: "ok",
                  mustPass: true,
                  status: "Success",
                  screenshotUrl: "data:image/png;base64,AAA",
                },
              ],
            },
          ],
        },
      ],
    };
    const steps = projectRunScreenshotSteps(ex);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.label).toBe("Step A");
    expect(steps[0]?.url).toMatch(/^data:image\/png/);
  });
});
