import { describe, expect, it } from "vitest";
import {
  buildEadProjectChatSessionKey,
  EAD_PROJECT_MARKER,
  resolveEadProjectContextFromState,
  stripEadProjectSuffix,
} from "./ead-project-session-key.ts";

describe("stripEadProjectSuffix", () => {
  it("removes ead project suffix", () => {
    expect(stripEadProjectSuffix(`agent:main:main${EAD_PROJECT_MARKER}none`)).toBe(
      "agent:main:main",
    );
    expect(stripEadProjectSuffix(`agent:main:main${EAD_PROJECT_MARKER}tpl:abc`)).toBe(
      "agent:main:main",
    );
  });

  it("returns base when no marker", () => {
    expect(stripEadProjectSuffix("agent:main:main")).toBe("agent:main:main");
  });
});

describe("buildEadProjectChatSessionKey", () => {
  it("builds none, template, and run keys", () => {
    const base = "agent:main:main";
    expect(buildEadProjectChatSessionKey(base, { mode: "none" })).toBe(
      `agent:main:main${EAD_PROJECT_MARKER}none`,
    );
    expect(buildEadProjectChatSessionKey(base, { mode: "template", id: "t1" })).toBe(
      `agent:main:main${EAD_PROJECT_MARKER}tpl:t1`,
    );
    expect(buildEadProjectChatSessionKey(base, { mode: "run", id: "r:1" })).toBe(
      `agent:main:main${EAD_PROJECT_MARKER}run:r_1`,
    );
  });

  it("strips existing suffix before building", () => {
    const base = `agent:main:main${EAD_PROJECT_MARKER}tpl:old`;
    expect(buildEadProjectChatSessionKey(base, { mode: "none" })).toBe(
      `agent:main:main${EAD_PROJECT_MARKER}none`,
    );
  });
});

describe("resolveEadProjectContextFromState", () => {
  it("prefers none when show-none is checked", () => {
    const ctx = resolveEadProjectContextFromState({
      chatShowNoneProjectChat: true,
      chatActiveTemplateId: "tpl",
      templatesList: [{ id: "tpl" }],
      globalExecutionsList: [],
    });
    expect(ctx).toEqual({ mode: "none" });
  });

  it("uses template when id matches templates", () => {
    const ctx = resolveEadProjectContextFromState({
      chatShowNoneProjectChat: false,
      chatActiveTemplateId: "tpl",
      templatesList: [{ id: "tpl" }],
      globalExecutionsList: [],
    });
    expect(ctx).toEqual({ mode: "template", id: "tpl" });
  });

  it("uses run when id matches executions", () => {
    const ctx = resolveEadProjectContextFromState({
      chatShowNoneProjectChat: false,
      chatActiveTemplateId: "run1",
      templatesList: [],
      globalExecutionsList: [{ id: "run1" }],
    });
    expect(ctx).toEqual({ mode: "run", id: "run1" });
  });
});
