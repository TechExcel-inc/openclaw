import { createSubsystemLogger } from "../logging/subsystem.js";
import { getGatewayRequestContextFromFallback } from "./server-plugins.js";

const log = createSubsystemLogger("project-run-auto-continue");

function formatChatSendError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string") {
      return msg;
    }
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "unknown error";
  }
}

/**
 * Sends a user message to restart the agent after a completed turn, while the Project Run
 * executor still considers the execution active (time budget not exceeded). Uses the same
 * fallback gateway context as terminal transcript injects.
 */
export async function sendProjectRunAutoContinueFromExecutor(params: {
  sessionKey: string;
  executionId: string;
  continuationSeq: number;
  message: string;
}): Promise<{ ok: boolean; error?: string }> {
  const context = getGatewayRequestContextFromFallback();
  if (!context) {
    log.warn("skipped auto-continue: no gateway context");
    return { ok: false, error: "no gateway context" };
  }
  const { chatHandlers } = await import("./server-methods/chat.js");
  const idempotencyKey = `project-run-continue:${params.executionId}:${params.continuationSeq}`;
  let sendError: unknown;
  let ok = false;
  await chatHandlers["chat.send"]({
    req: {} as never,
    params: {
      sessionKey: params.sessionKey.trim(),
      message: params.message,
      deliver: true,
      idempotencyKey,
    },
    respond: (success, _payload, error) => {
      ok = success;
      sendError = error;
    },
    context,
    client: null,
    isWebchatConnect: () => false,
  });
  if (!ok) {
    log.warn(
      `auto-continue chat.send failed for ${params.executionId}: ${formatChatSendError(sendError)}`,
    );
    return {
      ok: false,
      error: sendError !== undefined ? formatChatSendError(sendError) : "chat.send failed",
    };
  }
  return { ok: true };
}
