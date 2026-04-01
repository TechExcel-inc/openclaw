import type { ProjectTemplate, ProjectExecute } from "../../../../src/projects/types.js";

export type TemplatesListResult = {
  templates: ProjectTemplate[];
  activeTemplateId: string | null;
};

export type ExecutionsListResult = {
  executions: ProjectExecute[];
};

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

  // Executions
  executionsLoading: boolean;
  executionsError: string | null;
  executionsList: ProjectExecute[];

  activeExecutionId: string | null;

  executionDetail: ProjectExecute | null;
  executionDetailLoading: boolean;

  globalExecutionsLoading: boolean;
  globalExecutionsList: ProjectExecute[];
};

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
  updates: { name?: string; description?: string; targetUrl?: string; aiPrompt?: string },
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
      void loadTemplateDetail(state, id);
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
  }
}

export async function loadExecutionDetail(state: ProjectsState, id: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.executionDetailLoading = true;
  try {
    const res = await state.client.request<ProjectExecute>("executions.get", { id });
    if (res) {
      state.executionDetail = res;
    }
  } catch (err) {
    state.executionsError = String(err);
  } finally {
    state.executionDetailLoading = false;
  }
}

export async function runExecution(state: ProjectsState, templateId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<ProjectExecute>("executions.run", { templateId });
    if (res) {
      state.executionsList.push(res);
      // Wait a moment and continuously reload execution details
      void runExecutionPoller(state, res.id);
    }
  } catch (err) {
    state.executionsError = String(err);
  }
}

export async function cancelExecution(state: ProjectsState, id: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<ProjectExecute>("executions.cancel", { id });
    if (res) {
      const idx = state.executionsList.findIndex((e) => e.id === id);
      if (idx !== -1) {
        state.executionsList[idx] = res;
      }
      if (state.executionDetail?.id === id) {
        state.executionDetail = res;
      }
    }
  } catch (err) {
    state.executionsError = String(err);
  }
}

async function runExecutionPoller(state: ProjectsState, executionId: string) {
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (!state.client) {
      break;
    }
    try {
      const res = await state.client.request<ProjectExecute>("executions.get", { id: executionId });
      if (res) {
        const idx = state.executionsList.findIndex((e) => e.id === executionId);
        if (idx !== -1) {
          state.executionsList[idx] = res;
        }
        if (state.executionDetail?.id === executionId) {
          state.executionDetail = res;
        }
        if (res.status === "completed" || res.status === "error" || res.status === "cancelled") {
          return;
        }
      }
    } catch {
      break;
    }
  }
}

export async function setActiveExecution(state: ProjectsState, id: string | null) {
  state.activeExecutionId = id;
  if (id) {
    void loadExecutionDetail(state, id);
  } else {
    state.executionDetail = null;
  }
}
