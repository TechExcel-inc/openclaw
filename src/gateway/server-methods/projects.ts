import { completeSimple, type TextContent } from "@mariozechner/pi-ai";
import { getApiKeyForModel, requireApiKey } from "../../agents/model-auth.js";
import { resolveDefaultModelForAgent } from "../../agents/model-selection.js";
import { resolveModelAsync } from "../../agents/pi-embedded-runner/model.js";
import { prepareModelForSimpleCompletion } from "../../agents/simple-completion-transport.js";
import type { ProfileStatus } from "../../browser/client.js";
import { loadConfig } from "../../config/config.js";
import { resolveMainSessionKey } from "../../config/sessions.js";
import {
  loadProjectsStore,
  resolveProjectsStorePath,
  saveProjectsStore,
} from "../../projects/store.js";
import type { ProjectAuthMode, ProjectExecute, ProjectTemplate } from "../../projects/types.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateTemplatesGetParams,
  validateTemplatesCreateParams,
  validateTemplatesUpdateParams,
  validateTemplatesDeleteParams,
  validateTemplatesSetActiveParams,
  validateExecutionsListParams,
  validateExecutionsGetParams,
  validateExecutionsRunParams,
  validateExecutionsCancelParams,
  validateExecutionsPauseParams,
  validateExecutionsResumeParams,
  validateProjectsAutoFormatPromptParams,
} from "../protocol/index.js";
import { browserHandlers } from "./browser.js";
import { chatHandlers } from "./chat.js";
import { sessionsHandlers } from "./sessions.js";
import type { GatewayRequestHandlerOptions, GatewayRequestHandlers } from "./types.js";

const storePath = resolveProjectsStorePath();
const SUPERSEDED_EXECUTION_REASON = "Superseded by a newer Project Run.";
const EAD_PROJECT_MARKER = ":eadproj:";
const PROJECT_AUTH_MODES = new Set<ProjectAuthMode>(["none", "reuse-session", "manual-bootstrap"]);

type ProjectAuthFields = Pick<
  ProjectTemplate,
  "authMode" | "authLoginUrl" | "authSessionProfile" | "authInstructions"
>;

function normalizeProjectAuthMode(value: unknown): ProjectAuthMode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim() as ProjectAuthMode;
  return PROJECT_AUTH_MODES.has(trimmed) ? trimmed : undefined;
}

function normalizeProjectText(value: unknown, maxChars = 4_000): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars).trimEnd() : trimmed;
}

function projectErrorText(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const message =
      "message" in error
        ? normalizeProjectText((error as { message?: unknown }).message)
        : undefined;
    if (message) {
      return message;
    }
  }
  return String(error);
}

function hasOwnProjectParam(params: unknown, key: string): boolean {
  return Boolean(
    params && typeof params === "object" && Object.prototype.hasOwnProperty.call(params, key),
  );
}

function resolveProjectAuthFields(input: {
  authMode?: unknown;
  authLoginUrl?: unknown;
  authSessionProfile?: unknown;
  authInstructions?: unknown;
}): ProjectAuthFields {
  const authMode = normalizeProjectAuthMode(input.authMode) ?? "none";
  if (authMode === "none") {
    return {
      authMode,
      authLoginUrl: undefined,
      authSessionProfile: undefined,
      authInstructions: undefined,
    };
  }
  return {
    authMode,
    authLoginUrl: normalizeProjectText(input.authLoginUrl, 2_000),
    authSessionProfile: normalizeProjectText(input.authSessionProfile, 500),
    authInstructions: normalizeProjectText(input.authInstructions, 4_000),
  };
}

function stripProjectSessionSuffix(sessionKey: string): string {
  const raw = sessionKey.trim();
  const idx = raw.indexOf(EAD_PROJECT_MARKER);
  return idx === -1 ? raw : raw.slice(0, idx);
}

function safeProjectSessionSegment(id: string): string {
  return id.replace(/:/g, "_");
}

function buildProjectRunSessionKey(baseSessionKey: string, executionId: string): string {
  const base = stripProjectSessionSuffix(baseSessionKey);
  return `${base}${EAD_PROJECT_MARKER}run:${safeProjectSessionSegment(executionId)}`;
}

function buildProjectRunContextMessage(executionId: string): string {
  return [
    "[System] Project Run context initialized.",
    `Execution Run ID: ${executionId}.`,
    "This is a Learning/Exploration Phase.",
    "Use the `read_ead_execution` tool to inspect current run results before answering.",
    "When the run is active, help the operator with login/setup questions and summarize discovered areas and gaps.",
  ].join(" ");
}

function describeProjectRunAuth(execution: ProjectAuthFields): string[] {
  const lines: string[] = [];
  const authMode = execution.authMode ?? "none";
  lines.push(`Authentication strategy: ${authMode}.`);
  if (execution.authLoginUrl?.trim()) {
    lines.push(`Authentication URL: ${execution.authLoginUrl.trim()}.`);
  }
  if (execution.authSessionProfile?.trim()) {
    lines.push(`Session reuse hint: ${execution.authSessionProfile.trim()}.`);
  }
  if (execution.authInstructions?.trim()) {
    lines.push(`Authentication notes: ${execution.authInstructions.trim()}.`);
  }
  if (authMode === "reuse-session") {
    lines.push(
      "Prefer reusing existing authenticated browser/session state before asking for manual login.",
    );
  } else if (authMode === "manual-bootstrap") {
    lines.push(
      "Ask the operator to complete login/bootstrap steps first, then continue the run after confirmation.",
    );
  }
  return lines;
}

function buildProjectRunBootstrapMessage(
  execution: Pick<
    ProjectExecute,
    | "id"
    | "name"
    | "description"
    | "targetUrl"
    | "aiPrompt"
    | "authMode"
    | "authLoginUrl"
    | "authSessionProfile"
    | "authInstructions"
  >,
  options?: { operatorConfirmed?: boolean },
): string {
  const operatorConfirmed = Boolean(options?.operatorConfirmed);
  return [
    "You are OpenClaw helping with a Project Run.",
    `Execution run ID: ${execution.id}.`,
    execution.name?.trim() ? `Run name: ${execution.name.trim()}.` : "",
    execution.description?.trim() ? `Run description: ${execution.description.trim()}.` : "",
    execution.targetUrl?.trim() ? `Target URL: ${execution.targetUrl.trim()}.` : "",
    execution.aiPrompt?.trim() ? `Project instructions: ${execution.aiPrompt.trim()}.` : "",
    ...describeProjectRunAuth(execution),
    "Primary goal: use OpenClaw's existing capabilities to explore the target app rather than inventing a separate mini-runner.",
    "Prefer a headless-friendly approach first. If authentication is required and no reusable authenticated state is available, explain what is needed instead of pretending the run succeeded.",
    execution.authMode === "manual-bootstrap" && !operatorConfirmed
      ? "For manual-bootstrap runs, ask the operator to complete login/setup first and then wait for explicit confirmation before continuing any deeper exploration."
      : "",
    execution.authMode === "manual-bootstrap" && operatorConfirmed
      ? "The operator already confirmed that login/bootstrap is complete. Continue immediately from the authenticated state instead of asking to wait again."
      : "",
    "Use the browser tool when appropriate, inspect current run data with read_ead_execution when helpful, and summarize discoveries, gaps, and blockers clearly.",
  ]
    .filter(Boolean)
    .join(" ");
}

function resolveProjectRunWaitingHint(
  execution: Pick<ProjectExecute, "authMode" | "targetUrl">,
): string {
  if (execution.authMode === "manual-bootstrap") {
    return "Waiting for the operator to finish login or bootstrap steps. Resume the run after authentication is complete.";
  }
  const target = execution.targetUrl?.trim();
  return target
    ? `Project Run is paused for ${target}. Resume when you want OpenClaw to continue.`
    : "Project Run is paused. Resume when you want OpenClaw to continue.";
}

function resolveProjectRunRunningHint(execution: Pick<ProjectExecute, "targetUrl">): string {
  const target = execution.targetUrl?.trim();
  return target
    ? `OpenClaw is exploring ${target}. Follow the run chat for live reasoning, browser work, and blockers.`
    : "OpenClaw is exploring the target app. Follow the run chat for live reasoning, browser work, and blockers.";
}

function buildProjectRunResumeMessage(
  execution: Pick<ProjectExecute, "authMode" | "authInstructions" | "authLoginUrl" | "id">,
): string {
  if (execution.authMode === "manual-bootstrap") {
    return [
      "The operator confirmed that manual bootstrap/login is complete.",
      execution.authLoginUrl?.trim() ? `Authenticated area: ${execution.authLoginUrl.trim()}.` : "",
      execution.authInstructions?.trim()
        ? `Keep the original bootstrap notes in mind: ${execution.authInstructions.trim()}.`
        : "",
      `Continue Project Run ${execution.id} from the authenticated state now.`,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return `The operator resumed Project Run ${execution.id}. Continue from the current state.`;
}

function shouldAutoStartProjectRun(execution: Pick<ProjectExecute, "authMode">): boolean {
  return execution.authMode !== "manual-bootstrap";
}

async function sendProjectRunChatMessage(
  options: Pick<GatewayRequestHandlerOptions, "req" | "context" | "client" | "isWebchatConnect"> & {
    sessionKey: string;
    message: string;
    idempotencyKey?: string;
  },
): Promise<{ agentRunId?: string; error?: string }> {
  let sendPayload: Record<string, unknown> | undefined;
  let sendError: unknown;
  await chatHandlers["chat.send"]({
    req: options.req,
    params: {
      sessionKey: options.sessionKey,
      deliver: false,
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      message: options.message,
    },
    respond: (ok, payload, error) => {
      if (ok && payload && typeof payload === "object") {
        sendPayload = payload as Record<string, unknown>;
        return;
      }
      sendError = error;
    },
    context: options.context,
    client: options.client,
    isWebchatConnect: options.isWebchatConnect,
  });
  return {
    agentRunId: typeof sendPayload?.runId === "string" ? sendPayload.runId : undefined,
    error: sendError ? projectErrorText(sendError) : undefined,
  };
}

async function kickoffProjectRunSession(
  options: Pick<GatewayRequestHandlerOptions, "req" | "context" | "client" | "isWebchatConnect"> & {
    execution: ProjectExecute;
  },
): Promise<{ runSessionKey: string; agentRunId?: string; error?: string }> {
  const mainSessionKey = resolveMainSessionKey(loadConfig());
  const runSessionKey = buildProjectRunSessionKey(mainSessionKey, options.execution.id);

  let createError: unknown;
  await sessionsHandlers["sessions.create"]({
    req: options.req,
    params: {
      key: runSessionKey,
      label: `Project Run ${options.execution.id.slice(0, 8)}`,
      parentSessionKey: mainSessionKey,
    },
    respond: (ok, _payload, error) => {
      if (!ok) {
        createError = error;
      }
    },
    context: options.context,
    client: options.client,
    isWebchatConnect: options.isWebchatConnect,
  });
  if (createError) {
    const errorMessage =
      createError instanceof Error
        ? createError.message
        : typeof createError === "string"
          ? createError
          : JSON.stringify(createError);
    return { runSessionKey, error: errorMessage };
  }

  await chatHandlers["chat.inject"]({
    req: options.req,
    params: {
      sessionKey: runSessionKey,
      label: "Project Run Context",
      message: buildProjectRunContextMessage(options.execution.id),
    },
    respond: () => {},
    context: options.context,
    client: options.client,
    isWebchatConnect: options.isWebchatConnect,
  });
  if (!shouldAutoStartProjectRun(options.execution)) {
    return { runSessionKey };
  }
  const sendResult = await sendProjectRunChatMessage({
    req: options.req,
    context: options.context,
    client: options.client,
    isWebchatConnect: options.isWebchatConnect,
    sessionKey: runSessionKey,
    idempotencyKey: `project-run-bootstrap:${options.execution.id}`,
    message: buildProjectRunBootstrapMessage(options.execution),
  });
  return {
    runSessionKey,
    agentRunId: sendResult.agentRunId,
    error: sendResult.error,
  };
}

async function loadAvailableBrowserProfiles(
  options: Pick<GatewayRequestHandlerOptions, "req" | "context" | "client" | "isWebchatConnect">,
): Promise<{ profiles?: ProfileStatus[]; error?: string }> {
  let payload: unknown;
  let browserError: unknown;
  await browserHandlers["browser.request"]({
    req: options.req,
    params: {
      method: "GET",
      path: "/profiles",
    },
    respond: (ok, res, error) => {
      if (ok) {
        payload = res;
        return;
      }
      browserError = error;
    },
    context: options.context,
    client: options.client,
    isWebchatConnect: options.isWebchatConnect,
  });
  if (browserError) {
    return { error: projectErrorText(browserError) };
  }
  const profiles =
    payload && typeof payload === "object"
      ? (payload as { profiles?: unknown }).profiles
      : undefined;
  return {
    profiles: Array.isArray(profiles) ? (profiles as ProfileStatus[]) : [],
  };
}

async function abortProjectRunChat(
  options: Pick<GatewayRequestHandlerOptions, "req" | "context" | "client" | "isWebchatConnect"> & {
    execution: Pick<ProjectExecute, "runSessionKey" | "agentRunId">;
  },
): Promise<void> {
  const sessionKey = options.execution.runSessionKey?.trim();
  if (!sessionKey) {
    return;
  }
  await chatHandlers["chat.abort"]({
    req: options.req,
    params: {
      sessionKey,
      ...(options.execution.agentRunId?.trim()
        ? { runId: options.execution.agentRunId.trim() }
        : {}),
    },
    respond: () => {},
    context: options.context,
    client: options.client,
    isWebchatConnect: options.isWebchatConnect,
  });
}

function cancelActiveExecutions(
  store: { executions: ProjectExecute[] },
  now: number,
): ProjectExecute[] {
  const cancelledExecutions: ProjectExecute[] = [];
  for (const execution of store.executions) {
    if (execution.status !== "pending" && execution.status !== "running") {
      continue;
    }
    execution.status = "cancelled";
    execution.paused = false;
    execution.durationMs = execution.startTime ? Math.max(0, now - execution.startTime) : null;
    execution.cancelReason = SUPERSEDED_EXECUTION_REASON;
    cancelledExecutions.push(execution);
  }
  return cancelledExecutions;
}

export const projectsHandlers: GatewayRequestHandlers = {
  // ---------------------------------------------------------------------------
  // TEMPLATES
  // ---------------------------------------------------------------------------
  "templates.list": async ({ respond }) => {
    try {
      const store = await loadProjectsStore(storePath);
      respond(true, {
        templates: store.templates,
        activeTemplateId: store.activeTemplateId,
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "templates.get": async ({ params, respond }) => {
    if (!validateTemplatesGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid templates.get params: ${formatValidationErrors(validateTemplatesGetParams.errors)}`,
        ),
      );
      return;
    }
    const { id } = params as { id: string };
    try {
      const store = await loadProjectsStore(storePath);
      const template = store.templates.find((p) => p.id === id);
      if (!template) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `template not found: ${id}`),
        );
        return;
      }
      respond(true, template);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "templates.create": async ({ params, respond }) => {
    if (!validateTemplatesCreateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid templates.create params: ${formatValidationErrors(validateTemplatesCreateParams.errors)}`,
        ),
      );
      return;
    }
    const { name, description, targetUrl, aiPrompt } = params as {
      name: string;
      description?: string;
      targetUrl?: string;
      aiPrompt?: string;
    };
    const auth = resolveProjectAuthFields(params as Record<string, unknown>);
    try {
      const store = await loadProjectsStore(storePath);
      const now = Date.now();
      const template: ProjectTemplate = {
        id: crypto.randomUUID(),
        name,
        description: description ?? "",
        targetUrl: targetUrl ?? "",
        aiPrompt: aiPrompt ?? "",
        ...auth,
        totalTestSteps: 0,
        failedTestSteps: 0,
        pfmNodes: [],
        createdAt: now,
        createdBy: "system",
        lastModifiedAt: now,
        lastModifiedBy: "system",
      };
      store.templates.push(template);
      if (!store.activeTemplateId) {
        store.activeTemplateId = template.id;
      }
      await saveProjectsStore(storePath, store);
      respond(true, template);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "templates.update": async ({ params, respond }) => {
    if (!validateTemplatesUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid templates.update params: ${formatValidationErrors(validateTemplatesUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const { id, name, description, targetUrl, aiPrompt } = params as {
      id: string;
      name?: string;
      description?: string;
      targetUrl?: string;
      aiPrompt?: string;
    };
    try {
      const store = await loadProjectsStore(storePath);
      const template = store.templates.find((p) => p.id === id);
      if (!template) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `template not found: ${id}`),
        );
        return;
      }
      if (name !== undefined) {
        template.name = name;
      }
      if (description !== undefined) {
        template.description = description;
      }
      if (targetUrl !== undefined) {
        template.targetUrl = targetUrl;
      }
      if (aiPrompt !== undefined) {
        template.aiPrompt = aiPrompt;
      }
      const nextAuth = resolveProjectAuthFields({
        authMode: hasOwnProjectParam(params, "authMode")
          ? (params as Record<string, unknown>).authMode
          : template.authMode,
        authLoginUrl: hasOwnProjectParam(params, "authLoginUrl")
          ? (params as Record<string, unknown>).authLoginUrl
          : template.authLoginUrl,
        authSessionProfile: hasOwnProjectParam(params, "authSessionProfile")
          ? (params as Record<string, unknown>).authSessionProfile
          : template.authSessionProfile,
        authInstructions: hasOwnProjectParam(params, "authInstructions")
          ? (params as Record<string, unknown>).authInstructions
          : template.authInstructions,
      });
      template.authMode = nextAuth.authMode;
      template.authLoginUrl = nextAuth.authLoginUrl;
      template.authSessionProfile = nextAuth.authSessionProfile;
      template.authInstructions = nextAuth.authInstructions;

      template.lastModifiedAt = Date.now();
      await saveProjectsStore(storePath, store);
      respond(true, template);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "templates.delete": async ({ params, respond }) => {
    if (!validateTemplatesDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid templates.delete params: ${formatValidationErrors(validateTemplatesDeleteParams.errors)}`,
        ),
      );
      return;
    }
    const { id } = params as { id: string };
    try {
      const store = await loadProjectsStore(storePath);
      const idx = store.templates.findIndex((p) => p.id === id);
      if (idx === -1) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `template not found: ${id}`),
        );
        return;
      }
      store.templates.splice(idx, 1);
      if (store.activeTemplateId === id) {
        store.activeTemplateId = store.templates[0]?.id ?? null;
      }
      // cascade delete executions linked to this template
      store.executions = store.executions.filter((e) => e.linkedTemplateId !== id);

      await saveProjectsStore(storePath, store);
      respond(true, { ok: true });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "templates.setActive": async ({ params, respond }) => {
    if (!validateTemplatesSetActiveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid templates.setActive params: ${formatValidationErrors(validateTemplatesSetActiveParams.errors)}`,
        ),
      );
      return;
    }
    const { id } = params as { id?: string };
    try {
      const store = await loadProjectsStore(storePath);
      if (id && !store.templates.some((p) => p.id === id)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `template not found: ${id}`),
        );
        return;
      }
      store.activeTemplateId = id ?? null;
      await saveProjectsStore(storePath, store);
      respond(true, { activeTemplateId: store.activeTemplateId });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ---------------------------------------------------------------------------
  // EXECUTIONS
  // ---------------------------------------------------------------------------
  "executions.list": async ({ params, respond }) => {
    if (!validateExecutionsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid executions.list params: ${formatValidationErrors(validateExecutionsListParams.errors)}`,
        ),
      );
      return;
    }
    const { templateId } = params as { templateId?: string };
    try {
      const store = await loadProjectsStore(storePath);
      let executions = store.executions;
      if (templateId) {
        executions = executions.filter((e) => e.linkedTemplateId === templateId);
      }
      respond(true, { executions });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "executions.get": async ({ params, respond }) => {
    if (!validateExecutionsGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid executions.get params: ${formatValidationErrors(validateExecutionsGetParams.errors)}`,
        ),
      );
      return;
    }
    const { id } = params as { id: string };
    try {
      const store = await loadProjectsStore(storePath);
      const execution = store.executions.find((e) => e.id === id);
      if (!execution) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `execution not found: ${id}`),
        );
        return;
      }
      respond(true, execution);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "executions.run": async ({ params, respond, req, context, client, isWebchatConnect }) => {
    if (!validateExecutionsRunParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid executions.run params: ${formatValidationErrors(validateExecutionsRunParams.errors)}`,
        ),
      );
      return;
    }
    const { templateId } = params as {
      templateId: string;
      targetUrl?: string;
      aiPrompt?: string;
    };
    try {
      const store = await loadProjectsStore(storePath);
      const template = store.templates.find((t) => t.id === templateId);
      if (!template) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `template not found: ${templateId}`),
        );
        return;
      }

      const now = Date.now();
      const runAuth = resolveProjectAuthFields({
        authMode: hasOwnProjectParam(params, "authMode")
          ? (params as Record<string, unknown>).authMode
          : template.authMode,
        authLoginUrl: hasOwnProjectParam(params, "authLoginUrl")
          ? (params as Record<string, unknown>).authLoginUrl
          : template.authLoginUrl,
        authSessionProfile: hasOwnProjectParam(params, "authSessionProfile")
          ? (params as Record<string, unknown>).authSessionProfile
          : template.authSessionProfile,
        authInstructions: hasOwnProjectParam(params, "authInstructions")
          ? (params as Record<string, unknown>).authInstructions
          : template.authInstructions,
      });
      if (runAuth.authMode === "reuse-session") {
        const requestedProfile = runAuth.authSessionProfile?.trim();
        if (!requestedProfile) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              "executions.run requires authSessionProfile when authMode is reuse-session",
            ),
          );
          return;
        }
        const browserProfiles = await loadAvailableBrowserProfiles({
          req,
          context,
          client,
          isWebchatConnect,
        });
        if (browserProfiles.error) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              `could not verify browser profile ${requestedProfile}: ${browserProfiles.error}`,
            ),
          );
          return;
        }
        if (!browserProfiles.profiles?.some((profile) => profile.name === requestedProfile)) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              `browser profile not found for reuse-session: ${requestedProfile}`,
            ),
          );
          return;
        }
      }
      const targetUrl =
        normalizeProjectText((params as { targetUrl?: string }).targetUrl, 2_000) ??
        template.targetUrl;
      const aiPrompt =
        normalizeProjectText((params as { aiPrompt?: string }).aiPrompt, 20_000) ??
        template.aiPrompt;
      const cancelledExecutions = cancelActiveExecutions(store, now);
      const execution: ProjectExecute = {
        id: crypto.randomUUID(),
        linkedTemplateId: template.id,
        name: template.name,
        description: template.description,
        targetUrl,
        aiPrompt,
        ...runAuth,
        status: "pending",
        paused: runAuth.authMode === "manual-bootstrap",
        progressPercentage: 0,
        startTime: now,
        durationMs: null,
        results: [],
      };

      store.executions.push(execution);
      await saveProjectsStore(storePath, store);

      if (cancelledExecutions.length > 0) {
        const { cancelProjectExecution } = await import("../../projects/executor.js");
        await Promise.all(
          cancelledExecutions.map(async (cancelledExecution) => {
            await abortProjectRunChat({
              req,
              context,
              client,
              isWebchatConnect,
              execution: cancelledExecution,
            });
            await cancelProjectExecution(cancelledExecution.id);
          }),
        );
      }

      const kickoff = await kickoffProjectRunSession({
        req,
        context,
        client,
        isWebchatConnect,
        execution,
      });
      execution.runSessionKey = kickoff.runSessionKey;
      execution.agentRunId = kickoff.agentRunId;
      execution.executorHint = kickoff.error
        ? "Project Run could not start the OpenClaw session."
        : execution.paused
          ? resolveProjectRunWaitingHint(execution)
          : "OpenClaw is now driving the run. Follow the run chat for live reasoning, browser work, and findings.";
      execution.lastErrorMessage = kickoff.error;
      execution.progressPercentage = kickoff.error ? 0 : execution.paused ? 8 : 10;
      if (kickoff.error) {
        execution.status = "error";
        execution.durationMs = execution.startTime ? Date.now() - execution.startTime : null;
      }
      await saveProjectsStore(storePath, store);

      if (!kickoff.error) {
        // Async kickoff to execution orchestrator.
        const { runProjectExecution } = await import("../../projects/executor.js");
        runProjectExecution(execution.id).catch(() => {});
      }

      respond(true, execution);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "executions.cancel": async ({ params, respond, req, context, client, isWebchatConnect }) => {
    if (!validateExecutionsCancelParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid executions.cancel params: ${formatValidationErrors(validateExecutionsCancelParams.errors)}`,
        ),
      );
      return;
    }
    const { id, reason } = params as { id: string; reason?: string };
    try {
      const store = await loadProjectsStore(storePath);
      const execution = store.executions.find((e) => e.id === id);
      if (!execution) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `execution not found: ${id}`),
        );
        return;
      }
      if (execution.status === "pending" || execution.status === "running") {
        execution.status = "cancelled";
        execution.paused = false;
        execution.durationMs = execution.startTime ? Date.now() - execution.startTime : null;
        const trimmed = typeof reason === "string" ? reason.trim().slice(0, 2000) : "";
        if (trimmed) {
          execution.cancelReason = trimmed;
        }
        await saveProjectsStore(storePath, store);

        await abortProjectRunChat({
          req,
          context,
          client,
          isWebchatConnect,
          execution,
        });

        // Signal cancellation to executor engine
        const { cancelProjectExecution } = await import("../../projects/executor.js");
        await cancelProjectExecution(execution.id);
      }
      respond(true, execution);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "executions.pause": async ({ params, respond, req, context, client, isWebchatConnect }) => {
    if (!validateExecutionsPauseParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid executions.pause params: ${formatValidationErrors(validateExecutionsPauseParams.errors)}`,
        ),
      );
      return;
    }
    const { id } = params as { id: string };
    try {
      const store = await loadProjectsStore(storePath);
      const execution = store.executions.find((e) => e.id === id);
      if (!execution) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `execution not found: ${id}`),
        );
        return;
      }
      if (execution.status !== "running") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `execution not running: ${execution.status}`),
        );
        return;
      }
      await abortProjectRunChat({
        req,
        context,
        client,
        isWebchatConnect,
        execution,
      });
      execution.paused = true;
      execution.executorHint = resolveProjectRunWaitingHint(execution);
      await saveProjectsStore(storePath, store);
      respond(true, execution);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "executions.resume": async ({ params, respond, req, context, client, isWebchatConnect }) => {
    if (!validateExecutionsResumeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid executions.resume params: ${formatValidationErrors(validateExecutionsResumeParams.errors)}`,
        ),
      );
      return;
    }
    const { id } = params as { id: string };
    try {
      const store = await loadProjectsStore(storePath);
      const execution = store.executions.find((e) => e.id === id);
      if (!execution) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `execution not found: ${id}`),
        );
        return;
      }
      if (execution.status !== "running") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `execution not running: ${execution.status}`),
        );
        return;
      }
      const runSessionKey = execution.runSessionKey?.trim();
      const needsInitialStart =
        !execution.agentRunId?.trim() && !shouldAutoStartProjectRun(execution);
      if (needsInitialStart) {
        if (!runSessionKey) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              "Project Run session is missing, so the run cannot resume",
            ),
          );
          return;
        }
        const startResult = await sendProjectRunChatMessage({
          req,
          context,
          client,
          isWebchatConnect,
          sessionKey: runSessionKey,
          idempotencyKey: `project-run-bootstrap:${execution.id}`,
          message: buildProjectRunBootstrapMessage(execution, { operatorConfirmed: true }),
        });
        if (startResult.error) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              `Project Run could not resume: ${startResult.error}`,
            ),
          );
          return;
        }
        execution.agentRunId = startResult.agentRunId;
      }
      execution.paused = false;
      execution.executorHint = resolveProjectRunRunningHint(execution);
      let resumeRunId = execution.agentRunId;
      if (runSessionKey && !needsInitialStart) {
        const resumeResult = await sendProjectRunChatMessage({
          req,
          context,
          client,
          isWebchatConnect,
          sessionKey: runSessionKey,
          message: buildProjectRunResumeMessage(execution),
        });
        if (resumeResult.error) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              `Project Run could not resume: ${resumeResult.error}`,
            ),
          );
          return;
        }
        resumeRunId = resumeResult.agentRunId ?? resumeRunId;
      }
      execution.agentRunId = resumeRunId;
      await saveProjectsStore(storePath, store);
      respond(true, execution);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "projects.autoFormatPrompt": async ({ params, respond, context: _context }) => {
    if (!validateProjectsAutoFormatPromptParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid projects.autoFormatPrompt params: ${formatValidationErrors(validateProjectsAutoFormatPromptParams.errors)}`,
        ),
      );
      return;
    }
    const { text } = params as { text: string };
    try {
      const cfg = loadConfig();
      const modelRef = resolveDefaultModelForAgent({ cfg });
      const resolved = await resolveModelAsync(modelRef.provider, modelRef.model, undefined, cfg);
      if (!resolved.model) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "failed to resolve model for auto formatting"),
        );
        return;
      }
      const completionModel = prepareModelForSimpleCompletion({ model: resolved.model, cfg });
      const apiKey = requireApiKey(
        await getApiKeyForModel({ model: completionModel, cfg }),
        modelRef.provider,
      );

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45_000);
      try {
        const result = await completeSimple(
          completionModel,
          {
            messages: [
              {
                role: "user",
                content: `Role: You are an expert Markdown formatter and prompt engineer.\nTask: Re-format the following raw text into a highly structured, well-organized Markdown document with clear headings, bullet points, and sections to make it highly readable and professional as an AI prompt.\n\nCRITICAL CONSTRAINTS:\n1. Do NOT change the core meaning or instructions.\n2. Do NOT output a single run-on paragraph. You MUST use newlines, bullet points, and # headings to space the content meaningfully.\n3. ONLY output the raw Markdown format. Do NOT wrap the output in a markdown \`\`\` code fence block.\n\nText to format:\n${text}`,
                timestamp: Date.now(),
              },
            ],
          },
          {
            apiKey,
            maxTokens: 4000,
            temperature: 0.2,
            signal: controller.signal,
          },
        );

        let formattedText = result.content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();

        if (formattedText.startsWith("```markdown")) {
          formattedText = formattedText.substring("```markdown".length).trim();
        } else if (formattedText.startsWith("```")) {
          formattedText = formattedText.substring("```".length).trim();
        }
        if (formattedText.endsWith("```")) {
          formattedText = formattedText.substring(0, formattedText.length - 3).trim();
        }

        respond(true, { formattedText });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
