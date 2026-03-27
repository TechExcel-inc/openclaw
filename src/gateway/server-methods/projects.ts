import {
  loadProjectsStore,
  resolveProjectsStorePath,
  saveProjectsStore,
} from "../../projects/store.js";
import type {
  Project,
  ProjectDocument,
  ProjectDocumentType,
  ProjectType,
} from "../../projects/types.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateProjectsAnalyzeParams,
  validateProjectsAnalyzeStatusParams,
  validateProjectsCreateParams,
  validateProjectsDeleteParams,
  validateProjectsDocumentsCreateParams,
  validateProjectsDocumentsDeleteParams,
  validateProjectsDocumentsGetParams,
  validateProjectsDocumentsListParams,
  validateProjectsDocumentsUpdateParams,
  validateProjectsGetParams,
  validateProjectsSetActiveParams,
  validateProjectsUpdateParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const storePath = resolveProjectsStorePath();

export const projectsHandlers: GatewayRequestHandlers = {
  "projects.list": async ({ respond }) => {
    try {
      const store = await loadProjectsStore(storePath);
      respond(true, {
        projects: store.projects.map(stripDocuments),
        activeProjectId: store.activeProjectId,
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "projects.get": async ({ params, respond }) => {
    if (!validateProjectsGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid projects.get params: ${formatValidationErrors(validateProjectsGetParams.errors)}`,
        ),
      );
      return;
    }
    const { id } = params as { id: string };
    try {
      const store = await loadProjectsStore(storePath);
      const project = store.projects.find((p) => p.id === id);
      if (!project) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `project not found: ${id}`),
        );
        return;
      }
      respond(true, project);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "projects.create": async ({ params, respond }) => {
    if (!validateProjectsCreateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid projects.create params: ${formatValidationErrors(validateProjectsCreateParams.errors)}`,
        ),
      );
      return;
    }
    const { name, type, boundUrl } = params as {
      name: string;
      type: ProjectType;
      boundUrl?: string;
    };
    try {
      const store = await loadProjectsStore(storePath);
      const now = Date.now();
      const project: Project = {
        id: crypto.randomUUID(),
        name,
        type,
        boundUrl: boundUrl ?? "",
        createdAt: now,
        updatedAt: now,
        documents: [],
      };
      store.projects.push(project);
      if (!store.activeProjectId) {
        store.activeProjectId = project.id;
      }
      await saveProjectsStore(storePath, store);
      respond(true, project);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "projects.update": async ({ params, respond }) => {
    if (!validateProjectsUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid projects.update params: ${formatValidationErrors(validateProjectsUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const { id, name, type, boundUrl } = params as {
      id: string;
      name?: string;
      type?: ProjectType;
      boundUrl?: string;
    };
    try {
      const store = await loadProjectsStore(storePath);
      const project = store.projects.find((p) => p.id === id);
      if (!project) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `project not found: ${id}`),
        );
        return;
      }
      if (name !== undefined) {
        project.name = name;
      }
      if (type !== undefined) {
        project.type = type;
      }
      if (boundUrl !== undefined) {
        project.boundUrl = boundUrl;
      }
      project.updatedAt = Date.now();
      await saveProjectsStore(storePath, store);
      respond(true, stripDocuments(project));
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "projects.delete": async ({ params, respond }) => {
    if (!validateProjectsDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid projects.delete params: ${formatValidationErrors(validateProjectsDeleteParams.errors)}`,
        ),
      );
      return;
    }
    const { id } = params as { id: string };
    try {
      const store = await loadProjectsStore(storePath);
      const idx = store.projects.findIndex((p) => p.id === id);
      if (idx === -1) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `project not found: ${id}`),
        );
        return;
      }
      store.projects.splice(idx, 1);
      if (store.activeProjectId === id) {
        store.activeProjectId = store.projects[0]?.id ?? null;
      }
      await saveProjectsStore(storePath, store);
      respond(true, { ok: true });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "projects.setActive": async ({ params, respond }) => {
    if (!validateProjectsSetActiveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid projects.setActive params: ${formatValidationErrors(validateProjectsSetActiveParams.errors)}`,
        ),
      );
      return;
    }
    const { id } = params as { id?: string };
    try {
      const store = await loadProjectsStore(storePath);
      if (id && !store.projects.some((p) => p.id === id)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `project not found: ${id}`),
        );
        return;
      }
      store.activeProjectId = id ?? null;
      await saveProjectsStore(storePath, store);
      respond(true, { activeProjectId: store.activeProjectId });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "projects.documents.list": async ({ params, respond }) => {
    if (!validateProjectsDocumentsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid projects.documents.list params: ${formatValidationErrors(validateProjectsDocumentsListParams.errors)}`,
        ),
      );
      return;
    }
    const { projectId } = params as { projectId: string };
    try {
      const store = await loadProjectsStore(storePath);
      const project = store.projects.find((p) => p.id === projectId);
      if (!project) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `project not found: ${projectId}`),
        );
        return;
      }
      respond(true, { documents: project.documents });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "projects.documents.get": async ({ params, respond }) => {
    if (!validateProjectsDocumentsGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid projects.documents.get params: ${formatValidationErrors(validateProjectsDocumentsGetParams.errors)}`,
        ),
      );
      return;
    }
    const { projectId, id } = params as { projectId: string; id: string };
    try {
      const store = await loadProjectsStore(storePath);
      const project = store.projects.find((p) => p.id === projectId);
      if (!project) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `project not found: ${projectId}`),
        );
        return;
      }
      const doc = project.documents.find((d) => d.id === id);
      if (!doc) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `document not found: ${id}`),
        );
        return;
      }
      respond(true, doc);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "projects.documents.create": async ({ params, respond }) => {
    if (!validateProjectsDocumentsCreateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid projects.documents.create params: ${formatValidationErrors(validateProjectsDocumentsCreateParams.errors)}`,
        ),
      );
      return;
    }
    const { projectId, name, type, content } = params as {
      projectId: string;
      name: string;
      type?: ProjectDocumentType;
      content?: string;
    };
    try {
      const store = await loadProjectsStore(storePath);
      const project = store.projects.find((p) => p.id === projectId);
      if (!project) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `project not found: ${projectId}`),
        );
        return;
      }
      const now = Date.now();
      const doc: ProjectDocument = {
        id: crypto.randomUUID(),
        projectId,
        name,
        type: type ?? "general",
        content: content ?? "",
        createdAt: now,
        updatedAt: now,
      };
      project.documents.push(doc);
      project.updatedAt = now;
      await saveProjectsStore(storePath, store);
      respond(true, doc);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "projects.documents.update": async ({ params, respond }) => {
    if (!validateProjectsDocumentsUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid projects.documents.update params: ${formatValidationErrors(validateProjectsDocumentsUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const { projectId, id, name, type, content } = params as {
      projectId: string;
      id: string;
      name?: string;
      type?: ProjectDocumentType;
      content?: string;
    };
    try {
      const store = await loadProjectsStore(storePath);
      const project = store.projects.find((p) => p.id === projectId);
      if (!project) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `project not found: ${projectId}`),
        );
        return;
      }
      const doc = project.documents.find((d) => d.id === id);
      if (!doc) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `document not found: ${id}`),
        );
        return;
      }
      if (name !== undefined) {
        doc.name = name;
      }
      if (type !== undefined) {
        doc.type = type;
      }
      if (content !== undefined) {
        doc.content = content;
      }
      doc.updatedAt = Date.now();
      project.updatedAt = Date.now();
      await saveProjectsStore(storePath, store);
      respond(true, doc);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "projects.documents.delete": async ({ params, respond }) => {
    if (!validateProjectsDocumentsDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid projects.documents.delete params: ${formatValidationErrors(validateProjectsDocumentsDeleteParams.errors)}`,
        ),
      );
      return;
    }
    const { projectId, id } = params as { projectId: string; id: string };
    try {
      const store = await loadProjectsStore(storePath);
      const project = store.projects.find((p) => p.id === projectId);
      if (!project) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `project not found: ${projectId}`),
        );
        return;
      }
      const idx = project.documents.findIndex((d) => d.id === id);
      if (idx === -1) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `document not found: ${id}`),
        );
        return;
      }
      project.documents.splice(idx, 1);
      project.updatedAt = Date.now();
      await saveProjectsStore(storePath, store);
      respond(true, { ok: true });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "projects.analyze": async ({ params, respond, context }) => {
    if (!validateProjectsAnalyzeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid projects.analyze params: ${formatValidationErrors(validateProjectsAnalyzeParams.errors)}`,
        ),
      );
      return;
    }
    const { projectId } = params as { projectId: string };
    try {
      const store = await loadProjectsStore(storePath);
      const project = store.projects.find((p) => p.id === projectId);
      if (!project) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `project not found: ${projectId}`),
        );
        return;
      }
      if (!project.boundUrl) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "project has no bound URL"),
        );
        return;
      }
      // Start analysis asynchronously
      project.analysisState = {
        lastAnalyzedAt: null,
        status: "fetching",
      };
      await saveProjectsStore(storePath, store);
      respond(true, { status: "fetching" });

      // Run analysis in background
      runAnalysis(projectId, project.boundUrl, context.logGateway).catch(() => {
        // Errors are handled inside runAnalysis
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "projects.analyze.status": async ({ params, respond }) => {
    if (!validateProjectsAnalyzeStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid projects.analyze.status params: ${formatValidationErrors(validateProjectsAnalyzeStatusParams.errors)}`,
        ),
      );
      return;
    }
    const { projectId } = params as { projectId: string };
    try {
      const store = await loadProjectsStore(storePath);
      const project = store.projects.find((p) => p.id === projectId);
      if (!project) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `project not found: ${projectId}`),
        );
        return;
      }
      respond(true, {
        analysisState: project.analysisState ?? {
          lastAnalyzedAt: null,
          status: "idle",
        },
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};

function stripDocuments(project: Project) {
  const { documents: _docs, ...rest } = project;
  return { ...rest, documentCount: project.documents.length };
}

async function runAnalysis(
  projectId: string,
  url: string,
  log: { warn: (msg: string) => void; error: (msg: string) => void },
) {
  try {
    // Fetch URL content
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": "OpenClaw-ProjectAnalyzer/1.0" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const content = await response.text();

    // Import analyzer and generate documents
    const { analyzeProjectContent } = await import("../../projects/analyzer.js");
    const documents = await analyzeProjectContent(content, url);

    // Update store with results
    const store = await loadProjectsStore(storePath);
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) {
      return;
    }

    project.analysisState = {
      lastAnalyzedAt: Date.now(),
      status: "complete",
    };
    for (const doc of documents) {
      doc.projectId = projectId;
      const existingIdx = project.documents.findIndex((d) => d.type === doc.type);
      if (existingIdx >= 0) {
        project.documents[existingIdx] = doc;
      } else {
        project.documents.push(doc);
      }
    }
    project.updatedAt = Date.now();
    await saveProjectsStore(storePath, store);
  } catch (err) {
    log.error(`project analysis failed for ${projectId}: ${String(err)}`);
    try {
      const store = await loadProjectsStore(storePath);
      const project = store.projects.find((p) => p.id === projectId);
      if (project) {
        project.analysisState = {
          lastAnalyzedAt: null,
          status: "error",
          error: String(err),
        };
        await saveProjectsStore(storePath, store);
      }
    } catch {
      // Best-effort error state update
    }
  }
}
