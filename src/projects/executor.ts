import {
  loadGatewaySessionRow,
  loadSessionEntry,
  readSessionMessages,
} from "../gateway/session-utils.js";
import { loadProjectsStore, resolveProjectsStorePath, saveProjectsStore } from "./store.js";
import type { EadFmNodeRun, TestCaseRun, TestCaseStepRun } from "./types.js";

const executionControllers = new Map<string, AbortController>();

type ExploreCandidateKind = "button" | "link" | "menuitem" | "tab";
type ExploreCandidatePurpose = "detail" | "section";
type RawExploreCandidate = {
  exploreId: string;
  href: string | null;
  inNavigation: boolean;
  kind: ExploreCandidateKind;
  label: string;
  sameOrigin: boolean;
};
type ExploreCandidate = RawExploreCandidate & {
  key: string;
  score: number;
};

function normalizeExploreLabel(
  value: string | null | undefined,
  fallback = "Untitled view",
): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.length > 70 ? `${normalized.slice(0, 67).trimEnd()}...` : normalized;
}

function describePage(url: string, title: string): string {
  const safeTitle = normalizeExploreLabel(title, "");
  if (safeTitle) {
    return `${safeTitle} (${url})`;
  }
  return url;
}

function buildExploreCandidateKey(raw: RawExploreCandidate): string {
  return `${raw.kind}|${(raw.href ?? "").toLowerCase()}|${normalizeExploreLabel(raw.label).toLowerCase()}`;
}

function isDangerousExploreLabel(label: string): boolean {
  return /\b(add|approve|archive|book|buy|cancel subscription|checkout|confirm|create|deactivate|delete|destroy|disable|disconnect|drop|end call|erase|invite|logout|log out|new\b|pay|purchase|remove|reset|revoke|save|send|sign out|submit|transfer|unlink|update)\b/i.test(
    label,
  );
}

function scoreExploreCandidate(raw: RawExploreCandidate, purpose: ExploreCandidatePurpose): number {
  let score = 0;
  if (raw.inNavigation) {
    score += purpose === "section" ? 60 : 15;
  }
  if (raw.kind === "tab") {
    score += purpose === "detail" ? 35 : 20;
  } else if (raw.kind === "link") {
    score += raw.href ? 30 : 12;
  } else if (raw.kind === "menuitem") {
    score += 22;
  } else {
    score += 16;
  }
  if (raw.sameOrigin) {
    score += 12;
  }
  const label = raw.label.toLowerCase();
  if (
    /\b(dashboard|home|overview|project|workspace|team|user|member|settings|report|analytics|calendar|meeting|room|chat|call|admin)\b/i.test(
      label,
    )
  ) {
    score += purpose === "section" ? 20 : 8;
  }
  if (label.length >= 3 && label.length <= 40) {
    score += 8;
  }
  if (isDangerousExploreLabel(raw.label)) {
    score -= 1000;
  }
  return score;
}

function prepareExploreCandidates(
  rawCandidates: RawExploreCandidate[],
  purpose: ExploreCandidatePurpose,
  limit: number,
): ExploreCandidate[] {
  const deduped = new Map<string, ExploreCandidate>();
  for (const raw of rawCandidates) {
    const label = normalizeExploreLabel(raw.label, "");
    if (!label) {
      continue;
    }
    const normalized = { ...raw, label };
    const candidate: ExploreCandidate = {
      ...normalized,
      key: buildExploreCandidateKey(normalized),
      score: scoreExploreCandidate(normalized, purpose),
    };
    if (candidate.score < 0) {
      continue;
    }
    const existing = deduped.get(candidate.key);
    if (!existing || candidate.score > existing.score) {
      deduped.set(candidate.key, candidate);
    }
  }
  return [...deduped.values()]
    .toSorted((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit);
}

export const __internal = {
  describePage,
  isDangerousExploreLabel,
  normalizeExploreLabel,
  prepareExploreCandidates,
};

async function loadExecution(
  storePath: string,
  executionId: string,
): Promise<{
  store: Awaited<ReturnType<typeof loadProjectsStore>>;
  execution: NonNullable<Awaited<ReturnType<typeof loadProjectsStore>>["executions"][number]>;
} | null> {
  const store = await loadProjectsStore(storePath);
  const execution = store.executions.find((entry) => entry.id === executionId);
  if (!execution) {
    return null;
  }
  return { store, execution };
}

async function persistExecution(
  storePath: string,
  store: Awaited<ReturnType<typeof loadProjectsStore>>,
): Promise<void> {
  await saveProjectsStore(storePath, store);
}

async function updateExecutionSnapshot(
  storePath: string,
  executionId: string,
  update: (
    execution: NonNullable<Awaited<ReturnType<typeof loadProjectsStore>>["executions"][number]>,
  ) => void,
): Promise<void> {
  const snap = await loadExecution(storePath, executionId);
  if (!snap) {
    return;
  }
  update(snap.execution);
  await persistExecution(storePath, snap.store);
}

async function sleepWithAbort(signal: AbortSignal, timeoutMs: number): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function truncateExecutionText(value: string | undefined, maxChars = 2_000): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 3).trimEnd()}...` : trimmed;
}

function extractTranscriptText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (!part || typeof part !== "object") {
          return "";
        }
        const typedPart = part as { type?: unknown; text?: unknown; content?: unknown };
        if (typedPart.type === "text" && typeof typedPart.text === "string") {
          return typedPart.text;
        }
        return extractTranscriptText(typedPart.content);
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (content && typeof content === "object") {
    const nested = content as { text?: unknown; content?: unknown };
    if (typeof nested.text === "string") {
      return nested.text.trim();
    }
    return extractTranscriptText(nested.content);
  }
  return "";
}

function readProjectRunTranscriptSnapshot(sessionKey: string): {
  messageCount: number;
  latestAssistantText?: string;
} {
  const loaded = loadSessionEntry(sessionKey);
  if (!loaded.entry?.sessionId) {
    return { messageCount: 0 };
  }
  const transcript = readSessionMessages(
    loaded.entry.sessionId,
    loaded.storePath,
    loaded.entry.sessionFile,
  );
  let latestAssistantText: string | undefined;
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const row = transcript[i] as { message?: unknown } | undefined;
    const maybeMessage = row?.message && typeof row.message === "object" ? row.message : row;
    if (!maybeMessage || typeof maybeMessage !== "object") {
      continue;
    }
    const message = maybeMessage as { role?: unknown; content?: unknown };
    if (message.role !== "assistant") {
      continue;
    }
    const text = truncateExecutionText(extractTranscriptText(message.content), 4_000);
    if (text) {
      latestAssistantText = text;
      break;
    }
  }
  return {
    messageCount: transcript.length,
    latestAssistantText,
  };
}

function buildTranscriptEvidenceRun(params: {
  executionId: string;
  latestAssistantText?: string;
  status: "Success" | "Failed";
}): EadFmNodeRun {
  const actualResult =
    truncateExecutionText(params.latestAssistantText, 4_000) ??
    "OpenClaw completed the run, but no assistant summary was captured in the transcript yet.";
  const stepRun: TestCaseStepRun = {
    stepId: `step-summary-${params.executionId}`,
    sortOrder: 1,
    procedureText: "Review the OpenClaw Project Run transcript",
    expectedResult: "A run summary, findings, or blocker explanation is captured in chat.",
    actualResult,
    mustPass: true,
    status: params.status,
    executionTimeMs: 1,
  };
  const testCaseRun: TestCaseRun = {
    caseId: `tc-summary-${params.executionId}`,
    title: "OpenClaw transcript summary",
    status: params.status,
    testCaseStepRuns: [stepRun],
  };
  return {
    nodeId: "openclaw-run-transcript",
    nodeKey: "openclaw-run-transcript",
    type: "chat",
    title: "OpenClaw Project Run transcript",
    status: params.status,
    testCaseRuns: [testCaseRun],
  };
}

function resolveActiveRunProgress(messageCount: number): number {
  return Math.min(15 + Math.max(0, messageCount) * 3, 92);
}

function resolveRunningHint(targetUrl?: string, paused = false, authMode?: string): string {
  if (paused) {
    if (authMode === "manual-bootstrap") {
      return "Waiting for the operator to finish login or bootstrap steps. Resume the run after authentication is complete.";
    }
    return targetUrl?.trim()
      ? `Project Run is paused for ${targetUrl.trim()}. Resume when you want OpenClaw to continue.`
      : "Project Run is paused. Resume when you want OpenClaw to continue.";
  }
  const prefix = targetUrl?.trim()
    ? `OpenClaw is exploring ${targetUrl.trim()}.`
    : "OpenClaw is exploring the target app.";
  return `${prefix} Follow the run chat for live reasoning, browser actions, and blockers.`;
}

function resolveTerminalHint(status: "completed" | "cancelled" | "error"): string {
  if (status === "completed") {
    return "OpenClaw finished this Project Run. Review the run chat for the full transcript and ask for a report or summary if needed.";
  }
  if (status === "cancelled") {
    return "The Project Run stopped before completion. Review the run chat for the last partial output and blocker details.";
  }
  return "The OpenClaw run ended with an error. Review the run chat for the failing step or blocker explanation.";
}

/**
 * Project Run is now primarily an orchestrator around a run-scoped OpenClaw chat session.
 * The gateway starts the real agent turn, and this executor keeps the project execution row
 * synced with that session's lifecycle and transcript.
 */
export async function runProjectExecution(executionId: string): Promise<void> {
  const storePath = resolveProjectsStorePath();
  const initial = await loadExecution(storePath, executionId);
  if (!initial) {
    throw new Error(`Execution ${executionId} not found`);
  }

  const { store, execution } = initial;
  const runSessionKey = execution.runSessionKey?.trim();
  if (!runSessionKey) {
    execution.status = "error";
    execution.lastErrorMessage = "Project Run session was not initialized.";
    execution.durationMs = execution.startTime
      ? Math.max(0, Date.now() - execution.startTime)
      : null;
    await persistExecution(storePath, store);
    throw new Error(`Execution ${executionId} missing run session key`);
  }

  const abortController = new AbortController();
  executionControllers.set(executionId, abortController);

  try {
    execution.status = "running";
    execution.paused = Boolean(execution.paused);
    execution.progressPercentage = Math.max(
      execution.progressPercentage,
      execution.paused ? 8 : 15,
    );
    execution.executorHint =
      execution.executorHint ||
      resolveRunningHint(execution.targetUrl, execution.paused, execution.authMode);
    await persistExecution(storePath, store);

    let missingSessionRowCount = 0;
    for (;;) {
      if (abortController.signal.aborted) {
        return;
      }

      const snap = await loadExecution(storePath, executionId);
      if (!snap) {
        return;
      }
      const current = snap.execution;
      const activeSessionKey = current.runSessionKey?.trim();
      if (!activeSessionKey) {
        await updateExecutionSnapshot(storePath, executionId, (entry) => {
          entry.status = "error";
          entry.lastErrorMessage = "Project Run session key disappeared while monitoring the run.";
          entry.durationMs = entry.startTime ? Math.max(0, Date.now() - entry.startTime) : null;
          entry.executorHint = resolveTerminalHint("error");
        });
        return;
      }
      if (
        current.status === "completed" ||
        current.status === "cancelled" ||
        current.status === "error"
      ) {
        return;
      }
      if (current.paused) {
        await updateExecutionSnapshot(storePath, executionId, (entry) => {
          entry.status = "running";
          entry.paused = true;
          entry.progressPercentage = Math.max(entry.progressPercentage, 8);
          entry.executorHint = resolveRunningHint(entry.targetUrl, true, entry.authMode);
        });
        await sleepWithAbort(abortController.signal, 1_200);
        continue;
      }

      const row = loadGatewaySessionRow(activeSessionKey);
      const transcript = readProjectRunTranscriptSnapshot(activeSessionKey);
      const currentTokens =
        typeof row?.totalTokensFresh === "number"
          ? row.totalTokensFresh
          : typeof row?.totalTokens === "number"
            ? row.totalTokens
            : undefined;

      if (!row) {
        missingSessionRowCount += 1;
        if (missingSessionRowCount >= 25) {
          await updateExecutionSnapshot(storePath, executionId, (entry) => {
            entry.status = "error";
            entry.progressPercentage = 0;
            entry.durationMs = entry.startTime ? Math.max(0, Date.now() - entry.startTime) : null;
            entry.lastErrorMessage =
              transcript.latestAssistantText ??
              "OpenClaw never reported a live session state for this Project Run.";
            entry.executorHint = resolveTerminalHint("error");
            entry.results = [
              buildTranscriptEvidenceRun({
                executionId,
                latestAssistantText: transcript.latestAssistantText,
                status: "Failed",
              }),
            ];
          });
          return;
        }
        await updateExecutionSnapshot(storePath, executionId, (entry) => {
          entry.status = "running";
          entry.paused = Boolean(entry.paused);
          entry.progressPercentage = Math.max(entry.progressPercentage, entry.paused ? 8 : 15);
          entry.executorHint = resolveRunningHint(entry.targetUrl, entry.paused, entry.authMode);
          if (typeof currentTokens === "number") {
            entry.logTokens = currentTokens;
          }
          if (transcript.latestAssistantText) {
            entry.results = [
              buildTranscriptEvidenceRun({
                executionId,
                latestAssistantText: transcript.latestAssistantText,
                status: "Success",
              }),
            ];
          }
        });
        await sleepWithAbort(abortController.signal, 1_200);
        continue;
      }

      missingSessionRowCount = 0;
      const rowStatus = typeof row.status === "string" ? row.status : "";
      if (rowStatus === "running" || !rowStatus) {
        await updateExecutionSnapshot(storePath, executionId, (entry) => {
          entry.status = "running";
          entry.paused = Boolean(entry.paused);
          entry.progressPercentage = Math.max(
            entry.progressPercentage,
            entry.paused ? 8 : resolveActiveRunProgress(transcript.messageCount),
          );
          entry.executorHint = resolveRunningHint(entry.targetUrl, entry.paused, entry.authMode);
          if (typeof currentTokens === "number") {
            entry.logTokens = currentTokens;
          }
          if (transcript.latestAssistantText) {
            entry.results = [
              buildTranscriptEvidenceRun({
                executionId,
                latestAssistantText: transcript.latestAssistantText,
                status: "Success",
              }),
            ];
          }
        });
        await sleepWithAbort(abortController.signal, 1_200);
        continue;
      }

      const terminalStatus =
        rowStatus === "done" ? "completed" : rowStatus === "killed" ? "cancelled" : "error";
      await updateExecutionSnapshot(storePath, executionId, (entry) => {
        entry.status = terminalStatus;
        entry.paused = false;
        entry.progressPercentage = terminalStatus === "completed" ? 100 : entry.progressPercentage;
        entry.durationMs =
          typeof row.runtimeMs === "number"
            ? row.runtimeMs
            : entry.startTime
              ? Math.max(0, Date.now() - entry.startTime)
              : null;
        entry.executorHint = resolveTerminalHint(terminalStatus);
        if (typeof currentTokens === "number") {
          entry.logTokens = currentTokens;
        }
        if (terminalStatus !== "completed" && !entry.lastErrorMessage) {
          entry.lastErrorMessage =
            transcript.latestAssistantText ??
            (rowStatus === "killed"
              ? "The Project Run was stopped before OpenClaw finished."
              : "OpenClaw ended the Project Run without a successful completion.");
        }
        entry.results = [
          buildTranscriptEvidenceRun({
            executionId,
            latestAssistantText: transcript.latestAssistantText,
            status: terminalStatus === "completed" ? "Success" : "Failed",
          }),
        ];
      });
      return;
    }
  } catch (err) {
    const errText = truncateExecutionText(String(err)) ?? "Unknown Project Run executor failure";
    await updateExecutionSnapshot(storePath, executionId, (entry) => {
      if (entry.status !== "cancelled") {
        entry.status = "error";
        entry.progressPercentage = 0;
        entry.durationMs = entry.startTime ? Math.max(0, Date.now() - entry.startTime) : null;
        entry.lastErrorMessage = entry.lastErrorMessage || errText;
        entry.executorHint = resolveTerminalHint("error");
      }
    });
  } finally {
    executionControllers.delete(executionId);
  }
}

/**
 * Cancels the local monitoring loop for a Project Run.
 * The gateway request handler is responsible for aborting the backing OpenClaw chat run.
 */
export async function cancelProjectExecution(executionId: string): Promise<void> {
  const controller = executionControllers.get(executionId);
  if (controller) {
    controller.abort();
    executionControllers.delete(executionId);
  }
}
