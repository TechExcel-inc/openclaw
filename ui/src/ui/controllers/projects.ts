import type { ProfileStatus } from "../../../../src/browser/client.js";
import {
  buildProjectRunBootstrapMessage,
  buildProjectRunContextMessage,
} from "../../../../src/projects/project-run-messages.js";
import type { ProjectTemplate, ProjectExecute } from "../../../../src/projects/types.js";
import { flushChatQueue, type ChatHost } from "../app-chat.ts";
import { resetToolStream } from "../app-tool-stream.ts";
import {
  buildEadProjectChatSessionKey,
  stripEadProjectSuffix,
} from "../chat/ead-project-session-key.ts";
import {
  abortChatRun,
  clearProjectRunInterTurnPlaceholderIfTerminal,
  type ChatState,
} from "./chat.ts";

export type TemplatesListResult = {
  templates: ProjectTemplate[];
  activeTemplateId: string | null;
};

export type ExecutionsListResult = {
  executions: ProjectExecute[];
};

type SessionCreateResult = {
  key?: string;
};

type ChatHistoryResult = {
  messages?: unknown[];
};

type ProjectAuthMode = NonNullable<ProjectTemplate["authMode"]>;
type ProjectAuthDraft = Pick<
  ProjectTemplate,
  | "authMode"
  | "authLoginUrl"
  | "authSessionProfile"
  | "authInstructions"
  | "timeBudgetMinutes"
  | "costBudgetDollars"
>;

export type ProjectsState = {
  client: {
    request: <T>(method: string, params?: Record<string, unknown>) => Promise<T | undefined>;
  } | null;
  connected: boolean;

  // Templates
  templatesLoading: boolean;
  templatesError: string | null;
  templatesList: ProjectTemplate[];
  activeTemplateId: string | null;

  templateDetail: ProjectTemplate | null;
  templateDetailLoading: boolean;

  templateCreating: boolean;

  showCreateModal: boolean;
  createFormName: string;
  createFormDescription: string;
  createFormTargetUrl: string;
  createFormAiPrompt: string;
  createFormAuthMode: ProjectAuthMode;
  createFormAuthLoginUrl: string;
  createFormAuthSessionProfile: string;
  createFormAuthInstructions: string;
  createFormShowLocalBrowser: boolean;
  projectAuthProfilesLoading: boolean;
  projectAuthProfilesError: string | null;
  projectAuthProfiles: ProfileStatus[];

  // Executions
  executionsLoading: boolean;
  executionsError: string | null;
  executionsList: ProjectExecute[];

  activeExecutionId: string | null;

  executionDetail: ProjectExecute | null;
  executionDetailLoading: boolean;

  globalExecutionsLoading: boolean;
  globalExecutionsList: ProjectExecute[];

  sessionKey?: string;
};

/** Host fields optional: only the control UI app provides them for Project Run chat sync. */
export type ProjectRunChatSyncHost = ProjectsState & {
  tab?: string;
  chatProjectRunExecutionId?: string | null;
  sessionKey?: string;
  chatRunId?: string | null;
  chatStream?: string | null;
  chatStreamStartedAt?: number | null;
  chatSending?: boolean;
  chatQueue?: unknown[];
  resetToolStream?: () => void;
  requestUpdate?: () => void;
};

export function isTerminalExecutionStatus(status: ProjectExecute["status"] | undefined): boolean {
  if (!status) {
    return false;
  }
  return (
    status === "completed" || status === "failed" || status === "cancelled" || status === "error"
  );
}

/**
 * Client-side dedupe for Project Run bootstrap `chat.send` (same execution, overlapping
 * setActiveExecution / sessions.create chains). The gateway also dedupes; this avoids races
 * where two calls both see an empty transcript before the first write lands.
 */
const projectRunBootstrapSent = new Set<string>();

/**
 * Append-only context inject: only when the transcript is empty and the run is active on the server.
 * When `runSessionKey` is set, gateway kickoff already ran chat.inject + bootstrap for this run.
 */
export function shouldInjectProjectRunContextMessage(
  hasMessages: boolean,
  execution: ProjectExecute | undefined,
): boolean {
  if (hasMessages) {
    return false;
  }
  if (!execution) {
    return false;
  }
  if (execution.paused) {
    return false;
  }
  if (execution.runSessionKey?.trim()) {
    return false;
  }
  return execution.status === "running" || execution.status === "pending";
}

/**
 * When a test/project run is no longer active, clear client-side streaming state and abort any
 * in-flight chat run so the UI does not keep "running" after the execution row is terminal.
 * Also clears busy flags and drains the outbound chat queue so follow-up messages are not stuck
 * behind a stale "running" state.
 */
export async function syncProjectRunChatIfTerminal(host: ProjectRunChatSyncHost): Promise<void> {
  if (host.tab !== "chatProjectRun") {
    return;
  }
  const id = host.chatProjectRunExecutionId?.trim();
  if (!id) {
    return;
  }
  const ex =
    host.executionDetail?.id === id
      ? host.executionDetail
      : host.globalExecutionsList?.find((e) => e.id === id);
  if (!ex || !isTerminalExecutionStatus(ex.status)) {
    return;
  }
  const busy =
    Boolean(host.chatRunId?.trim()) ||
    Boolean(host.chatStream?.trim()) ||
    Boolean(host.chatSending);

  if (typeof host.resetToolStream === "function") {
    host.resetToolStream();
  } else if ((host as { toolStreamById?: unknown }).toolStreamById instanceof Map) {
    resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
  }
  if (busy) {
    await abortChatRun(host as unknown as ChatState);
  }
  host.chatRunId = null;
  host.chatStream = null;
  host.chatStreamStartedAt = null;
  host.chatSending = false;
  void flushChatQueue(host as unknown as ChatHost);
  host.requestUpdate?.();
}

// ============================================================================
// TEMPLATES
// ============================================================================

export async function loadTemplates(state: ProjectsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.templatesLoading) {
    return;
  }
  state.templatesLoading = true;
  state.templatesError = null;
  try {
    const res = await state.client.request<TemplatesListResult>("templates.list", {});

    if (res) {
      state.templatesList = res.templates;
      state.activeTemplateId = res.activeTemplateId;
      if (res.activeTemplateId) {
        void loadTemplateDetail(state, res.activeTemplateId);
        void loadExecutions(state, res.activeTemplateId);
      }
    }
  } catch (err) {
    state.templatesError = String(err);
  } finally {
    state.templatesLoading = false;
  }
}

export async function loadTemplateDetail(state: ProjectsState, id: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.templateDetailLoading = true;
  try {
    const res = await state.client.request<ProjectTemplate>("templates.get", { id });
    if (res) {
      state.templateDetail = res;
    }
  } catch (err) {
    state.templatesError = String(err);
  } finally {
    state.templateDetailLoading = false;
  }
}

export async function createTemplate(
  state: ProjectsState,
  name: string,
  description?: string,
  targetUrl?: string,
  aiPrompt?: string,
  auth?: ProjectAuthDraft,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.templatesError = null;
  state.templateCreating = true;
  try {
    const res = await state.client.request<ProjectTemplate>("templates.create", {
      name,
      description: description ?? "",
      targetUrl: targetUrl ?? "",
      aiPrompt: aiPrompt ?? "",
      authMode: auth?.authMode ?? "none",
      authLoginUrl: auth?.authLoginUrl ?? "",
      authSessionProfile: auth?.authSessionProfile ?? "",
      authInstructions: auth?.authInstructions ?? "",
      timeBudgetMinutes: auth?.timeBudgetMinutes,
      costBudgetDollars: auth?.costBudgetDollars,
    });
    if (res) {
      state.templatesList.push(res);
      if (!state.activeTemplateId) {
        state.activeTemplateId = res.id;
      }
      state.templateDetail = res;
      state.showCreateModal = false;
      state.createFormName = "";
      state.createFormDescription = "";
      state.createFormTargetUrl = "";
      state.createFormAiPrompt = "";
      state.createFormAuthMode = "none";
      state.createFormAuthLoginUrl = "";
      state.createFormAuthSessionProfile = "";
      state.createFormAuthInstructions = "";
      void loadExecutions(state, res.id);
    }
  } catch (err) {
    state.templatesError = String(err);
  } finally {
    state.templateCreating = false;
  }
}

export async function updateTemplate(
  state: ProjectsState,
  id: string,
  updates: {
    name?: string;
    description?: string;
    targetUrl?: string;
    aiPrompt?: string;
    authMode?: ProjectAuthMode;
    authLoginUrl?: string;
    authSessionProfile?: string;
    authInstructions?: string;
    timeBudgetMinutes?: number;
    costBudgetDollars?: number;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<ProjectTemplate>("templates.update", {
      id,
      ...updates,
    });
    if (res) {
      const idx = state.templatesList.findIndex((t) => t.id === id);
      if (idx !== -1) {
        state.templatesList[idx] = res;
      }
      if (state.templateDetail?.id === id) {
        state.templateDetail = res;
      }
    }
  } catch (err) {
    state.templatesError = String(err);
  }
}

export async function autoFormatPrompt(state: ProjectsState, text: string): Promise<string> {
  if (!state.client || !state.connected) {
    return text;
  }
  try {
    const res = await state.client.request<{ formattedText: string }>("projects.autoFormatPrompt", {
      text,
    });
    if (res?.formattedText) {
      return res.formattedText;
    }
  } catch (err) {
    state.templatesError = String(err);
  }
  return text;
}

export async function loadProjectBrowserProfiles(state: ProjectsState, force = false) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.projectAuthProfilesLoading) {
    return;
  }
  const existingProfiles = state.projectAuthProfiles ?? [];
  if (!force && existingProfiles.length > 0) {
    return;
  }
  state.projectAuthProfilesLoading = true;
  state.projectAuthProfilesError = null;
  try {
    const res = await state.client.request<{ profiles?: ProfileStatus[] }>("browser.request", {
      method: "GET",
      path: "/profiles",
    });
    const profiles = Array.isArray(res?.profiles) ? res.profiles : [];
    state.projectAuthProfiles = profiles.toSorted((a, b) => {
      if (a.driver !== b.driver) {
        return a.driver === "existing-session" ? -1 : 1;
      }
      if (a.isDefault !== b.isDefault) {
        return a.isDefault ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    state.projectAuthProfilesError = String(err);
  } finally {
    state.projectAuthProfilesLoading = false;
  }
}

export async function deleteTemplate(state: ProjectsState, id: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("templates.delete", { id });
    state.templatesList = state.templatesList.filter((t) => t.id !== id);
    if (state.activeTemplateId === id) {
      state.activeTemplateId = state.templatesList[0]?.id ?? null;
      state.templateDetail = null;
      if (state.activeTemplateId) {
        void loadTemplateDetail(state, state.activeTemplateId);
        void loadExecutions(state, state.activeTemplateId);
      }
    }
  } catch (err) {
    state.templatesError = String(err);
  }
}

export async function setActiveTemplate(state: ProjectsState, id: string | null) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("templates.setActive", { id: id ?? undefined });
    state.activeTemplateId = id;
    if (id) {
      await loadTemplateDetail(state, id);
      void loadExecutions(state, id);
    } else {
      state.templateDetail = null;
      state.executionsList = [];
    }
  } catch (err) {
    state.templatesError = String(err);
  }
}

// ============================================================================
// EXECUTIONS
// ============================================================================

export async function loadExecutions(state: ProjectsState, templateId?: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.executionsLoading = true;
  state.executionsError = null;
  try {
    const payload = templateId ? { templateId } : {};
    const res = await state.client.request<ExecutionsListResult>("executions.list", payload);
    if (res) {
      state.executionsList = res.executions;
    }
  } catch (err) {
    state.executionsError = String(err);
  } finally {
    state.executionsLoading = false;
  }
}

export async function loadGlobalExecutions(state: ProjectsState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.globalExecutionsLoading = true;
  state.executionsError = null;
  try {
    const res = await state.client.request<ExecutionsListResult>("executions.list", {});
    if (res) {
      state.globalExecutionsList = res.executions;
    }
  } catch (err) {
    state.executionsError = String(err);
  } finally {
    state.globalExecutionsLoading = false;
    clearProjectRunInterTurnPlaceholderIfTerminal(state as ProjectRunChatSyncHost);
  }
}

export async function loadExecutionDetail(
  state: ProjectsState,
  id: string,
): Promise<ProjectExecute | undefined> {
  if (!state.client || !state.connected) {
    return undefined;
  }
  if (state.executionDetail?.id !== id) {
    state.executionDetail = null;
  }
  state.executionDetailLoading = true;
  try {
    const res = await state.client.request<ProjectExecute>("executions.get", { id });
    if (res) {
      state.executionDetail = res;
      void syncProjectRunChatIfTerminal(state as ProjectRunChatSyncHost);
      clearProjectRunInterTurnPlaceholderIfTerminal(state as ProjectRunChatSyncHost);
    }
    return res;
  } catch (err) {
    state.executionsError = String(err);
    return undefined;
  } finally {
    state.executionDetailLoading = false;
  }
}

const activeExecutionPollers = new Set<string>();

export async function runExecution(
  state: ProjectsState,
  templateId: string,
  overrides?: {
    targetUrl?: string;
    aiPrompt?: string;
    authMode?: ProjectAuthMode;
    authLoginUrl?: string;
    authSessionProfile?: string;
    authInstructions?: string;
    timeBudgetMinutes?: number;
    costBudgetDollars?: number;
    showLocalBrowser?: boolean;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<ProjectExecute>("executions.run", {
      templateId,
      ...overrides,
    });
    if (res) {
      state.executionsList.push(res);
      const global = state.globalExecutionsList ?? [];
      if (!global.some((e) => e.id === res.id)) {
        state.globalExecutionsList = [...global, res];
      }
      void runExecutionPoller(state, res.id);
      return res;
    }
  } catch (err) {
    state.executionsError = String(err);
  }
}

/** Poll gateway until execution finishes; safe to call multiple times (deduped per id). */
export function attachExecutionWatch(state: ProjectsState, executionId: string) {
  void runExecutionPoller(state, executionId);
}

export async function cancelExecution(
  state: ProjectsState,
  id: string,
  reason?: string,
  mode?: "finish" | "cancel",
) {
  if (!state.client || !state.connected) {
    return;
  }

  try {
    const res = await state.client.request<ProjectExecute>("executions.cancel", {
      id,
      ...(reason?.trim() ? { reason: reason.trim().slice(0, 2000) } : {}),
      ...(mode ? { mode } : {}),
    });
    if (res) {
      mergeExecutionIntoState(state, res);
    }
  } catch (err) {
    state.executionsError = String(err);
  }
}

function mergeExecutionIntoState(state: ProjectsState, res: ProjectExecute) {
  const idx = state.executionsList.findIndex((e) => e.id === res.id);
  if (idx !== -1) {
    state.executionsList[idx] = res;
  }
  if (state.executionDetail?.id === res.id) {
    state.executionDetail = res;
  }
  const gIdx = (state.globalExecutionsList ?? []).findIndex((e) => e.id === res.id);
  if (gIdx !== -1) {
    const next = [...(state.globalExecutionsList ?? [])];
    next[gIdx] = res;
    state.globalExecutionsList = next;
  }
  if (isTerminalExecutionStatus(res.status)) {
    void syncProjectRunChatIfTerminal(state as ProjectRunChatSyncHost);
  }
}

export async function pauseExecution(state: ProjectsState, id: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<ProjectExecute>("executions.pause", { id });
    if (res) {
      mergeExecutionIntoState(state, res);
    }
  } catch (err) {
    state.executionsError = String(err);
  }
}

export async function resumeExecution(state: ProjectsState, id: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<ProjectExecute>("executions.resume", { id });
    if (res) {
      mergeExecutionIntoState(state, res);
    }
  } catch (err) {
    state.executionsError = String(err);
  }
}

function mergeGlobalExecution(state: ProjectsState, res: ProjectExecute) {
  const list = state.globalExecutionsList ?? [];
  const gIdx = list.findIndex((e) => e.id === res.id);
  if (gIdx !== -1) {
    const next = [...list];
    next[gIdx] = res;
    state.globalExecutionsList = next;
  } else {
    state.globalExecutionsList = [...list, res];
  }
  clearProjectRunInterTurnPlaceholderIfTerminal(state as ProjectRunChatSyncHost);
}

async function runExecutionPoller(state: ProjectsState, executionId: string) {
  if (activeExecutionPollers.has(executionId)) {
    return;
  }
  activeExecutionPollers.add(executionId);
  try {
    // Poll until the execution is terminal. A fixed cap (previously 60×2s) stopped updates
    // after ~2 minutes while long Project Runs kept running, so the Running Step Log never refreshed.
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (!state.client) {
        break;
      }
      try {
        const res = await state.client.request<ProjectExecute>("executions.get", {
          id: executionId,
        });
        if (res) {
          const idx = state.executionsList.findIndex((e) => e.id === executionId);
          if (idx !== -1) {
            state.executionsList[idx] = res;
          }
          if (state.executionDetail?.id === executionId) {
            state.executionDetail = res;
          }
          mergeGlobalExecution(state, res);
          if (isTerminalExecutionStatus(res.status)) {
            void syncProjectRunChatIfTerminal(state as ProjectRunChatSyncHost);
            return;
          }
        }
      } catch {
        break;
      }
    }
  } finally {
    activeExecutionPollers.delete(executionId);
  }
}

export async function setActiveExecution(
  state: ProjectsState & {
    sessionKey?: string;
    /** When set, must match `id` for chat.inject / bootstrap — avoids wrong-template prompts when the Projects dashboard selects another run while Project Run chat is open. */
    tab?: string;
    chatProjectRunExecutionId?: string | null;
  },
  id: string | null,
) {
  state.activeExecutionId = id;
  if (id) {
    void loadProjectBrowserProfiles(state);
    if (state.client && state.sessionKey) {
      const base = stripEadProjectSuffix(state.sessionKey.trim());
      const runSessionKey = buildEadProjectChatSessionKey(base, { mode: "run", id });
      const parentSessionKey = base;
      /** Only mutate the run transcript when this execution is the one shown in Project Run chat (not a background dashboard selection). */
      const isProjectRunChatForThisExecution =
        state.tab === "chatProjectRun" && state.chatProjectRunExecutionId?.trim() === id;
      void state.client
        .request<SessionCreateResult>("sessions.create", {
          key: runSessionKey,
          label: `Project Run ${id.slice(0, 8)}`,
          ...(parentSessionKey && parentSessionKey !== runSessionKey ? { parentSessionKey } : {}),
        })
        .then(async () => {
          const [history, executionFirst] = await Promise.all([
            state.client?.request<ChatHistoryResult>("chat.history", {
              sessionKey: runSessionKey,
              // Match loadChatHistory so we do not think the transcript is empty when only the tail is loaded.
              limit: 200,
            }),
            state.client?.request<ProjectExecute>("executions.get", { id }),
          ]);
          // Authoritative snapshot: operator may have just clicked Finish — the parallel batch can
          // still see status "running" while executions.cancel has already persisted "completed".
          const execution =
            (await state.client?.request<ProjectExecute>("executions.get", { id })) ??
            executionFirst;
          const hasMessages = Array.isArray(history?.messages) && history.messages.length > 0;
          // Avoid duplicate OpenClaw bootstrap: server kickoff sets runSessionKey and usually agentRunId.
          const bootstrapAlreadyHandled =
            Boolean(execution?.agentRunId?.trim()) ||
            execution?.authMode === "manual-bootstrap" ||
            Boolean(execution?.runSessionKey?.trim());
          const executionStillActive = execution && !isTerminalExecutionStatus(execution.status);
          // chat.inject appends to the transcript — only for an empty transcript while the run is
          // running or pending on the server (not completed/failed; not when executions.get is missing).
          // Never inject from a dashboard-only selection for a different visible Project Run chat.
          if (
            isProjectRunChatForThisExecution &&
            execution &&
            shouldInjectProjectRunContextMessage(hasMessages, execution)
          ) {
            await state.client?.request("chat.inject", {
              sessionKey: runSessionKey,
              label: "Project Run Context",
              message: buildProjectRunContextMessage(execution),
            });
          }
          if (
            isProjectRunChatForThisExecution &&
            execution &&
            !hasMessages &&
            executionStillActive &&
            !bootstrapAlreadyHandled &&
            !projectRunBootstrapSent.has(id)
          ) {
            projectRunBootstrapSent.add(id);
            try {
              await state.client?.request("chat.send", {
                sessionKey: runSessionKey,
                deliver: false,
                idempotencyKey: `project-run-bootstrap:${id}`,
                message: buildProjectRunBootstrapMessage(execution),
              });
            } catch {
              projectRunBootstrapSent.delete(id);
            }
          }
          if (execution?.paused && isProjectRunChatForThisExecution) {
            await state.client?.request("executions.resume", { id }).catch((err) => {
              console.warn("Failed to auto-resume execution:", err);
            });
          }
        })
        .catch((err) => console.error("Failed to initialize Project Run session:", err));
    }
    void loadExecutionDetail(state, id);
  } else {
    state.executionDetail = null;
  }
}
