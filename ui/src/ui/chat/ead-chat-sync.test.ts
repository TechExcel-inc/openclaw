import { describe, expect, it, vi, beforeEach } from "vitest";
import { switchChatSession } from "./ead-chat-sync.ts";

const loadChatHistoryMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../controllers/chat.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../controllers/chat.ts")>();
  return { ...actual, loadChatHistory: loadChatHistoryMock };
});

vi.mock("../controllers/sessions.ts", () => ({
  loadSessions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../app-settings.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app-settings.ts")>();
  return {
    ...actual,
    syncUrlWithSessionKey: vi.fn(),
  };
});

function minimalHost(overrides: Record<string, unknown> = {}) {
  const settings = {
    sessionKey: "agent:main:main:eadproj:run:run_a",
    lastActiveSessionKey: "agent:main:main:eadproj:run:run_a",
    gatewayUrl: "",
    theme: "lobster",
    themeMode: "dark",
    navCollapsed: false,
    chatFocusMode: false,
    borderRadius: 8,
  };
  return {
    sessionKey: "agent:main:main:eadproj:run:run_a",
    chatMessages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "OpenClaw Project Run — x. Execution id: run_a.",
          },
        ],
      },
    ],
    chatMessage: "",
    chatStream: null,
    chatQueue: [] as unknown[],
    chatStreamStartedAt: null,
    chatRunId: null,
    chatWaitingUserRunId: null,
    chatLastWaitDurationMs: null,
    settings,
    tab: "chatProjectRun",
    chatProjectRunExecutionId: "run_b",
    chatActiveTemplateId: "run_b",
    chatShowNoneProjectChat: false,
    templatesList: [] as Array<{ id: string }>,
    globalExecutionsList: [] as Array<{ id: string }>,
    applySettings: vi.fn((next: typeof settings) => {
      Object.assign(settings, next);
    }),
    loadAssistantIdentity: vi.fn(),
    resetToolStream: vi.fn(),
    resetChatScroll: vi.fn(),
    ...overrides,
  };
}

describe("switchChatSession", () => {
  beforeEach(() => {
    loadChatHistoryMock.mockClear();
  });

  it("clears chatMessages when the resolved session key changes (no cross-run merge)", () => {
    const state = minimalHost();
    switchChatSession(state as never, "agent:main:main");

    expect(state.chatMessages).toEqual([]);
    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("does not clear chatMessages when the resolved session key is unchanged", () => {
    const stale = [
      {
        role: "user",
        content: [{ type: "text", text: "pending" }],
      },
    ];
    const state = minimalHost({
      sessionKey: "agent:main:main:eadproj:run:run_b",
      chatMessages: stale,
      chatProjectRunExecutionId: "run_b",
      chatActiveTemplateId: "run_b",
    });
    switchChatSession(state as never, "agent:main:main");

    expect(state.chatMessages).toEqual(stale);
    expect(loadChatHistoryMock).not.toHaveBeenCalled();
  });
});
