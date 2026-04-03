import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const ProjectAuthModeSchema = Type.String({
  enum: ["none", "reuse-session", "manual-bootstrap"],
});

// Template Schemas
export const TemplatesListParamsSchema = Type.Object({}, { additionalProperties: false });

export const TemplatesGetParamsSchema = Type.Object(
  { id: NonEmptyString },
  { additionalProperties: false },
);

export const TemplatesCreateParamsSchema = Type.Object(
  {
    name: NonEmptyString,
    description: Type.Optional(Type.String()),
    targetUrl: Type.Optional(Type.String()),
    aiPrompt: Type.Optional(Type.String()),
    authMode: Type.Optional(ProjectAuthModeSchema),
    authLoginUrl: Type.Optional(Type.String()),
    authSessionProfile: Type.Optional(Type.String()),
    authInstructions: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const TemplatesUpdateParamsSchema = Type.Object(
  {
    id: NonEmptyString,
    name: Type.Optional(NonEmptyString),
    description: Type.Optional(Type.String()),
    targetUrl: Type.Optional(Type.String()),
    aiPrompt: Type.Optional(Type.String()),
    authMode: Type.Optional(ProjectAuthModeSchema),
    authLoginUrl: Type.Optional(Type.String()),
    authSessionProfile: Type.Optional(Type.String()),
    authInstructions: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const TemplatesDeleteParamsSchema = Type.Object(
  { id: NonEmptyString },
  { additionalProperties: false },
);

export const TemplatesSetActiveParamsSchema = Type.Object(
  { id: Type.Optional(NonEmptyString) },
  { additionalProperties: false },
);

// Executions Schemas
export const ExecutionsListParamsSchema = Type.Object(
  { templateId: Type.Optional(NonEmptyString) },
  { additionalProperties: false },
);

export const ExecutionsGetParamsSchema = Type.Object(
  { id: NonEmptyString },
  { additionalProperties: false },
);

export const ExecutionsRunParamsSchema = Type.Object(
  {
    templateId: NonEmptyString,
    targetUrl: Type.Optional(Type.String()),
    aiPrompt: Type.Optional(Type.String()),
    authMode: Type.Optional(ProjectAuthModeSchema),
    authLoginUrl: Type.Optional(Type.String()),
    authSessionProfile: Type.Optional(Type.String()),
    authInstructions: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ExecutionsCancelParamsSchema = Type.Object(
  {
    id: NonEmptyString,
    reason: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);

export const ExecutionsPauseParamsSchema = Type.Object(
  { id: NonEmptyString },
  { additionalProperties: false },
);

export const ExecutionsResumeParamsSchema = Type.Object(
  { id: NonEmptyString },
  { additionalProperties: false },
);

export const ProjectsAutoFormatPromptParamsSchema = Type.Object(
  { text: NonEmptyString },
  { additionalProperties: false },
);
