import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectExecute, ProjectTemplate } from "../../projects/types.js";

const loadProjectsStore = vi.hoisted(() => vi.fn());
const saveProjectsStore = vi.hoisted(() => vi.fn());
const runProjectExecution = vi.hoisted(() => vi.fn());
const cancelProjectExecution = vi.hoisted(() => vi.fn());
const chatAbort = vi.hoisted(() => vi.fn());
const chatInject = vi.hoisted(() => vi.fn());
const chatSend = vi.hoisted(() => vi.fn());
const sessionsCreate = vi.hoisted(() => vi.fn());
const browserRequest = vi.hoisted(() => vi.fn());

vi.mock("../../projects/store.js", () => ({
  loadProjectsStore,
  resolveProjectsStorePath: () => "/tmp/openclaw-projects-test.json",
  saveProjectsStore,
}));

vi.mock("../../projects/executor.js", () => ({
  runProjectExecution,
  cancelProjectExecution,
}));

vi.mock("./chat.js", () => ({
  chatHandlers: {
    "chat.abort": chatAbort,
    "chat.inject": chatInject,
    "chat.send": chatSend,
  },
}));

vi.mock("./sessions.js", () => ({
  sessionsHandlers: {
    "sessions.create": sessionsCreate,
  },
}));

vi.mock("./browser.js", () => ({
  browserHandlers: {
    "browser.request": browserRequest,
  },
}));

vi.mock("@mariozechner/pi-ai", () => ({
  completeSimple: vi.fn(),
}));

vi.mock("../../agents/model-auth.js", () => ({
  getApiKeyForModel: vi.fn(),
  requireApiKey: vi.fn(),
}));

vi.mock("../../agents/model-selection.js", () => ({
  resolveDefaultModelForAgent: vi.fn(),
}));

vi.mock("../../agents/pi-embedded-runner/model.js", () => ({
  resolveModelAsync: vi.fn(),
}));

vi.mock("../../agents/simple-completion-transport.js", () => ({
  prepareModelForSimpleCompletion: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

import { projectsHandlers } from "./projects.js";

async function invokeExecutionsRun(
  templateId: string,
  respond: ReturnType<typeof vi.fn>,
  overrides?: Record<string, unknown>,
) {
  await projectsHandlers["executions.run"]({
    req: {} as never,
    params: { templateId, ...overrides } as never,
    respond: respond as never,
    context: {} as never,
    client: null,
    isWebchatConnect: () => false,
  });
}

async function invokeExecutionsResume(id: string, respond: ReturnType<typeof vi.fn>) {
  await projectsHandlers["executions.resume"]({
    req: {} as never,
    params: { id } as never,
    respond: respond as never,
    context: {} as never,
    client: null,
    isWebchatConnect: () => false,
  });
}

function createTemplate(): ProjectTemplate {
  return {
    id: "template-1",
    name: "Project One Test",
    description: "Smoke test template",
    targetUrl: "https://example.com",
    aiPrompt: "Explore the app",
    authMode: "reuse-session",
    authSessionProfile: "qa-admin-session",
    totalTestSteps: 0,
    failedTestSteps: 0,
    pfmNodes: [],
    createdAt: 1,
    createdBy: "system",
    lastModifiedAt: 1,
    lastModifiedBy: "system",
  };
}

function createExecution(
  id: string,
  status: ProjectExecute["status"],
  startTime: number,
): ProjectExecute {
  return {
    id,
    linkedTemplateId: "template-1",
    name: "Project One Test",
    description: "Smoke test template",
    targetUrl: "https://example.com",
    aiPrompt: "Explore the app",
    status,
    steps: [],
    paused: status === "running",
    progressPercentage: status === "running" ? 50 : 0,
    startTime,
    durationMs: null,
    results: [],
  };
}

describe("projectsHandlers executions.run", () => {
  beforeEach(() => {
    loadProjectsStore.mockReset();
    saveProjectsStore.mockReset();
    runProjectExecution.mockReset();
    cancelProjectExecution.mockReset();
    chatAbort.mockReset();
    chatInject.mockReset();
    chatSend.mockReset();
    sessionsCreate.mockReset();
    browserRequest.mockReset();

    saveProjectsStore.mockResolvedValue(undefined);
    cancelProjectExecution.mockResolvedValue(undefined);
    runProjectExecution.mockResolvedValue(undefined);
    chatAbort.mockImplementation(async ({ respond }: { respond: Function }) => {
      respond(true, { ok: true, aborted: true, runIds: ["old-run"] });
    });
    chatInject.mockImplementation(async ({ respond }: { respond: Function }) => {
      respond(true, { ok: true });
    });
    chatSend.mockImplementation(async ({ respond }: { respond: Function }) => {
      respond(true, { runId: "agent-run-123", status: "started" });
    });
    sessionsCreate.mockImplementation(async ({ respond }: { respond: Function }) => {
      respond(true, { ok: true, key: "agent:main:main:eadproj:run:run-new" });
    });
    browserRequest.mockImplementation(async ({ respond }: { respond: Function }) => {
      respond(true, {
        profiles: [
          {
            name: "qa-admin-session",
            driver: "existing-session",
            running: true,
            tabCount: 1,
            isDefault: false,
            isRemote: false,
            cdpPort: 9222,
            cdpUrl: "ws://127.0.0.1:9222/devtools/browser/test",
            color: "#ffffff",
            transport: "cdp",
          },
        ],
      });
    });
  });

  it("cancels older active runs, creates a run session, and bootstraps OpenClaw", async () => {
    const respond = vi.fn();
    const newRunId = "00000000-0000-4000-8000-000000000001";
    const template = createTemplate();
    const running = {
      ...createExecution("run-1", "running", 1_000),
      runSessionKey: "agent:main:main:eadproj:run:run-1",
      agentRunId: "agent-old-1",
    };
    const pending = createExecution("run-2", "pending", 1_500);
    const completed = createExecution("run-3", "completed", 500);

    loadProjectsStore.mockResolvedValue({
      version: 2,
      templates: [template],
      executions: [running, pending, completed],
      activeTemplateId: template.id,
    });

    const uuidSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(newRunId);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2_000);

    await invokeExecutionsRun(template.id, respond);

    expect(cancelProjectExecution).toHaveBeenCalledTimes(2);
    expect(cancelProjectExecution).toHaveBeenCalledWith("run-1");
    expect(cancelProjectExecution).toHaveBeenCalledWith("run-2");
    expect(chatAbort).toHaveBeenCalledTimes(1);
    expect(chatAbort.mock.calls[0]?.[0]).toMatchObject({
      params: {
        sessionKey: "agent:main:main:eadproj:run:run-1",
        runId: "agent-old-1",
      },
    });

    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    expect(browserRequest).toHaveBeenCalledTimes(1);
    expect(browserRequest.mock.calls[0]?.[0]).toMatchObject({
      params: {
        method: "GET",
        path: "/profiles",
      },
    });
    expect(sessionsCreate.mock.calls[0]?.[0]).toMatchObject({
      params: {
        key: `agent:main:main:eadproj:run:${newRunId}`,
        label: "Project Run 00000000",
        parentSessionKey: "agent:main:main",
      },
    });
    expect(chatInject).toHaveBeenCalledTimes(1);
    expect(chatInject.mock.calls[0]?.[0]).toMatchObject({
      params: {
        sessionKey: `agent:main:main:eadproj:run:${newRunId}`,
        label: "Project Run Context",
        message: expect.stringContaining(`Execution Run ID: ${newRunId}.`),
      },
    });
    expect(chatSend).toHaveBeenCalledTimes(1);
    expect(chatSend.mock.calls[0]?.[0]).toMatchObject({
      params: {
        sessionKey: `agent:main:main:eadproj:run:${newRunId}`,
        deliver: false,
        idempotencyKey: `project-run-bootstrap:${newRunId}`,
        message: expect.stringContaining("Session reuse hint: qa-admin-session."),
      },
    });

    expect(runProjectExecution).toHaveBeenCalledWith(newRunId);

    const firstSavedStore = saveProjectsStore.mock.calls[0]?.[1] as {
      executions: ProjectExecute[];
    };
    expect(firstSavedStore.executions).toMatchObject([
      {
        id: "run-1",
        status: "cancelled",
        paused: false,
        durationMs: 1_000,
        cancelReason: "Superseded by a newer Project Run.",
      },
      {
        id: "run-2",
        status: "cancelled",
        paused: false,
        durationMs: 500,
        cancelReason: "Superseded by a newer Project Run.",
      },
      {
        id: "run-3",
        status: "completed",
      },
      {
        id: newRunId,
        status: "pending",
      },
    ]);

    const finalSavedStore = saveProjectsStore.mock.calls.at(-1)?.[1] as {
      executions: ProjectExecute[];
    };
    expect(finalSavedStore.executions.at(-1)).toMatchObject({
      id: newRunId,
      status: "pending",
      runSessionKey: `agent:main:main:eadproj:run:${newRunId}`,
      agentRunId: "agent-run-123",
      authMode: "reuse-session",
      authSessionProfile: "qa-admin-session",
      progressPercentage: 10,
      executorHint: expect.stringContaining("OpenClaw is now driving the run"),
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        id: newRunId,
        linkedTemplateId: template.id,
        status: "pending",
        runSessionKey: `agent:main:main:eadproj:run:${newRunId}`,
        agentRunId: "agent-run-123",
      }),
    );

    uuidSpy.mockRestore();
    nowSpy.mockRestore();
  });

  it("fails fast when reuse-session has no selected browser profile", async () => {
    const respond = vi.fn();
    const template = {
      ...createTemplate(),
      authSessionProfile: undefined,
    };
    loadProjectsStore.mockResolvedValue({
      version: 2,
      templates: [template],
      executions: [],
      activeTemplateId: template.id,
    });

    await invokeExecutionsRun(template.id, respond);

    expect(browserRequest).not.toHaveBeenCalled();
    expect(saveProjectsStore).not.toHaveBeenCalled();
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "executions.run requires authSessionProfile when authMode is reuse-session",
      }),
    );
  });

  it("fails fast when the requested reuse-session profile does not exist", async () => {
    const respond = vi.fn();
    const template = createTemplate();
    loadProjectsStore.mockResolvedValue({
      version: 2,
      templates: [template],
      executions: [],
      activeTemplateId: template.id,
    });
    browserRequest.mockImplementationOnce(async ({ respond }: { respond: Function }) => {
      respond(true, { profiles: [] });
    });

    await invokeExecutionsRun(template.id, respond);

    expect(browserRequest).toHaveBeenCalledTimes(1);
    expect(saveProjectsStore).not.toHaveBeenCalled();
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "browser profile not found for reuse-session: qa-admin-session",
      }),
    );
  });

  it("fails fast when the gateway cannot verify reuse-session browser profiles", async () => {
    const respond = vi.fn();
    const template = createTemplate();
    loadProjectsStore.mockResolvedValue({
      version: 2,
      templates: [template],
      executions: [],
      activeTemplateId: template.id,
    });
    browserRequest.mockImplementationOnce(async ({ respond }: { respond: Function }) => {
      respond(false, undefined, { code: -32004, message: "browser control is disabled" });
    });

    await invokeExecutionsRun(template.id, respond);

    expect(browserRequest).toHaveBeenCalledTimes(1);
    expect(saveProjectsStore).not.toHaveBeenCalled();
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "UNAVAILABLE",
        message: "could not verify browser profile qa-admin-session: browser control is disabled",
      }),
    );
  });

  it("starts manual-bootstrap runs in a paused waiting state", async () => {
    const respond = vi.fn();
    const manualRunId = "00000000-0000-4000-8000-000000000002";
    const template = {
      ...createTemplate(),
      authMode: "manual-bootstrap" as const,
      authSessionProfile: undefined,
      authInstructions: "Log in as QA admin before continuing.",
    };
    loadProjectsStore.mockResolvedValue({
      version: 2,
      templates: [template],
      executions: [],
      activeTemplateId: template.id,
    });

    const uuidSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(manualRunId);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2_500);

    await invokeExecutionsRun(template.id, respond);

    expect(browserRequest).not.toHaveBeenCalled();
    expect(chatSend).not.toHaveBeenCalled();
    const finalSavedStore = saveProjectsStore.mock.calls.at(-1)?.[1] as {
      executions: ProjectExecute[];
    };
    expect(finalSavedStore.executions.at(-1)).toMatchObject({
      id: manualRunId,
      status: "pending",
      paused: true,
      authMode: "manual-bootstrap",
      progressPercentage: 8,
      executorHint: expect.stringContaining("Waiting for the operator to finish login"),
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        id: manualRunId,
        paused: true,
        authMode: "manual-bootstrap",
      }),
    );

    uuidSpy.mockRestore();
    nowSpy.mockRestore();
  });
});

describe("projectsHandlers executions.resume", () => {
  beforeEach(() => {
    loadProjectsStore.mockReset();
    saveProjectsStore.mockReset();
    chatSend.mockReset();
    chatAbort.mockReset();
    saveProjectsStore.mockResolvedValue(undefined);
    chatSend.mockImplementation(async ({ respond }: { respond: Function }) => {
      respond(true, { runId: "agent-run-123", status: "started" });
    });
    chatAbort.mockImplementation(async ({ respond }: { respond: Function }) => {
      respond(true, { ok: true, aborted: true, runIds: ["old-run"] });
    });
  });

  it("sends a continue message for paused manual-bootstrap runs", async () => {
    const respond = vi.fn();
    loadProjectsStore.mockResolvedValue({
      version: 2,
      templates: [],
      executions: [
        {
          ...createExecution("run-manual", "running", 3_000),
          paused: true,
          authMode: "manual-bootstrap",
          authLoginUrl: "https://example.com/login",
          authInstructions: "Log in as QA admin before continuing.",
          runSessionKey: "agent:main:main:eadproj:run:run-manual",
        },
      ],
      activeTemplateId: null,
    });

    await invokeExecutionsResume("run-manual", respond);

    expect(saveProjectsStore).toHaveBeenCalledTimes(1);
    const saved = saveProjectsStore.mock.calls[0]?.[1] as { executions: ProjectExecute[] };
    expect(saved.executions[0]).toMatchObject({
      id: "run-manual",
      paused: false,
      executorHint: expect.stringContaining("OpenClaw is exploring https://example.com"),
      agentRunId: "agent-run-123",
    });
    expect(chatSend).toHaveBeenCalledTimes(1);
    expect(chatSend.mock.calls[0]?.[0]).toMatchObject({
      params: {
        sessionKey: "agent:main:main:eadproj:run:run-manual",
        deliver: false,
        message: expect.stringContaining(
          "The operator already confirmed that login/bootstrap is complete.",
        ),
        idempotencyKey: "project-run-bootstrap:run-manual",
      },
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        id: "run-manual",
        paused: false,
      }),
    );
  });

  it("aborts the active run when pausing and starts a new run id when resuming", async () => {
    const pauseRespond = vi.fn();
    const resumeRespond = vi.fn();
    loadProjectsStore.mockResolvedValue({
      version: 2,
      templates: [],
      executions: [
        {
          ...createExecution("run-active", "running", 3_000),
          paused: false,
          authMode: "none",
          runSessionKey: "agent:main:main:eadproj:run:run-active",
          agentRunId: "agent-old-7",
        },
      ],
      activeTemplateId: null,
    });

    await projectsHandlers["executions.pause"]({
      req: {} as never,
      params: { id: "run-active" } as never,
      respond: pauseRespond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(chatAbort).toHaveBeenCalledTimes(1);
    expect(chatAbort.mock.calls[0]?.[0]).toMatchObject({
      params: {
        sessionKey: "agent:main:main:eadproj:run:run-active",
        runId: "agent-old-7",
      },
    });
    expect(saveProjectsStore).toHaveBeenCalledTimes(1);
    let saved = saveProjectsStore.mock.calls[0]?.[1] as { executions: ProjectExecute[] };
    expect(saved.executions[0]).toMatchObject({
      id: "run-active",
      paused: true,
    });
    expect(pauseRespond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        id: "run-active",
        paused: true,
      }),
    );

    saveProjectsStore.mockClear();
    chatSend.mockClear();
    loadProjectsStore.mockResolvedValue({
      version: 2,
      templates: [],
      executions: [saved.executions[0]],
      activeTemplateId: null,
    });

    await invokeExecutionsResume("run-active", resumeRespond);

    expect(chatSend).toHaveBeenCalledTimes(1);
    expect(chatSend.mock.calls[0]?.[0]).toMatchObject({
      params: {
        sessionKey: "agent:main:main:eadproj:run:run-active",
        deliver: false,
        message: expect.stringContaining("The operator resumed Project Run run-active."),
      },
    });
    expect(saveProjectsStore).toHaveBeenCalledTimes(1);
    saved = saveProjectsStore.mock.calls[0]?.[1] as { executions: ProjectExecute[] };
    expect(saved.executions[0]).toMatchObject({
      id: "run-active",
      paused: false,
      agentRunId: "agent-run-123",
    });
    expect(resumeRespond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        id: "run-active",
        paused: false,
        agentRunId: "agent-run-123",
      }),
    );
  });
});
