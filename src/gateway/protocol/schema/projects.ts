import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const ProjectTypeSchema = Type.Union([
  Type.Literal("auto-testing"),
  Type.Literal("ai-coding"),
  Type.Literal("customer-support"),
  Type.Literal("general"),
]);

const ProjectDocumentTypeSchema = Type.Union([
  Type.Literal("feature-map"),
  Type.Literal("test-case"),
  Type.Literal("documentation"),
  Type.Literal("general"),
]);

const AnalysisStatusSchema = Type.Union([
  Type.Literal("idle"),
  Type.Literal("fetching"),
  Type.Literal("analyzing"),
  Type.Literal("complete"),
  Type.Literal("error"),
]);

export const ProjectDocumentSchema = Type.Object(
  {
    id: NonEmptyString,
    projectId: NonEmptyString,
    name: NonEmptyString,
    type: ProjectDocumentTypeSchema,
    content: Type.String(),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const ProjectAnalysisStateSchema = Type.Object(
  {
    lastAnalyzedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    status: AnalysisStatusSchema,
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ProjectSchema = Type.Object(
  {
    id: NonEmptyString,
    name: NonEmptyString,
    type: ProjectTypeSchema,
    boundUrl: Type.String(),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
    documents: Type.Array(ProjectDocumentSchema),
    analysisState: Type.Optional(ProjectAnalysisStateSchema),
  },
  { additionalProperties: false },
);

export const ProjectsListParamsSchema = Type.Object({}, { additionalProperties: false });

export const ProjectsGetParamsSchema = Type.Object(
  { id: NonEmptyString },
  { additionalProperties: false },
);

export const ProjectsCreateParamsSchema = Type.Object(
  {
    name: NonEmptyString,
    type: ProjectTypeSchema,
    boundUrl: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ProjectsUpdateParamsSchema = Type.Object(
  {
    id: NonEmptyString,
    name: Type.Optional(NonEmptyString),
    type: Type.Optional(ProjectTypeSchema),
    boundUrl: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ProjectsDeleteParamsSchema = Type.Object(
  { id: NonEmptyString },
  { additionalProperties: false },
);

export const ProjectsSetActiveParamsSchema = Type.Object(
  { id: Type.Optional(NonEmptyString) },
  { additionalProperties: false },
);

export const ProjectsDocumentsListParamsSchema = Type.Object(
  { projectId: NonEmptyString },
  { additionalProperties: false },
);

export const ProjectsDocumentsGetParamsSchema = Type.Object(
  { projectId: NonEmptyString, id: NonEmptyString },
  { additionalProperties: false },
);

export const ProjectsDocumentsCreateParamsSchema = Type.Object(
  {
    projectId: NonEmptyString,
    name: NonEmptyString,
    type: Type.Optional(ProjectDocumentTypeSchema),
    content: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ProjectsDocumentsUpdateParamsSchema = Type.Object(
  {
    projectId: NonEmptyString,
    id: NonEmptyString,
    name: Type.Optional(NonEmptyString),
    type: Type.Optional(ProjectDocumentTypeSchema),
    content: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ProjectsDocumentsDeleteParamsSchema = Type.Object(
  { projectId: NonEmptyString, id: NonEmptyString },
  { additionalProperties: false },
);

export const ProjectsAnalyzeParamsSchema = Type.Object(
  { projectId: NonEmptyString },
  { additionalProperties: false },
);

export const ProjectsAnalyzeStatusParamsSchema = Type.Object(
  { projectId: NonEmptyString },
  { additionalProperties: false },
);
