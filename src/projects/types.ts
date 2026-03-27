export type ProjectType = "auto-testing" | "ai-coding" | "customer-support" | "general";

export type ProjectDocumentType = "feature-map" | "test-case" | "documentation" | "general";

export type ProjectDocument = {
  id: string;
  projectId: string;
  name: string;
  type: ProjectDocumentType;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type AnalysisStatus = "idle" | "fetching" | "analyzing" | "complete" | "error";

export type ProjectAnalysisState = {
  lastAnalyzedAt: number | null;
  status: AnalysisStatus;
  error?: string;
};

export type Project = {
  id: string;
  name: string;
  type: ProjectType;
  boundUrl: string;
  createdAt: number;
  updatedAt: number;
  documents: ProjectDocument[];
  analysisState?: ProjectAnalysisState;
};

export type ProjectsStoreFile = {
  version: 1;
  projects: Project[];
  activeProjectId: string | null;
};
