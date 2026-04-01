import {
  loadProjectsStore,
  resolveProjectsStorePath,
  saveProjectsStore,
} from "../../projects/store.js";
import type { ProjectTemplate, ProjectExecute } from "../../projects/types.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateTemplatesGetParams,
  validateTemplatesCreateParams,
  validateTemplatesUpdateParams,
  validateTemplatesDeleteParams,
  validateTemplatesSetActiveParams,
  validateExecutionsListParams,
  validateExecutionsGetParams,
  validateExecutionsRunParams,
  validateExecutionsCancelParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const storePath = resolveProjectsStorePath();

export const projectsHandlers: GatewayRequestHandlers = {
  // ---------------------------------------------------------------------------
  // TEMPLATES
  // ---------------------------------------------------------------------------
  "templates.list": async ({ respond }) => {
    try {
      const store = await loadProjectsStore(storePath);
      respond(true, {
        templates: store.templates,
        activeTemplateId: store.activeTemplateId,
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "templates.get": async ({ params, respond }) => {
    if (!validateTemplatesGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid templates.get params: ${formatValidationErrors(validateTemplatesGetParams.errors)}`,
        ),
      );
      return;
    }
    const { id } = params as { id: string };
    try {
      const store = await loadProjectsStore(storePath);
      const template = store.templates.find((p) => p.id === id);
      if (!template) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `template not found: ${id}`),
        );
        return;
      }
      respond(true, template);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "templates.create": async ({ params, respond }) => {
    if (!validateTemplatesCreateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid templates.create params: ${formatValidationErrors(validateTemplatesCreateParams.errors)}`,
        ),
      );
      return;
    }
    const { name, description, targetUrl, aiPrompt } = params as {
      name: string;
      description?: string;
      targetUrl?: string;
      aiPrompt?: string;
    };
    try {
      const store = await loadProjectsStore(storePath);
      const now = Date.now();
      const template: ProjectTemplate = {
        id: crypto.randomUUID(),
        name,
        description: description ?? "",
        targetUrl: targetUrl ?? "",
        aiPrompt: aiPrompt ?? "",
        totalTestSteps: 0,
        failedTestSteps: 0,
        pfmNodes: [],
        createdAt: now,
        createdBy: "system",
        lastModifiedAt: now,
        lastModifiedBy: "system",
      };
      store.templates.push(template);
      if (!store.activeTemplateId) {
        store.activeTemplateId = template.id;
      }
      await saveProjectsStore(storePath, store);
      respond(true, template);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "templates.update": async ({ params, respond }) => {
    if (!validateTemplatesUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid templates.update params: ${formatValidationErrors(validateTemplatesUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const { id, name, description, targetUrl, aiPrompt } = params as {
      id: string;
      name?: string;
      description?: string;
      targetUrl?: string;
      aiPrompt?: string;
    };
    try {
      const store = await loadProjectsStore(storePath);
      const template = store.templates.find((p) => p.id === id);
      if (!template) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `template not found: ${id}`),
        );
        return;
      }
      if (name !== undefined) {
        template.name = name;
      }
      if (description !== undefined) {
        template.description = description;
      }
      if (targetUrl !== undefined) {
        template.targetUrl = targetUrl;
      }
      if (aiPrompt !== undefined) {
        template.aiPrompt = aiPrompt;
      }

      template.lastModifiedAt = Date.now();
      await saveProjectsStore(storePath, store);
      respond(true, template);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "templates.delete": async ({ params, respond }) => {
    if (!validateTemplatesDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid templates.delete params: ${formatValidationErrors(validateTemplatesDeleteParams.errors)}`,
        ),
      );
      return;
    }
    const { id } = params as { id: string };
    try {
      const store = await loadProjectsStore(storePath);
      const idx = store.templates.findIndex((p) => p.id === id);
      if (idx === -1) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `template not found: ${id}`),
        );
        return;
      }
      store.templates.splice(idx, 1);
      if (store.activeTemplateId === id) {
        store.activeTemplateId = store.templates[0]?.id ?? null;
      }
      // cascade delete executions linked to this template
      store.executions = store.executions.filter((e) => e.linkedTemplateId !== id);

      await saveProjectsStore(storePath, store);
      respond(true, { ok: true });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "templates.setActive": async ({ params, respond }) => {
    if (!validateTemplatesSetActiveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid templates.setActive params: ${formatValidationErrors(validateTemplatesSetActiveParams.errors)}`,
        ),
      );
      return;
    }
    const { id } = params as { id?: string };
    try {
      const store = await loadProjectsStore(storePath);
      if (id && !store.templates.some((p) => p.id === id)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `template not found: ${id}`),
        );
        return;
      }
      store.activeTemplateId = id ?? null;
      await saveProjectsStore(storePath, store);
      respond(true, { activeTemplateId: store.activeTemplateId });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ---------------------------------------------------------------------------
  // EXECUTIONS
  // ---------------------------------------------------------------------------
  "executions.list": async ({ params, respond }) => {
    if (!validateExecutionsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid executions.list params: ${formatValidationErrors(validateExecutionsListParams.errors)}`,
        ),
      );
      return;
    }
    const { templateId } = params as { templateId?: string };
    try {
      const store = await loadProjectsStore(storePath);
      let executions = store.executions;
      if (templateId) {
        executions = executions.filter((e) => e.linkedTemplateId === templateId);
      }
      respond(true, { executions });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "executions.get": async ({ params, respond }) => {
    if (!validateExecutionsGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid executions.get params: ${formatValidationErrors(validateExecutionsGetParams.errors)}`,
        ),
      );
      return;
    }
    const { id } = params as { id: string };
    try {
      const store = await loadProjectsStore(storePath);
      const execution = store.executions.find((e) => e.id === id);
      if (!execution) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `execution not found: ${id}`),
        );
        return;
      }
      respond(true, execution);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "executions.run": async ({ params, respond }) => {
    if (!validateExecutionsRunParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid executions.run params: ${formatValidationErrors(validateExecutionsRunParams.errors)}`,
        ),
      );
      return;
    }
    const { templateId } = params as { templateId: string };
    try {
      const store = await loadProjectsStore(storePath);
      const template = store.templates.find((t) => t.id === templateId);
      if (!template) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `template not found: ${templateId}`),
        );
        return;
      }

      const now = Date.now();
      const execution: ProjectExecute = {
        id: crypto.randomUUID(),
        linkedTemplateId: template.id,
        name: template.name,
        description: template.description,
        targetUrl: template.targetUrl,
        aiPrompt: template.aiPrompt,
        status: "pending",
        progressPercentage: 0,
        startTime: now,
        durationMs: null,
        results: [],
      };

      store.executions.push(execution);
      await saveProjectsStore(storePath, store);

      // Async kickoff to executor engine
      const { runProjectExecution } = await import("../../projects/executor.js");
      runProjectExecution(execution.id).catch(() => {});

      respond(true, execution);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "executions.cancel": async ({ params, respond }) => {
    if (!validateExecutionsCancelParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid executions.cancel params: ${formatValidationErrors(validateExecutionsCancelParams.errors)}`,
        ),
      );
      return;
    }
    const { id } = params as { id: string };
    try {
      const store = await loadProjectsStore(storePath);
      const execution = store.executions.find((e) => e.id === id);
      if (!execution) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `execution not found: ${id}`),
        );
        return;
      }
      if (execution.status === "pending" || execution.status === "running") {
        execution.status = "cancelled";
        execution.durationMs = execution.startTime ? Date.now() - execution.startTime : null;
        await saveProjectsStore(storePath, store);

        // Signal cancellation to executor engine
        const { cancelProjectExecution } = await import("../../projects/executor.js");
        await cancelProjectExecution(execution.id);
      }
      respond(true, execution);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
