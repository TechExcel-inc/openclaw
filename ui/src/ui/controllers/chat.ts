import type { ProjectExecute } from "../../../../src/projects/types.js";
import { resetToolStream } from "../app-tool-stream.ts";
import { extractText } from "../chat/message-extract.ts";
import { formatConnectError } from "../connect-error.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { ChatAttachment } from "../ui-types.ts";
import { generateUUID } from "../uuid.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

const SILENT_REPLY_PATTERN = /^\s*NO_REPLY\s*$/;

function isSilentReplyStream(text: string): boolean {
  return SILENT_REPLY_PATTERN.test(text);
}
/** Client-side defense-in-depth: detect assistant messages whose text is purely NO_REPLY. */
function isAssistantSilentReply(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  const role = typeof entry.role === "string" ? entry.role.toLowerCase() : "";
  if (role !== "assistant") {
    return false;
  }
  // entry.text takes precedence — matches gateway extractAssistantTextForSilentCheck
  if (typeof entry.text === "string") {
    return isSilentReplyStream(entry.text);
  }
  const text = extractText(message);
  return typeof text === "string" && isSilentReplyStream(text);
}

export type ChatState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatThinkingLevel: string | null;
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  lastError: string | null;
  /** When `chatProjectRun` (control UI), allow streaming deltas from the active agent run even if the user sent a follow-up (different idempotency run id). */
  tab?: string;
  /** Project Run tab: active execution id (mirrors OpenClawApp). Used to show inter-turn “working” UI. */
  chatProjectRunExecutionId?: string | null;
  globalExecutionsList?: ProjectExecute[];
  executionDetail?: ProjectExecute | null;
  executionDetailLoading?: boolean;
  /** Run id of the user message currently awaiting a response; used to render “waiting” state on the user bubble. */
  chatWaitingUserRunId: string | null;
  /** Duration (ms) of the most recently completed wait; used for “answered after Xs” badge. */
  chatLastWaitDurationMs: number | null;
};

export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
};

/**
 * `loadChatHistory` must not wipe the in-flight stream. Background reloads
 * (e.g. after another run's `final` or tool persistence) would otherwise clear `chatStream` while
 * the operator is still waiting for a reply.
 */
function shouldPreserveStreamingDuringHistoryReload(state: ChatState): boolean {
  if (state.chatRunId?.trim()) {
    return true;
  }
  return state.chatStream !== null;
}

function maybeResetToolStream(state: ChatState) {
  const toolHost = state as ChatState & Partial<Parameters<typeof resetToolStream>[0]>;
  if (
    toolHost.toolStreamById instanceof Map &&
    Array.isArray(toolHost.toolStreamOrder) &&
    Array.isArray(toolHost.chatToolMessages) &&
    Array.isArray(toolHost.chatStreamSegments)
  ) {
    resetToolStream(toolHost as Parameters<typeof resetToolStream>[0]);
  }
}

function messageRoleLower(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" ? role.toLowerCase() : "";
}

function countUserImageBlocks(message: unknown): number {
  const m = message as { content?: unknown };
  if (!Array.isArray(m.content)) {
    return 0;
  }
  return m.content.filter((p) => {
    const item = p as { type?: unknown };
    return item.type === "image";
  }).length;
}

/**
 * Stable key for matching user rows across chat.history reloads (text, timestamp, or image-only).
 * Skips rows with no key (should not happen for user).
 */
function userMessageMergeKey(message: unknown): string | null {
  if (messageRoleLower(message) !== "user") {
    return null;
  }
  const text = extractText(message)?.trim();
  if (text) {
    return `text:${text}`;
  }
  const ts = (message as { timestamp?: unknown }).timestamp;
  if (typeof ts === "number" && Number.isFinite(ts)) {
    return `ts:${ts}`;
  }
  const imgs = countUserImageBlocks(message);
  if (imgs > 0) {
    return `img:${imgs}`;
  }
  return "empty";
}

function countUserMergeKeys(messages: unknown[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of messages) {
    const key = userMessageMergeKey(m);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * After `chat.history`, the server can lag the UI (reload after tool completion, etc.). Preserve
 * **user** messages from the previous local view that are not yet in the server batch. Uses
 * per-text occurrence counts so we still preserve a user message when a **non-user** message
 * (e.g. assistant) was appended after it locally.
 */
function mergeMissingUserMessagesFromHistory(server: unknown[], previous: unknown[]): unknown[] {
  if (previous.length === 0) {
    return server;
  }
  const serverCounts = countUserMergeKeys(server);
  const missing: unknown[] = [];
  const seenInPrevious = new Map<string, number>();
  for (const m of previous) {
    const key = userMessageMergeKey(m);
    if (!key) {
      continue;
    }
    const n = (seenInPrevious.get(key) ?? 0) + 1;
    seenInPrevious.set(key, n);
    const serverN = serverCounts.get(key) ?? 0;
    if (n > serverN) {
      missing.push(m);
      serverCounts.set(key, (serverCounts.get(key) ?? 0) + 1);
    }
  }
  return missing.length > 0 ? [...server, ...missing] : server;
}

function getMessageTimestampMs(message: unknown): number | null {
  const m = message as Record<string, unknown>;
  const t = m.timestamp;
  if (typeof t === "number" && Number.isFinite(t)) {
    return t;
  }
  return null;
}

/**
 * Order chat rows by recorded timestamp when **both** rows have a finite `timestamp`. Used after
 * `mergeMissingUserMessagesFromHistory`, which appends locally preserved user rows to the end of
 * the server batch and can invert chronology when the server already returned newer messages.
 * If either row lacks a timestamp, original merge order is preserved (stable by index) so batches
 * without per-message times are not reshuffled.
 */
export function sortChatMessagesChronologically(messages: unknown[]): unknown[] {
  const indexed = messages.map((m, i) => ({ m, i, ts: getMessageTimestampMs(m) }));
  indexed.sort((a, b) => {
    const ta = a.ts;
    const tb = b.ts;
    if (ta !== null && tb !== null) {
      if (ta !== tb) {
        return ta - tb;
      }
    } else {
      return a.i - b.i;
    }
    return a.i - b.i;
  });
  return indexed.map((x) => x.m);
}

export async function loadChatHistory(state: ChatState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.chatLoading = true;
  state.lastError = null;
  try {
    const res = await state.client.request<{ messages?: Array<unknown>; thinkingLevel?: string }>(
      "chat.history",
      {
        sessionKey: state.sessionKey,
        limit: 200,
      },
    );
    const messages = Array.isArray(res.messages) ? res.messages : [];
    const previousLocal = state.chatMessages;
    const merged = mergeMissingUserMessagesFromHistory(messages, previousLocal);
    state.chatMessages = sortChatMessagesChronologically(merged).filter(
      (message) => !isAssistantSilentReply(message),
    );
    state.chatThinkingLevel = res.thinkingLevel ?? null;
    const preserveStream = shouldPreserveStreamingDuringHistoryReload(state);
    const savedStream = state.chatStream;
    const savedStartedAt = state.chatStreamStartedAt;
    // Clear all streaming state — history includes tool results and text
    // inline, so keeping streaming artifacts would cause duplicates.
    maybeResetToolStream(state);
    if (preserveStream) {
      state.chatStream = savedStream;
      state.chatStreamStartedAt = savedStartedAt;
    } else {
      state.chatStream = null;
      state.chatStreamStartedAt = null;
    }
  } catch (err) {
    if (isMissingOperatorReadScopeError(err)) {
      state.chatMessages = [];
      state.chatThinkingLevel = null;
      state.lastError = formatMissingOperatorReadScopeMessage("existing chat history");
    } else {
      state.lastError = String(err);
    }
  } finally {
    state.chatLoading = false;
  }
}

function dataUrlToBase64(dataUrl: string): { content: string; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return null;
  }
  return { mimeType: match[1], content: match[2] };
}

type AssistantMessageNormalizationOptions = {
  roleRequirement: "required" | "optional";
  roleCaseSensitive?: boolean;
  requireContentArray?: boolean;
  allowTextField?: boolean;
};

function normalizeAssistantMessage(
  message: unknown,
  options: AssistantMessageNormalizationOptions,
): Record<string, unknown> | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const candidate = message as Record<string, unknown>;
  const roleValue = candidate.role;
  if (typeof roleValue === "string") {
    const role = options.roleCaseSensitive ? roleValue : roleValue.toLowerCase();
    if (role !== "assistant") {
      return null;
    }
  } else if (options.roleRequirement === "required") {
    return null;
  }

  if (options.requireContentArray) {
    return Array.isArray(candidate.content) ? candidate : null;
  }
  if (!("content" in candidate) && !(options.allowTextField && "text" in candidate)) {
    return null;
  }
  return candidate;
}

function normalizeAbortedAssistantMessage(message: unknown): Record<string, unknown> | null {
  return normalizeAssistantMessage(message, {
    roleRequirement: "required",
    roleCaseSensitive: true,
    requireContentArray: true,
  });
}

function normalizeFinalAssistantMessage(message: unknown): Record<string, unknown> | null {
  return normalizeAssistantMessage(message, {
    roleRequirement: "optional",
    allowTextField: true,
  });
}

export async function sendChatMessage(
  state: ChatState,
  message: string,
  attachments?: ChatAttachment[],
): Promise<string | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const msg = message.trim();
  const hasAttachments = attachments && attachments.length > 0;
  if (!msg && !hasAttachments) {
    return null;
  }

  const now = Date.now();

  // Build user message content blocks
  const contentBlocks: Array<{ type: string; text?: string; source?: unknown }> = [];
  if (msg) {
    contentBlocks.push({ type: "text", text: msg });
  }
  // Add image previews to the message for display
  if (hasAttachments) {
    for (const att of attachments) {
      contentBlocks.push({
        type: "image",
        source: { type: "base64", media_type: att.mimeType, data: att.dataUrl },
      });
    }
  }

  state.chatMessages = [
    ...state.chatMessages,
    {
      role: "user",
      content: contentBlocks,
      timestamp: now,
    },
  ];

  state.chatSending = true;
  state.lastError = null;
  const runId = generateUUID();
  state.chatRunId = runId;
  state.chatStream = null;
  state.chatStreamStartedAt = now;
  state.chatWaitingUserRunId = runId;
  state.chatLastWaitDurationMs = null;

  // Convert attachments to API format
  const apiAttachments = hasAttachments
    ? attachments
        .map((att) => {
          const parsed = dataUrlToBase64(att.dataUrl);
          if (!parsed) {
            return null;
          }
          return {
            type: "image",
            mimeType: parsed.mimeType,
            content: parsed.content,
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null)
    : undefined;

  try {
    await state.client.request("chat.send", {
      sessionKey: state.sessionKey,
      message: msg,
      deliver: false,
      idempotencyKey: runId,
      attachments: apiAttachments,
    });
    return runId;
  } catch (err) {
    const error = formatConnectError(err);
    state.chatRunId = null;
    state.chatStream = null;
    state.chatStreamStartedAt = null;
    state.chatWaitingUserRunId = null;
    state.lastError = error;
    state.chatMessages = [
      ...state.chatMessages,
      {
        role: "assistant",
        content: [{ type: "text", text: "Error: " + error }],
        timestamp: Date.now(),
      },
    ];
    return null;
  } finally {
    state.chatSending = false;
  }
}

export async function abortChatRun(state: ChatState): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  const runId = state.chatRunId;
  try {
    await state.client.request(
      "chat.abort",
      runId ? { sessionKey: state.sessionKey, runId } : { sessionKey: state.sessionKey },
    );
    return true;
  } catch (err) {
    state.lastError = formatConnectError(err);
    return false;
  }
}

function clearChatRunState(state: ChatState) {
  if (state.chatStreamStartedAt) {
    state.chatLastWaitDurationMs = Date.now() - state.chatStreamStartedAt;
  }
  state.chatStream = null;
  state.chatRunId = null;
  state.chatStreamStartedAt = null;
  state.chatWaitingUserRunId = null;
}

export function handleChatEvent(state: ChatState, payload?: ChatEventPayload) {
  if (!payload) {
    return null;
  }
  if (payload.sessionKey !== state.sessionKey) {
    return null;
  }

  // Final from another run (e.g. sub-agent announce): refresh history to show new message.
  // See https://github.com/openclaw/openclaw/issues/1909
  if (payload.runId && state.chatRunId && payload.runId !== state.chatRunId) {
    if (payload.state === "final") {
      const finalMessage = normalizeFinalAssistantMessage(payload.message);
      if (finalMessage && !isAssistantSilentReply(finalMessage)) {
        state.chatMessages = [...state.chatMessages, finalMessage];
      } else if (
        state.tab === "chatProjectRun" &&
        state.chatStream?.trim() &&
        !isSilentReplyStream(state.chatStream)
      ) {
        state.chatMessages = [
          ...state.chatMessages,
          {
            role: "assistant",
            content: [{ type: "text", text: state.chatStream }],
            timestamp: Date.now(),
          },
        ];
      }
      // Project Run: server run id (bootstrap / agent) almost never matches the client's
      // idempotency UUID. If we return null here, we never clear chatRunId and handleTerminalChatEvent
      // never runs — queued operator messages stay stuck and the UI looks "finished" with pending sends.
      if (state.tab === "chatProjectRun") {
        // Preserve in-flight stream state when a user message is actively being processed.
        // An active chatRunId + non-empty chatStream means the user's message is still being
        // processed — clearing them here would wipe the response and trigger loadChatHistory,
        // which destroys the in-flight reply even though shouldPreserveStreamingDuringHistoryReload
        // would have protected it (if state hadn't been nulled first).
        const hasInFlightResponse = state.chatRunId?.trim() && state.chatStream?.trim();
        if (!hasInFlightResponse) {
          clearChatRunState(state);
        }
        return "final";
      }
      if (finalMessage && !isAssistantSilentReply(finalMessage)) {
        return null;
      }
      return "final";
    }
    // Project Run: bootstrap uses one idempotency run id; a user follow-up uses another. Still
    // show the primary run's streaming deltas so the thread does not look frozen.
    if (payload.state === "delta" && state.tab === "chatProjectRun") {
      const next = extractText(payload.message);
      if (typeof next === "string" && !isSilentReplyStream(next)) {
        const current = state.chatStream ?? "";
        if (!current || next.length >= current.length) {
          state.chatStream = next;
        }
      }
      return null;
    }
    return null;
  }

  if (payload.state === "delta") {
    const next = extractText(payload.message);
    if (typeof next === "string" && !isSilentReplyStream(next)) {
      const current = state.chatStream ?? "";
      if (!current || next.length >= current.length) {
        state.chatStream = next;
      }
    }
  } else if (payload.state === "final") {
    const finalMessage = normalizeFinalAssistantMessage(payload.message);
    if (finalMessage && !isAssistantSilentReply(finalMessage)) {
      state.chatMessages = [...state.chatMessages, finalMessage];
    } else if (state.chatStream?.trim() && !isSilentReplyStream(state.chatStream)) {
      state.chatMessages = [
        ...state.chatMessages,
        {
          role: "assistant",
          content: [{ type: "text", text: state.chatStream }],
          timestamp: Date.now(),
        },
      ];
    }
    clearChatRunState(state);
  } else if (payload.state === "aborted") {
    const normalizedMessage = normalizeAbortedAssistantMessage(payload.message);
    if (normalizedMessage && !isAssistantSilentReply(normalizedMessage)) {
      state.chatMessages = [...state.chatMessages, normalizedMessage];
    } else {
      const streamedText = state.chatStream ?? "";
      if (streamedText.trim() && !isSilentReplyStream(streamedText)) {
        state.chatMessages = [
          ...state.chatMessages,
          {
            role: "assistant",
            content: [{ type: "text", text: streamedText }],
            timestamp: Date.now(),
          },
        ];
      }
    }
    clearChatRunState(state);
  } else if (payload.state === "error") {
    clearChatRunState(state);
    state.lastError = payload.errorMessage ?? "chat error";
  }
  return payload.state;
}
