import { Type } from "@sinclair/typebox";
import { countScreenshotsInProgressLog } from "../../projects/progress-log.js";
import { loadProjectsStore, resolveProjectsStorePath } from "../../projects/store.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";

export { countScreenshotsInProgressLog } from "../../projects/progress-log.js";

const PARAM_SCHEMA = Type.Object({
  executionId: Type.String({ description: "The ID of the execution to read." }),
});

const REPORT_STEP_SCHEMA = Type.Object({
  title: Type.String({
    description: "Short label for this Task or milestone (visible in the step log).",
  }),
  description: Type.String({
    description:
      "One short paragraph: what you verified or learned — write this promptly after the work, not deferred to the end of the run. Include a line with screenshots recorded in the run so far (use read_ead_execution → screenshotsRecorded if needed).",
  }),
  /** One image URL for this step (http(s), data URL, or path the UI can load). */
  thumbnailUrl: Type.Optional(Type.String()),
  /** Up to 3 screenshot URLs for this milestone — pick the most relevant; attach soon after browser captures so the UI stays current. */
  thumbnailUrls: Type.Optional(Type.Array(Type.String(), { maxItems: 3 })),
});

/** Lets the Project Run executor show rows in the dashboard Step Log (parsed from the transcript). */
export function createReportRunningStepTool(): AnyAgentTool {
  return {
    label: "Report exploration step",
    name: "report_running_step",
    description:
      "Record a milestone for the Project Run dashboard (Running Step Log) and chat thumbnails. Call promptly after each Task or significant milestone — not only when the run ends — so the operator sees progress in real time. Pass thumbnailUrl or thumbnailUrls (up to 3) with the best screenshot URLs from recent browser tool results for this step; otherwise a recent screenshot may be attached automatically. Put the current screenshotsRecorded count (from read_ead_execution) in the description when you summarize the step.",
    parameters: REPORT_STEP_SCHEMA,
    async execute(_toolCallId, params) {
      const p = params as { title?: string; description?: string };
      if (!p.title?.trim() || !p.description?.trim()) {
        return jsonResult({ error: "title and description are required" });
      }
      return jsonResult({ ok: true });
    },
  };
}

export function createEadExecutionTool(): AnyAgentTool {
  return {
    label: "EAD Execution Reader",
    name: "read_ead_execution",
    description:
      "Read summarized Project Run execution data (status, results, screenshotsRecorded). Use screenshotsRecorded to tell the operator how many browser screenshots have been captured in the dashboard progress log so far (updates as the transcript is processed). May be sparse at the start of a run.",
    parameters: PARAM_SCHEMA,
    async execute(_toolCallId, params) {
      const executionId =
        typeof params === "object" && params !== null && "executionId" in params
          ? String((params as { executionId: unknown }).executionId)
          : "";
      if (!executionId) {
        return jsonResult({ error: "executionId required" });
      }
      try {
        const storePath = resolveProjectsStorePath();
        const store = await loadProjectsStore(storePath);
        const execution = store.executions.find((e) => e.id === executionId);

        if (!execution) {
          return jsonResult({ error: `Execution with ID ${executionId} not found.` });
        }

        // Return a summarized structure to save token context
        const summarizedResults = (execution.results || []).map((node) => ({
          nodeName: node.title,
          testCases: (node.testCaseRuns || []).map((tc) => ({
            title: tc.title,
            status: tc.status,
            stepCount: tc.testCaseStepRuns?.length || 0,
            procedures: (tc.testCaseStepRuns || []).map((step) => step.procedureText),
          })),
        }));

        return jsonResult({
          id: execution.id,
          linkedTemplateId: execution.linkedTemplateId,
          status: execution.status,
          startTime: execution.startTime,
          durationMs: execution.durationMs,
          screenshotsRecorded: countScreenshotsInProgressLog(execution.progressLog),
          resultsSummary: summarizedResults,
        });
      } catch (err) {
        return jsonResult({ error: String(err) });
      }
    },
  };
}
