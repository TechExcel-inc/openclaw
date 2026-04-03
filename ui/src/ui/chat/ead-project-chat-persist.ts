import type { AppViewState } from "../app-view-state.ts";
import { switchChatSession } from "./ead-chat-sync.ts";
import { stripEadProjectSuffix } from "./ead-project-session-key.ts";

const STORAGE_KEY = "ead.control.projectChat.lastTemplateOrExecutionId";

export function readPersistedProjectChatId(): string | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    const v = localStorage.getItem(STORAGE_KEY)?.trim();
    return v || null;
  } catch {
    return null;
  }
}

export function writePersistedProjectChatId(id: string | null): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    if (id == null || id === "") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, id);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * When opening Project Chat with no active selection, restore the last saved
 * Test Plan id (template). Legacy persisted execution ids are mapped to linkedTemplateId.
 */
export function applyPersistedProjectChatSelection(state: AppViewState): void {
  if (state.tab !== "chatProject") {
    return;
  }
  if (state.chatActiveTemplateId) {
    return;
  }
  const id = readPersistedProjectChatId();
  if (!id) {
    return;
  }
  const inTemplates = state.templatesList.some((t) => t.id === id);
  if (inTemplates) {
    state.chatActiveTemplateId = id;
    state.chatSelectedTemplateId = id;
    state.projectLeftPanelDismissed = false;
    if (state.connected) {
      switchChatSession(state, stripEadProjectSuffix(state.sessionKey));
    }
    return;
  }
  const ex = (state.globalExecutionsList ?? []).find((e) => e.id === id);
  const templateId = ex?.linkedTemplateId;
  if (!templateId || !state.templatesList.some((t) => t.id === templateId)) {
    return;
  }
  state.chatActiveTemplateId = templateId;
  state.chatSelectedTemplateId = templateId;
  writePersistedProjectChatId(templateId);
  state.projectLeftPanelDismissed = false;
  if (state.connected) {
    switchChatSession(state, stripEadProjectSuffix(state.sessionKey));
  }
}
