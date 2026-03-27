import type { ProjectType } from "../../../../src/projects/types.js";

export type ProjectSummary = {
  id: string;
  name: string;
  type: ProjectType;
  boundUrl: string;
  createdAt: number;
  updatedAt: number;
  documentCount: number;
};

export type ProjectsListResult = {
  projects: ProjectSummary[];
  activeProjectId: string | null;
};

export type ProjectDocument = {
  id: string;
  projectId: string;
  name: string;
  type: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type Project = ProjectSummary & {
  documents: ProjectDocument[];
  analysisState?: {
    lastAnalyzedAt: number | null;
    status: string;
    error?: string;
  };
};

export type ProjectsState = {
  client: {
    request: <T>(method: string, params?: Record<string, unknown>) => Promise<T | undefined>;
  } | null;
  connected: boolean;

  projectsLoading: boolean;
  projectsError: string | null;
  projectsList: ProjectSummary[];
  activeProjectId: string | null;

  projectDetail: Project | null;
  projectDetailLoading: boolean;

  projectDocuments: ProjectDocument[];
  projectDocumentsLoading: boolean;

  projectAnalysisStatus: string | null;

  projectCreating: boolean;

  showCreateModal: boolean;
  createFormName: string;
  createFormType: ProjectType;
  createFormUrl: string;
};

export async function loadProjects(state: ProjectsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.projectsLoading) {
    return;
  }
  state.projectsLoading = true;
  state.projectsError = null;
  try {
    const res = await state.client.request<ProjectsListResult>("projects.list", {});
    if (res) {
      state.projectsList = res.projects;
      state.activeProjectId = res.activeProjectId;
    }
  } catch (err) {
    state.projectsError = String(err);
  } finally {
    state.projectsLoading = false;
  }
}

export async function createProject(
  state: ProjectsState,
  name: string,
  type: ProjectType,
  boundUrl?: string,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.projectCreating = true;
  try {
    const res = await state.client.request<Project>("projects.create", {
      name,
      type,
      boundUrl: boundUrl ?? "",
    });
    if (res) {
      state.projectsList.push({
        id: res.id,
        name: res.name,
        type: res.type,
        boundUrl: res.boundUrl,
        createdAt: res.createdAt,
        updatedAt: res.updatedAt,
        documentCount: 0,
      });
      if (!state.activeProjectId) {
        state.activeProjectId = res.id;
      }
      state.showCreateModal = false;
      state.createFormName = "";
      state.createFormUrl = "";
    }
  } catch (err) {
    state.projectsError = String(err);
  } finally {
    state.projectCreating = false;
  }
}

export async function deleteProject(state: ProjectsState, id: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("projects.delete", { id });
    state.projectsList = state.projectsList.filter((p) => p.id !== id);
    if (state.activeProjectId === id) {
      state.activeProjectId = state.projectsList[0]?.id ?? null;
      state.projectDetail = null;
    }
  } catch (err) {
    state.projectsError = String(err);
  }
}

export async function setActiveProject(state: ProjectsState, id: string | null) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("projects.setActive", { id: id ?? undefined });
    state.activeProjectId = id;
    if (id) {
      await loadProjectDetail(state, id);
    } else {
      state.projectDetail = null;
    }
  } catch (err) {
    state.projectsError = String(err);
  }
}

export async function updateProjectUrl(state: ProjectsState, id: string, url: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("projects.update", { id, boundUrl: url });
    const project = state.projectsList.find((p) => p.id === id);
    if (project) {
      project.boundUrl = url;
    }
    if (state.projectDetail?.id === id) {
      state.projectDetail.boundUrl = url;
    }
  } catch (err) {
    state.projectsError = String(err);
  }
}

export async function loadProjectDetail(state: ProjectsState, id: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.projectDetailLoading = true;
  try {
    const res = await state.client.request<Project>("projects.get", { id });
    if (res) {
      state.projectDetail = res;
      state.projectDocuments = res.documents;
      state.projectAnalysisStatus = res.analysisState?.status ?? "idle";
    }
  } catch (err) {
    state.projectsError = String(err);
  } finally {
    state.projectDetailLoading = false;
  }
}

export async function createDocument(
  state: ProjectsState,
  projectId: string,
  name: string,
  type?: string,
  content?: string,
) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<ProjectDocument>("projects.documents.create", {
      projectId,
      name,
      type: type ?? "general",
      content: content ?? "",
    });
    if (res) {
      state.projectDocuments.push(res);
    }
  } catch (err) {
    state.projectsError = String(err);
  }
}

export async function updateDocument(
  state: ProjectsState,
  projectId: string,
  id: string,
  updates: { name?: string; content?: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<ProjectDocument>("projects.documents.update", {
      projectId,
      id,
      ...updates,
    });
    if (res) {
      const idx = state.projectDocuments.findIndex((d) => d.id === id);
      if (idx >= 0) {
        state.projectDocuments[idx] = res;
      }
    }
  } catch (err) {
    state.projectsError = String(err);
  }
}

export async function deleteDocument(state: ProjectsState, projectId: string, id: string) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("projects.documents.delete", { projectId, id });
    state.projectDocuments = state.projectDocuments.filter((d) => d.id !== id);
  } catch (err) {
    state.projectsError = String(err);
  }
}

export async function analyzeProject(state: ProjectsState, projectId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.projectAnalysisStatus = "fetching";
  try {
    await state.client.request("projects.analyze", { projectId });
    // Poll for status
    void pollAnalysisStatus(state, projectId);
  } catch (err) {
    state.projectAnalysisStatus = "error";
    state.projectsError = String(err);
  }
}

export async function pollAnalysisStatus(state: ProjectsState, projectId: string) {
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (!state.client) {
      break;
    }
    try {
      const res = await state.client.request<{ analysisState: { status: string } }>(
        "projects.analyze.status",
        { projectId },
      );
      if (res) {
        state.projectAnalysisStatus = res.analysisState.status;
        if (res.analysisState.status === "complete" || res.analysisState.status === "error") {
          await loadProjectDetail(state, projectId);
          return;
        }
      }
    } catch {
      break;
    }
  }
}
