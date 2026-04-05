import { createSubsystemLogger } from "../logging/subsystem.js";
import { getGatewayRequestContextFromFallback } from "./server-plugins.js";

const log = createSubsystemLogger("project-run-status-inject");

/**
 * Injects a transcript line from the executor when the gateway request context is unavailable
 * on the inbound RPC path (same process as gateway; uses fallback context).
 */
export async function injectProjectRunTerminalStatusFromExecutor(params: {
  sessionKey: string;
  message: string;
}): Promise<void> {
  const context = getGatewayRequestContextFromFallback();
  if (!context) {
    log.warn("skipped terminal status inject (executor): no gateway context");
    return;
  }
  const { chatHandlers } = await import("./server-methods/chat.js");
  await chatHandlers["chat.inject"]({
    req: {} as never,
    params: {
      sessionKey: params.sessionKey.trim(),
      message: params.message,
      label: "Project Run status",
    },
    respond: () => {},
    context,
    client: null,
    isWebchatConnect: () => false,
  });
}
