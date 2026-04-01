export type ProjectType = "ead-auto-test";

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

export type ProjectExecute = {
  id: string;
  linkedTemplateId: string;
  name: string;
  description: string;
  targetUrl?: string;
  aiPrompt: string; // the prompt used for this run
  status: ExecutionStatus;
  progressPercentage: number;
  startTime: number | null;
  durationMs: number | null;
  /** Optional UI hint when the gateway reports token usage for a run. */
  logTokens?: number;
  results: EadFmNodeRun[];
};

export type ProjectsStoreFile = {
  version: 2;
  templates: ProjectTemplate[];
  executions: ProjectExecute[];
  activeTemplateId: string | null;
};
