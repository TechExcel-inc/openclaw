import { describe, expect, it, vi } from "vitest";
import type { ProjectExecute } from "../../../../src/projects/types.js";
import { GatewayRequestError } from "../gateway.ts";
import {
  abortChatRun,
  handleChatEvent,
  loadChatHistory,
  sendChatMessage,
  sortChatMessagesChronologically,
  type ChatEventPayload,
  type ChatState,
} from "./chat.ts";
import { setActiveExecution } from "./projects.ts";

function minimalRunningExecution(id: string): ProjectExecute {
  return {
    id,
    linkedTemplateId: "tmpl-1",
    name: "Run",
    description: "",
    aiPrompt: "",
    status: "running",
    steps: [],
    progressPercentage: 50,
    startTime: Date.now(),
    durationMs: null,
    results: [],
  };
}

function createState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    chatAttachments: [],
    chatLoading: false,
    chatMessage: "",
    chatMessages: [],
    chatRunId: null,
    chatSending: false,
    chatStream: null,
    chatStreamStartedAt: null,
    chatThinkingLevel: null,
    client: null,
    connected: true,
    lastError: null,
    sessionKey: "main",
    ...overrides,
  };
}

describe("handleChatEvent", () => {
  it("returns null when payload is missing", () => {
    const state = createState();
    expect(handleChatEvent(state, undefined)).toBe(null);
  });

  it("returns null when sessionKey does not match", () => {
    const state = createState({ sessionKey: "main" });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "other",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe(null);
  });

  it("returns null for delta from another run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Hello",
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Hello");
  });

  it("applies delta from another run when tab is chatProjectRun", () => {
    const state = createState({
      sessionKey: "main",
      tab: "chatProjectRun",
      chatRunId: "run-user-followup",
      chatStream: "",
    });
    const payload: ChatEventPayload = {
      runId: "run-bootstrap",
      sessionKey: "main",
      state: "delta",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Exploring the target site…" }],
      },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatRunId).toBe("run-user-followup");
    expect(state.chatStream).toBe("Exploring the target site…");
  });

  it("Project Run: final from server run id clears client chatRunId and returns final so queue can flush", () => {
    const state = createState({
      sessionKey: "main",
      tab: "chatProjectRun",
      chatRunId: "client-idempotency-uuid",
      chatStream: "Partial…",
      chatStreamStartedAt: 999,
    });
    const payload: ChatEventPayload = {
      runId: "project-run-bootstrap:exec-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Done with this step." }],
      },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    // When there IS an active in-flight user response (both chatRunId and chatStream are
    // non-null), preserve them so loadChatHistory doesn't wipe the in-flight reply.
    expect(state.chatRunId).toBe("client-idempotency-uuid");
    expect(state.chatStream).toBe("Partial…");
    expect(state.chatStreamStartedAt).toBe(999);
    expect(state.chatMessages).toHaveLength(1);
  });

  it("Project Run: cross-run final with no in-flight stream still cleans up state", () => {
    const state = createState({
      sessionKey: "main",
      tab: "chatProjectRun",
      chatRunId: "client-idempotency-uuid",
      chatStream: null,
      chatStreamStartedAt: 999,
    });
    const payload: ChatEventPayload = {
      runId: "project-run-bootstrap:exec-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Done with this step." }],
      },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    // No in-flight response (chatStream is null) → clean up as before.
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
  });

  it("ignores NO_REPLY delta updates", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Hello",
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "NO_REPLY" }] },
    };

    expect(handleChatEvent(state, payload)).toBe("delta");
    expect(state.chatStream).toBe("Hello");
  });

  it("appends final payload from another run without clearing active stream", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Sub-agent findings" }],
      },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
    expect(state.chatStreamStartedAt).toBe(123);
    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatMessages[0]).toEqual(payload.message);
  });

  it("drops NO_REPLY final payload from another run without clearing active stream", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "NO_REPLY" }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
    expect(state.chatStreamStartedAt).toBe(123);
    expect(state.chatMessages).toEqual([]);
  });

  it("returns final for another run when payload has no message", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatMessages).toEqual([]);
  });

  it("does not show inter-turn working placeholder after final even when project run execution is still running", () => {
    const state = createState({
      sessionKey: "main",
      tab: "chatProjectRun",
      chatProjectRunExecutionId: "exec-1",
      chatRunId: "run-1",
      globalExecutionsList: [
        {
          id: "exec-1",
          linkedTemplateId: "t",
          name: "n",
          description: "",
          targetUrl: "",
          aiPrompt: "",
          status: "running",
          paused: false,
          steps: [],
          progressPercentage: 10,
          startTime: Date.now(),
          durationMs: null,
          results: [],
        },
      ],
      executionDetail: null,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Turn one done" }],
        timestamp: Date.now(),
      },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
  });

  it("does not show inter-turn working placeholder after final even when project run execution is pending", () => {
    const state = createState({
      sessionKey: "main",
      tab: "chatProjectRun",
      chatProjectRunExecutionId: "exec-pend",
      chatRunId: "run-1",
      globalExecutionsList: [
        {
          id: "exec-pend",
          linkedTemplateId: "t",
          name: "n",
          description: "",
          targetUrl: "",
          aiPrompt: "",
          status: "pending",
          paused: false,
          steps: [],
          progressPercentage: 5,
          startTime: Date.now(),
          durationMs: null,
          results: [],
        },
      ],
      executionDetail: null,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "First output" }],
        timestamp: Date.now(),
      },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
  });

  it("does not show inter-turn placeholder after final when project run execution is completed", () => {
    const state = createState({
      sessionKey: "main",
      tab: "chatProjectRun",
      chatProjectRunExecutionId: "exec-1",
      chatRunId: "run-1",
      globalExecutionsList: [
        {
          id: "exec-1",
          linkedTemplateId: "t",
          name: "n",
          description: "",
          targetUrl: "",
          aiPrompt: "",
          status: "completed",
          paused: false,
          steps: [],
          progressPercentage: 100,
          startTime: Date.now(),
          durationMs: 1000,
          results: [],
        },
      ],
      executionDetail: null,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Done" }],
        timestamp: Date.now(),
      },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
  });

  it("persists streamed text when final event carries no message", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Here is my reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(existingMessage);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Here is my reply" }],
    });
  });

  it("does not persist empty or whitespace-only stream on final", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "   ",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatMessages).toEqual([]);
  });

  it("does not persist null stream on final with no message", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: null,
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
  });

  it("prefers final payload message over streamed text", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Streamed partial",
      chatStreamStartedAt: 100,
    });
    const finalMsg = {
      role: "assistant",
      content: [{ type: "text", text: "Complete reply" }],
      timestamp: 101,
    };
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: finalMsg,
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([finalMsg]);
    expect(state.chatStream).toBe(null);
  });

  it("appends final payload message from own run before clearing stream state", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Reply",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Reply" }],
        timestamp: 101,
      },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([payload.message]);
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
  });

  it("processes aborted from own run and keeps partial assistant message", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const partialMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
      timestamp: 2,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: partialMessage,
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toEqual([existingMessage, partialMessage]);
  });

  it("falls back to streamed partial when aborted payload message is invalid", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: "not-an-assistant-message",
    } as unknown as ChatEventPayload;

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(existingMessage);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
    });
  });

  it("falls back to streamed partial when aborted payload has non-assistant role", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: {
        role: "user",
        content: [{ type: "text", text: "unexpected" }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
    });
  });

  it("processes aborted from own run without message and empty stream", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toEqual([existingMessage]);
  });

  it("drops NO_REPLY final payload from another run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "NO_REPLY" }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
  });

  it("drops NO_REPLY final payload from own run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "NO_REPLY",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "NO_REPLY" }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
  });

  it("does not persist NO_REPLY stream text on final without message", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "NO_REPLY",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
  });

  it("does not persist NO_REPLY stream text on abort", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "NO_REPLY",
      chatStreamStartedAt: 100,
    });
    const payload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: "not-an-assistant-message",
    } as unknown as ChatEventPayload;

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatMessages).toEqual([]);
  });

  it("keeps user messages containing NO_REPLY text", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "user",
        content: [{ type: "text", text: "NO_REPLY" }],
      },
    };

    // User messages with NO_REPLY text should NOT be filtered — only assistant messages.
    // normalizeFinalAssistantMessage returns null for user role, so this falls through.
    expect(handleChatEvent(state, payload)).toBe("final");
  });

  it("keeps assistant message when text field has real reply but content is NO_REPLY", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        text: "real reply",
        content: "NO_REPLY",
      },
    };

    // entry.text takes precedence — "real reply" is NOT silent, so the message is kept.
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toHaveLength(1);
  });
});

describe("project run session bootstrap", () => {
  const chatQueueEmpty = { chatQueue: [] as unknown[] };

  it("creates the run session and bootstraps the first Project Run turn", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.create") {
        return { key: "agent:main:main:eadproj:run:run-123" };
      }
      if (method === "chat.inject") {
        return { ok: true };
      }
      if (method === "chat.history") {
        return { messages: [] };
      }
      if (method === "chat.send") {
        return { runId: "bootstrap-run", status: "started" };
      }
      if (method === "executions.get") {
        return {
          id: "run-123",
          name: "Project One Test",
          description: "Explore the host app",
          targetUrl: "https://example.com",
          aiPrompt: "Map major product areas",
          authMode: "reuse-session",
          authSessionProfile: "qa-admin-session",
          status: "running",
        };
      }
      return undefined;
    });

    const state = {
      client: { request },
      connected: true,
      templatesLoading: false,
      templatesError: null,
      templatesList: [],
      activeTemplateId: null,
      templateDetail: null,
      templateDetailLoading: false,
      templateCreating: false,
      showCreateModal: false,
      createFormName: "",
      createFormDescription: "",
      createFormTargetUrl: "",
      createFormAiPrompt: "",
      createFormAuthMode: "none" as const,
      createFormAuthLoginUrl: "",
      createFormAuthSessionProfile: "",
      createFormAuthInstructions: "",
      createFormShowLocalBrowser: false,
      projectAuthProfilesLoading: false,
      projectAuthProfilesError: null,
      projectAuthProfiles: [],
      executionsLoading: false,
      executionsError: null,
      executionsList: [],
      activeExecutionId: null as string | null,
      executionDetail: null,
      executionDetailLoading: false,
      globalExecutionsLoading: false,
      globalExecutionsList: [],
      sessionKey: "agent:main:main:eadproj:run:run-123",
      tab: "chatProjectRun",
      chatProjectRunExecutionId: "run-123",
      ...chatQueueEmpty,
    };

    await setActiveExecution(state as Parameters<typeof setActiveExecution>[0], "run-123");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(request).toHaveBeenCalledWith("browser.request", {
      method: "GET",
      path: "/profiles",
    });
    expect(request).toHaveBeenCalledWith("sessions.create", {
      key: "agent:main:main:eadproj:run:run-123",
      label: "Project Run run-123",
      parentSessionKey: "agent:main:main",
    });
    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "agent:main:main:eadproj:run:run-123",
      limit: 200,
    });
    expect(request).toHaveBeenCalledWith("executions.get", { id: "run-123" });
    expect(request).toHaveBeenCalledWith("chat.inject", {
      sessionKey: "agent:main:main:eadproj:run:run-123",
      label: "Project Run Context",
      message: expect.stringContaining("Execution id: run-123."),
    });
    expect(request).toHaveBeenCalledWith("chat.send", {
      sessionKey: "agent:main:main:eadproj:run:run-123",
      deliver: false,
      idempotencyKey: "project-run-bootstrap:run-123",
      message: expect.stringContaining("Session reuse hint: qa-admin-session."),
    });
  });

  it("sends Project Run bootstrap at most once per execution when setActiveExecution runs twice", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.create") {
        return { key: "agent:main:main:eadproj:run:run-dup-1" };
      }
      if (method === "chat.inject") {
        return { ok: true };
      }
      if (method === "chat.history") {
        return { messages: [] };
      }
      if (method === "chat.send") {
        return { runId: "bootstrap-run", status: "started" };
      }
      if (method === "executions.get") {
        return {
          id: "run-dup-1",
          name: "P",
          description: "d",
          targetUrl: "https://example.com",
          aiPrompt: "x",
          authMode: "none" as const,
          status: "running",
        };
      }
      return undefined;
    });

    const state = {
      client: { request },
      connected: true,
      templatesLoading: false,
      templatesError: null,
      templatesList: [],
      activeTemplateId: null,
      templateDetail: null,
      templateDetailLoading: false,
      templateCreating: false,
      showCreateModal: false,
      createFormName: "",
      createFormDescription: "",
      createFormTargetUrl: "",
      createFormAiPrompt: "",
      createFormAuthMode: "none" as const,
      createFormAuthLoginUrl: "",
      createFormAuthSessionProfile: "",
      createFormAuthInstructions: "",
      createFormShowLocalBrowser: false,
      projectAuthProfilesLoading: false,
      projectAuthProfilesError: null,
      projectAuthProfiles: [],
      executionsLoading: false,
      executionsError: null,
      executionsList: [],
      activeExecutionId: null as string | null,
      executionDetail: null,
      executionDetailLoading: false,
      globalExecutionsLoading: false,
      globalExecutionsList: [],
      sessionKey: "agent:main:main:eadproj:run:run-dup-1",
      tab: "chatProjectRun",
      chatProjectRunExecutionId: "run-dup-1",
      ...chatQueueEmpty,
    };

    await setActiveExecution(state as Parameters<typeof setActiveExecution>[0], "run-dup-1");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await setActiveExecution(state as Parameters<typeof setActiveExecution>[0], "run-dup-1");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const sends = request.mock.calls.filter((c) => c[0] === "chat.send");
    expect(sends).toHaveLength(1);
  });

  it("does not chat.inject Project Run context when history already has messages", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.create") {
        return { key: "agent:main:main:eadproj:run:run-789" };
      }
      if (method === "chat.history") {
        return {
          messages: [{ role: "user", content: [{ type: "text", text: "prior" }] }],
        };
      }
      if (method === "executions.get") {
        return {
          id: "run-789",
          name: "Project One Test",
          description: "Explore the host app",
          targetUrl: "https://example.com",
          aiPrompt: "Map major product areas",
          authMode: "reuse-session",
          authSessionProfile: "qa-admin-session",
          status: "running",
        };
      }
      return undefined;
    });

    const state = {
      client: { request },
      connected: true,
      templatesLoading: false,
      templatesError: null,
      templatesList: [],
      activeTemplateId: null,
      templateDetail: null,
      templateDetailLoading: false,
      templateCreating: false,
      showCreateModal: false,
      createFormName: "",
      createFormDescription: "",
      createFormTargetUrl: "",
      createFormAiPrompt: "",
      createFormAuthMode: "none" as const,
      createFormAuthLoginUrl: "",
      createFormAuthSessionProfile: "",
      createFormAuthInstructions: "",
      createFormShowLocalBrowser: false,
      projectAuthProfilesLoading: false,
      projectAuthProfilesError: null,
      projectAuthProfiles: [],
      executionsLoading: false,
      executionsError: null,
      executionsList: [],
      activeExecutionId: null as string | null,
      executionDetail: null,
      executionDetailLoading: false,
      globalExecutionsLoading: false,
      globalExecutionsList: [],
      sessionKey: "agent:main:main:eadproj:run:run-789",
      tab: "chatProjectRun",
      chatProjectRunExecutionId: "run-789",
      ...chatQueueEmpty,
    };

    await setActiveExecution(state as Parameters<typeof setActiveExecution>[0], "run-789");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(request).not.toHaveBeenCalledWith(
      "chat.inject",
      expect.objectContaining({
        sessionKey: "agent:main:main:eadproj:run:run-789",
      }),
    );
  });

  it("does not chat.inject Project Run context when history is empty but execution is completed", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.create") {
        return { key: "agent:main:main:eadproj:run:run-done" };
      }
      if (method === "chat.history") {
        return { messages: [] };
      }
      if (method === "executions.get") {
        return {
          id: "run-done",
          name: "Project One Test",
          description: "Explore the host app",
          targetUrl: "https://example.com",
          aiPrompt: "Map major product areas",
          authMode: "reuse-session",
          authSessionProfile: "qa-admin-session",
          status: "completed",
          durationMs: 5000,
        };
      }
      return undefined;
    });

    const state = {
      client: { request },
      connected: true,
      templatesLoading: false,
      templatesError: null,
      templatesList: [],
      activeTemplateId: null,
      templateDetail: null,
      templateDetailLoading: false,
      templateCreating: false,
      showCreateModal: false,
      createFormName: "",
      createFormDescription: "",
      createFormTargetUrl: "",
      createFormAiPrompt: "",
      createFormAuthMode: "none" as const,
      createFormAuthLoginUrl: "",
      createFormAuthSessionProfile: "",
      createFormAuthInstructions: "",
      createFormShowLocalBrowser: false,
      projectAuthProfilesLoading: false,
      projectAuthProfilesError: null,
      projectAuthProfiles: [],
      executionsLoading: false,
      executionsError: null,
      executionsList: [],
      activeExecutionId: null as string | null,
      executionDetail: null,
      executionDetailLoading: false,
      globalExecutionsLoading: false,
      globalExecutionsList: [],
      sessionKey: "agent:main:main:eadproj:run:run-done",
      tab: "chatProjectRun",
      chatProjectRunExecutionId: "run-done",
      ...chatQueueEmpty,
    };

    await setActiveExecution(state as Parameters<typeof setActiveExecution>[0], "run-done");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(request).not.toHaveBeenCalledWith(
      "chat.inject",
      expect.objectContaining({
        sessionKey: "agent:main:main:eadproj:run:run-done",
      }),
    );
  });

  it("does not inject context or bootstrap when runSessionKey is set (server kickoff already ran)", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.create") {
        return { key: "agent:main:main:eadproj:run:run-srv" };
      }
      if (method === "chat.history") {
        return { messages: [] };
      }
      if (method === "executions.get") {
        return {
          id: "run-srv",
          name: "Project One Test",
          description: "Explore the host app",
          targetUrl: "https://example.com",
          aiPrompt: "Map major product areas",
          authMode: "reuse-session",
          authSessionProfile: "qa-admin-session",
          status: "running",
          runSessionKey: "agent:main:main:eadproj:run:run-srv",
        };
      }
      return undefined;
    });

    const state = {
      client: { request },
      connected: true,
      templatesLoading: false,
      templatesError: null,
      templatesList: [],
      activeTemplateId: null,
      templateDetail: null,
      templateDetailLoading: false,
      templateCreating: false,
      showCreateModal: false,
      createFormName: "",
      createFormDescription: "",
      createFormTargetUrl: "",
      createFormAiPrompt: "",
      createFormAuthMode: "none" as const,
      createFormAuthLoginUrl: "",
      createFormAuthSessionProfile: "",
      createFormAuthInstructions: "",
      createFormShowLocalBrowser: false,
      projectAuthProfilesLoading: false,
      projectAuthProfilesError: null,
      projectAuthProfiles: [],
      executionsLoading: false,
      executionsError: null,
      executionsList: [],
      activeExecutionId: null as string | null,
      executionDetail: null,
      executionDetailLoading: false,
      globalExecutionsLoading: false,
      globalExecutionsList: [],
      sessionKey: "agent:main:main:eadproj:run:run-srv",
      tab: "chatProjectRun",
      chatProjectRunExecutionId: "run-srv",
      ...chatQueueEmpty,
    };

    await setActiveExecution(state as Parameters<typeof setActiveExecution>[0], "run-srv");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(request).not.toHaveBeenCalledWith(
      "chat.inject",
      expect.objectContaining({
        sessionKey: "agent:main:main:eadproj:run:run-srv",
      }),
    );
    expect(request).not.toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        idempotencyKey: "project-run-bootstrap:run-srv",
      }),
    );
  });

  it("does not auto-bootstrap manual-bootstrap runs before resume", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "browser.request") {
        return { profiles: [] };
      }
      if (method === "chat.history") {
        return { messages: [] };
      }
      if (method === "executions.get") {
        return {
          id: "run-456",
          name: "Project One Test",
          description: "Explore the host app",
          targetUrl: "https://example.com",
          aiPrompt: "Map major product areas",
          authMode: "manual-bootstrap",
          authInstructions: "Log in first.",
        };
      }
      return undefined;
    });

    const state = {
      client: { request },
      connected: true,
      templatesLoading: false,
      templatesError: null,
      templatesList: [],
      activeTemplateId: null,
      templateDetail: null,
      templateDetailLoading: false,
      templateCreating: false,
      showCreateModal: false,
      createFormName: "",
      createFormDescription: "",
      createFormTargetUrl: "",
      createFormAiPrompt: "",
      createFormAuthMode: "none" as const,
      createFormAuthLoginUrl: "",
      createFormAuthSessionProfile: "",
      createFormAuthInstructions: "",
      createFormShowLocalBrowser: false,
      projectAuthProfilesLoading: false,
      projectAuthProfilesError: null,
      projectAuthProfiles: [],
      executionsLoading: false,
      executionsError: null,
      executionsList: [],
      activeExecutionId: null as string | null,
      executionDetail: null,
      executionDetailLoading: false,
      globalExecutionsLoading: false,
      globalExecutionsList: [],
      sessionKey: "agent:main:main:eadproj:run:run-456",
      tab: "chatProjectRun",
      chatProjectRunExecutionId: "run-456",
      ...chatQueueEmpty,
    };

    await setActiveExecution(state as Parameters<typeof setActiveExecution>[0], "run-456");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(request).toHaveBeenCalledWith("sessions.create", {
      key: "agent:main:main:eadproj:run:run-456",
      label: "Project Run run-456",
      parentSessionKey: "agent:main:main",
    });
    expect(request).toHaveBeenCalledWith("executions.get", { id: "run-456" });
    expect(request).not.toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        sessionKey: "agent:main:main:eadproj:run:run-456",
      }),
    );
  });

  it("does not inject context or bootstrap when dashboard selects another run than the open Project Run chat", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.create") {
        return { key: "agent:main:main:eadproj:run:run-b" };
      }
      if (method === "chat.history") {
        return { messages: [] };
      }
      if (method === "executions.get") {
        return {
          id: "run-b",
          name: "Other template run",
          description: "Other plan",
          targetUrl: "https://other.example",
          aiPrompt: "Different instructions from another test plan",
          authMode: "none",
          status: "running",
        };
      }
      return undefined;
    });

    const state = {
      client: { request },
      connected: true,
      templatesLoading: false,
      templatesError: null,
      templatesList: [],
      activeTemplateId: null,
      templateDetail: null,
      templateDetailLoading: false,
      templateCreating: false,
      showCreateModal: false,
      createFormName: "",
      createFormDescription: "",
      createFormTargetUrl: "",
      createFormAiPrompt: "",
      createFormAuthMode: "none" as const,
      createFormAuthLoginUrl: "",
      createFormAuthSessionProfile: "",
      createFormAuthInstructions: "",
      createFormShowLocalBrowser: false,
      projectAuthProfilesLoading: false,
      projectAuthProfilesError: null,
      projectAuthProfiles: [],
      executionsLoading: false,
      executionsError: null,
      executionsList: [],
      activeExecutionId: null as string | null,
      executionDetail: null,
      executionDetailLoading: false,
      globalExecutionsLoading: false,
      globalExecutionsList: [],
      sessionKey: "agent:main:main:eadproj:run:run-a",
      tab: "chatProjectRun",
      chatProjectRunExecutionId: "run-a",
      ...chatQueueEmpty,
    };

    await setActiveExecution(state as Parameters<typeof setActiveExecution>[0], "run-b");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(request).not.toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        idempotencyKey: "project-run-bootstrap:run-b",
      }),
    );
    expect(request).not.toHaveBeenCalledWith(
      "chat.inject",
      expect.objectContaining({
        sessionKey: "agent:main:main:eadproj:run:run-b",
      }),
    );
  });
});

describe("loadChatHistory", () => {
  it("filters NO_REPLY assistant messages from history", async () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: [{ type: "text", text: "NO_REPLY" }] },
      { role: "assistant", content: [{ type: "text", text: "Real answer" }] },
      { role: "assistant", text: "  NO_REPLY  " },
    ];
    const mockClient = {
      request: vi.fn().mockResolvedValue({ messages, thinkingLevel: "low" }),
    };
    const state = createState({
      client: mockClient as unknown as ChatState["client"],
      connected: true,
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(messages[0]);
    expect(state.chatMessages[1]).toEqual(messages[2]);
    expect(state.chatThinkingLevel).toBe("low");
    expect(state.chatLoading).toBe(false);
  });

  it("keeps assistant message when text field has real content but content is NO_REPLY", async () => {
    const messages = [{ role: "assistant", text: "real reply", content: "NO_REPLY" }];
    const mockClient = {
      request: vi.fn().mockResolvedValue({ messages }),
    };
    const state = createState({
      client: mockClient as unknown as ChatState["client"],
      connected: true,
    });

    await loadChatHistory(state);

    // text takes precedence — "real reply" is NOT silent, so message is kept.
    expect(state.chatMessages).toHaveLength(1);
  });
});

describe("sendChatMessage", () => {
  it("formats structured non-auth connect failures for chat send", async () => {
    const request = vi.fn().mockRejectedValue(
      new GatewayRequestError({
        code: "INVALID_REQUEST",
        message: "Fetch failed",
        details: { code: "CONTROL_UI_ORIGIN_NOT_ALLOWED" },
      }),
    );
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    const result = await sendChatMessage(state, "hello");

    expect(result).toBeNull();
    expect(state.lastError).toContain("origin not allowed");
    expect(state.chatMessages.at(-1)).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "text",
          text: expect.stringContaining("origin not allowed"),
        },
      ],
    });
  });
});

describe("abortChatRun", () => {
  it("formats structured non-auth connect failures for chat abort", async () => {
    // Abort now shares the same structured connect-error formatter as send.
    const request = vi.fn().mockRejectedValue(
      new GatewayRequestError({
        code: "INVALID_REQUEST",
        message: "Fetch failed",
        details: { code: "CONTROL_UI_DEVICE_IDENTITY_REQUIRED" },
      }),
    );
    const state = createState({
      connected: true,
      chatRunId: "run-1",
      client: { request } as unknown as ChatState["client"],
    });

    const result = await abortChatRun(state);

    expect(result).toBe(false);
    expect(request).toHaveBeenCalledWith("chat.abort", {
      sessionKey: "main",
      runId: "run-1",
    });
    expect(state.lastError).toContain("device identity required");
  });
});

describe("loadChatHistory", () => {
  it("filters assistant NO_REPLY messages and keeps user NO_REPLY messages", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        { role: "assistant", content: [{ type: "text", text: "NO_REPLY" }] },
        { role: "assistant", content: [{ type: "text", text: "visible answer" }] },
        { role: "user", content: [{ type: "text", text: "NO_REPLY" }] },
      ],
      thinkingLevel: "low",
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "main",
      limit: 200,
    });
    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "visible answer" }] },
      { role: "user", content: [{ type: "text", text: "NO_REPLY" }] },
    ]);
    expect(state.chatThinkingLevel).toBe("low");
    expect(state.chatLoading).toBe(false);
    expect(state.lastError).toBeNull();
  });

  it("preserves trailing user messages not yet returned by chat.history", async () => {
    const serverMsgs = [
      { role: "user", content: [{ type: "text", text: "start" }] },
      { role: "assistant", content: [{ type: "text", text: "working" }] },
    ];
    const pendingUser = {
      role: "user",
      content: [{ type: "text", text: "Operator follow-up question" }],
      timestamp: Date.now(),
    };
    const request = vi.fn().mockResolvedValue({ messages: serverMsgs });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatMessages: [...serverMsgs, pendingUser],
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([...serverMsgs, pendingUser]);
  });

  it("preserves image-only user messages not yet returned by chat.history", async () => {
    const serverMsgs = [
      { role: "user", content: [{ type: "text", text: "start" }] },
      { role: "assistant", content: [{ type: "text", text: "working" }] },
    ];
    const imgOnlyUser = {
      role: "user",
      content: [{ type: "image", url: "https://example.com/x.png" }],
      timestamp: 1_700_000_000_000,
    };
    const request = vi.fn().mockResolvedValue({ messages: serverMsgs });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatMessages: [...serverMsgs, imgOnlyUser],
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([...serverMsgs, imgOnlyUser]);
  });

  it("preserves a user message when an assistant message already follows it locally (stale history reload)", async () => {
    const serverMsgs = [
      { role: "user", content: [{ type: "text", text: "bootstrap" }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
    ];
    const followUpUser = {
      role: "user",
      content: [{ type: "text", text: "Please explain your steps" }],
      timestamp: 1,
    };
    const draftAssistant = {
      role: "assistant",
      content: [{ type: "text", text: "draft reply not on server yet" }],
      timestamp: 2,
    };
    const request = vi.fn().mockResolvedValue({ messages: serverMsgs });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatMessages: [...serverMsgs, followUpUser, draftAssistant],
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([...serverMsgs, followUpUser]);
  });

  it("preserves reading indicator and stream timing while an outbound chat run is in flight", async () => {
    const request = vi.fn().mockResolvedValue({ messages: [] });
    const startedAt = 1_700_000_000_000;
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatRunId: "user-follow-up-run",
      chatStream: "",
      chatStreamStartedAt: startedAt,
    });

    await loadChatHistory(state);

    expect(state.chatStream).toBe("");
    expect(state.chatStreamStartedAt).toBe(startedAt);
  });

  it("preserves inter-turn Project Run placeholder when execution is still active", async () => {
    const request = vi.fn().mockResolvedValue({ messages: [] });
    const execId = "exec-active";
    const startedAt = 1_700_000_000_001;
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      tab: "chatProjectRun",
      chatProjectRunExecutionId: execId,
      globalExecutionsList: [minimalRunningExecution(execId)],
      chatRunId: null,
      chatStream: "",
      chatStreamStartedAt: startedAt,
    });

    await loadChatHistory(state);

    expect(state.chatStream).toBe("");
    expect(state.chatStreamStartedAt).toBe(startedAt);
  });

  it("shows a targeted message when chat history is unauthorized", async () => {
    const request = vi.fn().mockRejectedValue(
      new GatewayRequestError({
        code: "PERMISSION_DENIED",
        message: "not allowed",
        details: { code: "AUTH_UNAUTHORIZED" },
      }),
    );
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatMessages: [{ role: "assistant", content: [{ type: "text", text: "old" }] }],
      chatThinkingLevel: "high",
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([]);
    expect(state.chatThinkingLevel).toBeNull();
    expect(state.lastError).toContain("operator.read");
    expect(state.chatLoading).toBe(false);
  });

  it("reorders merged messages by timestamp when both server and preserved user rows have times", async () => {
    const serverMsgs = [
      {
        role: "assistant",
        content: [{ type: "text", text: "newer" }],
        timestamp: 2000,
      },
      {
        role: "toolResult",
        content: [{ type: "tool_result", text: "ok" }],
        timestamp: 2001,
      },
    ];
    const olderUser = {
      role: "user",
      content: [{ type: "text", text: "Earlier question" }],
      timestamp: 1000,
    };
    const request = vi.fn().mockResolvedValue({ messages: serverMsgs });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatMessages: [...serverMsgs, olderUser],
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([olderUser, ...serverMsgs]);
  });
});

describe("sortChatMessagesChronologically", () => {
  it("orders by timestamp when both messages have timestamps", () => {
    const newer = {
      role: "assistant",
      content: [{ type: "text", text: "b" }],
      timestamp: 2000,
    };
    const older = {
      role: "user",
      content: [{ type: "text", text: "a" }],
      timestamp: 1000,
    };
    expect(sortChatMessagesChronologically([newer, older])).toEqual([older, newer]);
  });

  it("preserves merge order when a message lacks a timestamp", () => {
    const noTs = { role: "user", content: [{ type: "text", text: "x" }] };
    const withTs = { role: "user", content: [{ type: "text", text: "y" }], timestamp: 100 };
    expect(sortChatMessagesChronologically([noTs, withTs])).toEqual([noTs, withTs]);
  });

  it("is stable for equal timestamps", () => {
    const one = { role: "user", content: [{ type: "text", text: "1" }], timestamp: 100 };
    const two = { role: "user", content: [{ type: "text", text: "2" }], timestamp: 100 };
    const out = sortChatMessagesChronologically([one, two]);
    expect(out[0]).toBe(one);
    expect(out[1]).toBe(two);
  });
});
