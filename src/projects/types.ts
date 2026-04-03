export type ProjectType = "ead-auto-test";
export type ProjectAuthMode = "none" | "reuse-session" | "manual-bootstrap";

// Blueprint / Definition
export type TestStep = {
  stepId: string;
  sortOrder: number;
  procedureText: string;
  expectedResult: string;
  mustPass: boolean;
};

export type TestCase = {
  caseId: string;
  title: string;
  testSteps: TestStep[];
};

export type EadFmNode = {
  nodeId: string;
  nodeKey: string;
  type: string;
  title: string;
  meta: string;
  testCases: TestCase[];
};

export type ProjectTemplate = {
  id: string;
  name: string;
  description: string;
  targetUrl?: string;
  aiPrompt: string;
  authMode?: ProjectAuthMode;
  authLoginUrl?: string;
  authSessionProfile?: string;
  authInstructions?: string;
  totalTestSteps: number;
  failedTestSteps: number;
  pfmNodes: EadFmNode[];
  createdAt: number;
  createdBy: string;
  lastModifiedAt: number;
  lastModifiedBy: string;
};

// Execution / Run
export type TestCaseStepRunStatus = "Success" | "Failed" | "No Run";

export type TestCaseStepRun = {
  stepId: string; // references TestStep
  sortOrder: number;
  procedureText: string;
  expectedResult: string;
  mustPass: boolean;
  status: TestCaseStepRunStatus;
  actualResult?: string;
  screenshotUrl?: string;
  executionTimeMs?: number;
};

export type TestCaseRun = {
  caseId: string; // references TestCase
  title: string;
  status: TestCaseStepRunStatus;
  testCaseStepRuns: TestCaseStepRun[];
};

export type EadFmNodeRun = {
  nodeId: string; // references EadFmNode
  nodeKey: string;
  type: string;
  title: string;
  status: TestCaseStepRunStatus;
  testCaseRuns: TestCaseRun[];
};

export type ExecutionStatus = "pending" | "running" | "completed" | "cancelled" | "error";

export type ProgressLogEntry = {
  ts: number;
  kind: "tool_use" | "tool_result" | "assistant" | "system";
  text: string;
};

export type ProjectExecute = {
  id: string;
  linkedTemplateId: string;
  name: string;
  description: string;
  targetUrl?: string;
  aiPrompt: string; // the prompt used for this run
  authMode?: ProjectAuthMode;
  authLoginUrl?: string;
  authSessionProfile?: string;
  authInstructions?: string;
  /** Run-scoped OpenClaw session key that owns the chat/browser work for this execution. */
  runSessionKey?: string;
  /** Gateway chat run id for the primary OpenClaw turn that powers this execution. */
  agentRunId?: string;
  status: ExecutionStatus;
  /** When true, the executor should wait between steps until resumed (operator-controlled). */
  paused?: boolean;
  progressPercentage: number;
  startTime: number | null;
  durationMs: number | null;
  /** Optional UI hint when the gateway reports token usage for a run. */
  logTokens?: number;
  /** Short message for the dashboard (e.g. chat-first briefing, capture phase). */
  executorHint?: string;
  /** Set when the executor fails so the UI can show why the run stopped. */
  lastErrorMessage?: string;
  /** Optional note from the operator when stopping the run. */
  cancelReason?: string;
  results: EadFmNodeRun[];
  /** Accumulated progress log entries extracted from the run transcript. */
  progressLog?: ProgressLogEntry[];
};

export type ProjectsStoreFile = {
  version: 2;
  templates: ProjectTemplate[];
  executions: ProjectExecute[];
  activeTemplateId: string | null;
};
