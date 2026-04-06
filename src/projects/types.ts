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
  timeBudgetMinutes?: number;
  costBudgetDollars?: number;
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

export type ExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "error";

export type StepStatus =
  | "pending" // Step not yet started
  | "running" // Step currently executing
  | "completed" // Step finished successfully
  | "failed" // Step failed (assertion error, exception)
  | "skipped"; // Step skipped (conditional logic)

export type StepArtifact = {
  type: "screenshot" | "console_log" | "network_log" | "dom_snapshot";
  path: string; // Local path or URL to artifact
  thumbnailPath?: string; // 200x150 thumbnail for UI
  capturedAt: string; // ISO timestamp
  description?: string; // AI-generated description
};

export type StepResult = {
  stepId: string; // "step-1", "step-2", etc.
  title: string; // Human-readable step title
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  artifacts: StepArtifact[];
  summary?: string; // AI-generated summary of what happened
  error?: {
    message: string;
    type: string;
    stack?: string;
  };
};

export type ProgressLogEntry = {
  ts: number;
  kind: "tool_use" | "tool_result" | "assistant" | "system";
  text: string;
  thumbnailUrl?: string; // S3 URL snippet
  imageUrl?: string; // S3 full image URL
  toolName?: string;
  toolInput?: Record<string, unknown>;
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
  timeBudgetMinutes?: number;
  costBudgetDollars?: number;
  /**
   * When true, the Project Run browser uses a visible local window (headed). When false or
   * omitted, defaults to headless background automation.
   */
  showLocalBrowser?: boolean;
  /** Run-scoped OpenClaw session key that owns the chat/browser work for this execution. */
  runSessionKey?: string;
  /** Gateway chat run id for the primary OpenClaw turn that powers this execution. */
  agentRunId?: string;
  status: ExecutionStatus;

  // NEW: Step-level tracking
  steps: StepResult[]; // Ordered list of all steps
  currentStepId?: string; // Currently active step

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
  /**
   * When the operator stops the run via the control UI: `finish` → status `completed`,
   * `cancel` → status `cancelled`. Omitted for natural completion or superseded runs.
   */
  operatorStopKind?: "finish" | "cancel";
  results: EadFmNodeRun[];
  /** Accumulated progress log entries extracted from the run transcript. */
  progressLog?: ProgressLogEntry[];
  /** Number of transcript messages already processed for the progress log. */
  progressLogSeq?: number;
  /** Timestamp of the first time the run entered a failed state (for recovery timeout). */
  firstFailedAt?: number;
};

export type ProjectsStoreFile = {
  version: 3;
  templates: ProjectTemplate[];
  executions: ProjectExecute[];
  activeTemplateId: string | null;
};
