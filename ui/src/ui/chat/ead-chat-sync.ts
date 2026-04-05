import { syncUrlWithSessionKey } from "../app-settings.ts";
import type { AppViewState } from "../app-view-state.ts";
import { ChatState, loadChatHistory } from "../controllers/chat.ts";
import { loadSessions } from "../controllers/sessions.ts";
import {
  buildEadProjectChatSessionKey,
  resolveEadProjectContextFromState,
  stripEadProjectSuffix,
} from "./ead-project-session-key.ts";

type SessionSwitchHost = AppViewState & {
  resetToolStream: () => void;
  resetChatScroll: () => void;
};

async function refreshSessionOptions(state: AppViewState) {
  await loadSessions(state as unknown as Parameters<typeof loadSessions>[0], {
    activeMinutes: 0,
    limit: 0,
    includeGlobal: true,
    includeUnknown: true,
  });
}

export function switchChatSession(state: AppViewState, nextSessionKey: string) {
  const base = stripEadProjectSuffix(nextSessionKey.trim());
  const resolved = buildEadProjectChatSessionKey(base, resolveEadProjectContextFromState(state));
  if (resolved === state.sessionKey) {
    return;
  }
  const host = state as unknown as SessionSwitchHost;
  state.sessionKey = resolved;
  // Drop prior thread so loadChatHistory does not merge user rows from another session/run.
  // Otherwise switching Project Run nav (different eadproj:run:<id>) re-appends the previous
  // run's bootstrap user message — same merge logic that preserves optimistic sends within one session.
  state.chatMessages = [];
  state.chatMessage = "";
  state.chatStream = null;
  state.chatQueue = [];
  state.chatStreamStartedAt = null;
  state.chatRunId = null;
  host.resetToolStream();
  host.resetChatScroll();
  state.applySettings({
    ...state.settings,
    sessionKey: resolved,
    lastActiveSessionKey: resolved,
  });
  void state.loadAssistantIdentity();
  syncUrlWithSessionKey(
    state as unknown as Parameters<typeof syncUrlWithSessionKey>[0],
    resolved,
    true,
  );
  void loadChatHistory(state as unknown as ChatState);
  void refreshSessionOptions(state);
}

export function applyEadChatSessionToState(state: AppViewState): void {
  switchChatSession(state, state.sessionKey);
}
