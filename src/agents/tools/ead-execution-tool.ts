import { Type } from "@sinclair/typebox";
import { loadProjectsStore, resolveProjectsStorePath } from "../../projects/store.js";
import type { AnyAgentTool } from "./common.js";

const PARAM_SCHEMA = Type.Object({
  executionId: Type.String({ description: "The ID of the execution to read." }),
});

export function createEadExecutionTool(): AnyAgentTool {
  return {
    label: "EAD Execution Reader",
    name: "read_ead_execution",
    description: "Retrieve the JSON data for a specific EAD Auto-Test execution, including its discovered EAD-FM nodes, generated test cases, and outcomes.",
    parameters: PARAM_SCHEMA,
    async execute({ executionId }: { executionId: string }) {
      try {
        const storePath = resolveProjectsStorePath();
        const store = await loadProjectsStore(storePath);
        const execution = store.executions.find((e) => e.id === executionId);

        if (!execution) {
          return { error: `Execution with ID ${executionId} not found.` };
        }

        // Return a summarized structure to save token context
        const summarizedResults = (execution.results || []).map((node) => ({
          nodeName: node.title,
          testCases: (node.testCaseRuns || []).map((tc) => ({
            title: tc.title,
            status: tc.status,
            stepCount: tc.testCaseStepRuns?.length || 0,
            procedures: (tc.testCaseStepRuns || []).map((step) => step.procedureText)
          }))
        }));

        return {
          id: execution.id,
          linkedTemplateId: execution.linkedTemplateId,
          status: execution.status,
          startTime: execution.startTime,
          durationMs: execution.durationMs,
          resultsSummary: summarizedResults,
        };
      } catch (err) {
        return { error: String(err) };
      }
    },
  };
}
