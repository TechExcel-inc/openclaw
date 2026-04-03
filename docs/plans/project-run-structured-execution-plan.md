# Project Run: Structured Execution & Preview Mode Plan

## Executive Summary

This plan transforms Project Runs from transcript-driven summaries into a structured, step-aware execution model with per-step status tracking, visual artifacts (screenshots), and a new "Preview" mode for live browser observation.

---

## Phase 1: Data Model Evolution

### Objective

Extend the execution record schema to support step-level tracking without breaking existing runs.

### Changes

#### 1.1 New Types (src/projects/types.ts)

```typescript
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
```

#### 1.2 Extended Execution Record

```typescript
export type ProjectExecution = {
  id: string;
  templateId: string;
  status: ExecutionStatus;

  // NEW: Step-level tracking
  steps: StepResult[]; // Ordered list of all steps
  currentStepId?: string; // Currently active step

  // Existing fields preserved
  sessionKey: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  authMode: ProjectAuthMode;
};
```

### Deliverables

- [ ] Type definitions committed
- [ ] Migration logic for legacy executions (empty steps array)
- [ ] Storage version bump (v2 -> v3)

---

## Phase 2: Step Detection & Tracking

### Objective

Teach the executor to recognize step boundaries and track them throughout execution.

### Approach

Steps are derived from:

1. **Explicit boundaries**: `// @step: "Login with admin credentials"` comments in the Project Template
2. **Implicit boundaries**: Each top-level tool call (browser, assert, etc.)
3. **AI boundaries**: LLM signals step completion/resumption

### Changes

#### 2.1 Step Parser (src/projects/step-parser.ts)

```typescript
export function parseStepsFromTemplate(
  template: ProjectTemplate,
): Array<{ id: string; title: string; type: string }> {
  // Parse @step annotations from template.prompt
  // Fallback to tool-call boundaries if no annotations
}
```

#### 2.2 Step Tracking in Executor (src/projects/executor.ts)

- Before each tool call: Create/update step record
- After each tool call: Update step with artifacts and summary
- On error: Mark step failed, capture error state

### Deliverables

- [ ] Step parser with annotation support
- [ ] Executor integration for step tracking
- [ ] Artifact collection hooks (screenshot, console, network)

---

## Phase 3: Artifact Pipeline (Screenshots)

### Objective

Capture visual evidence at key moments during execution.

### Trigger Points

1. **On step start**: Baseline screenshot
2. **On step complete**: Final state screenshot
3. **On assertion failure**: Failure screenshot (automatic)
4. **On explicit request**: `browser.screenshot()` in template

### Changes

#### 3.1 Screenshot Service (src/projects/artifact-service.ts)

```typescript
export async function captureStepArtifact(
  tabId: string,
  stepId: string,
  type: "screenshot" | "fullpage",
): Promise<StepArtifact> {
  // Use existing browser.snapshot capability
  // Generate thumbnail (200x150 WebP)
  // Save to ~/.openclaw/project-artifacts/{executionId}/{stepId}/
}
```

#### 3.2 Thumbnail Generation

- Use sharp or similar for WebP thumbnail generation
- Store alongside full-resolution images
- Lazy-load full images in UI

### Deliverables

- [ ] Artifact service with screenshot capture
- [ ] Thumbnail generation pipeline
- [ ] Storage cleanup (auto-delete artifacts >30 days)

---

## Phase 4: Status API Enhancement

### Objective

Provide real-time step status through existing gateway APIs.

### Changes

#### 4.1 Enhanced Status Endpoint

`GET /api/projects/executions/{id}/status` returns:

```json
{
  "executionId": "exec-123",
  "overallStatus": "running",
  "currentStepId": "step-3",
  "progress": {
    "totalSteps": 5,
    "completedSteps": 2,
    "failedSteps": 0
  },
  "steps": [
    {
      "id": "step-1",
      "title": "Navigate to login page",
      "status": "completed",
      "durationMs": 2500,
      "thumbnailUrl": "/api/artifacts/exec-123/step-1/thumbnail.webp"
    },
    {
      "id": "step-2",
      "title": "Enter credentials",
      "status": "completed",
      "durationMs": 1800,
      "thumbnailUrl": "/api/artifacts/exec-123/step-2/thumbnail.webp"
    },
    {
      "id": "step-3",
      "title": "Click login button",
      "status": "running",
      "startedAt": "2026-04-03T10:15:00Z"
    }
  ]
}
```

#### 4.2 WebSocket Events

New event types for real-time UI updates:

- `step:start` - Step began execution
- `step:complete` - Step finished successfully
- `step:fail` - Step failed with error
- `artifact:capture` - New artifact available (screenshot, etc.)

### Deliverables

- [ ] Enhanced status endpoint
- [ ] WebSocket event broadcasting
- [ ] Backward compatibility for old execution records

---

## Phase 5: UI - Structured Run Panel

### Objective

Replace the current Project Run (Summary) box with a step-aware timeline.

### Design

```
┌─ Project Run: Login Flow Test ─────────────┐
│ ▶ Running (Step 3 of 5)                   │
│                                            │
│ ┌─ Step 1: Navigate to login ──────┐ [✓] │
│ │ [thumbnail] Completed in 2.5s      │     │
│ │ Navigated to /login successfully   │     │
│ └────────────────────────────────────┘     │
│                                            │
│ ┌─ Step 2: Enter credentials ────────┐ [✓] │
│ │ [thumbnail] Completed in 1.8s      │     │
│ │ Filled username and password fields│     │
│ └────────────────────────────────────┘     │
│                                            │
│ ┌─ Step 3: Click login button ─────┐ [▶] │
│ │ [spinner] Running for 3.2s...      │     │
│ └────────────────────────────────────┘     │
│                                            │
│ ┌─ Step 4: Verify dashboard ───────┐ [○] │
│ │ Pending...                         │     │
│ └────────────────────────────────────┘     │
│                                            │
│ [Stop Run]                    [View Logs]  │
└────────────────────────────────────────────┘
```

### Changes

#### 5.1 Step Timeline Component (ui/src/ui/components/step-timeline.ts)

- Vertical timeline with step cards
- Thumbnail gallery per step (click to enlarge)
- Status indicators (icons + colors)
- Expandable for step details

#### 5.2 Live Indicator

- "Running" pulse animation on active step
- Overall progress bar (5 of 8 steps complete)
- Elapsed time counter

### Deliverables

- [ ] Step timeline Lit component
- [ ] Thumbnail viewer with lightbox
- [ ] Progress indicators and animations

---

## Phase 6: Resume vs New Run Distinction

### Objective

Make it crystal clear when you're resuming vs starting fresh.

### UX Changes

#### 6.1 Run Toolbar States

**No Active Run:**

```
[Start New Run ▶]  [Load Template ▼]
```

**Run Active (can resume):**

```
[Resume ▶]  [Start Fresh ▶▶]  [Stop ■]
            ↑ new button
```

**Run Completed:**

```
[View Report 📊]  [Run Again ▶]  [Export Results ⬇]
```

#### 6.2 Session State Enforcement

**Current Problem:** Chat can implicitly start new runs
**Solution:** Enforce explicit boundaries

```typescript
// In chat controller
async function handleChatMessage(message: string) {
  const activeExecution = getActiveExecution();

  if (activeExecution?.status === "running") {
    // Attach to current run
    return continueExistingRun(activeExecution.id, message);
  }

  if (activeExecution?.status === "completed") {
    // Require explicit action to start new run
    showToast("Previous run completed. Start a new run to continue testing.");
    return;
  }

  // No active run - start new one
  return startNewRun(message);
}
```

### Deliverables

- [ ] Toolbar state machine (idle, running, paused, completed)
- [ ] "Start Fresh" button (always creates new execution record)
- [ ] "Resume" button (only appears for paused/interrupted runs)
- [ ] Chat integration with run state validation

---

## Phase 7: Preview Mode (Live Browser View)

### Objective

Create a new view where the browser takes center stage and chat floats as an overlay.

### Design

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│    ┌─────────────────────────────────────────────────┐      │
│    │                                                 │      │
│    │          LIVE BROWSER VIEWPORT                  │      │
│    │                                                 │      │
│    │    (Real-time CDP stream or screenshot         │      │
│    │     updates every 500ms when active)            │      │
│    │                                                 │      │
│    └─────────────────────────────────────────────────┘      │
│                                                             │
│  ╭─────────────────────╮                                   │
│  │  💬 Chat Overlay    │ ← Draggable, resizable          │
│  │  ───────────────    │                                   │
│  │  User: Check the... │                                   │
│  │  Bot: I can see...  │                                   │
│  │                     │                                   │
│  │  [Type message...]  │                                   │
│  ╰─────────────────────╯                                   │
│                                                             │
│  ┌─ Lightweight Controls ─────────────┐                   │
│  │ [⏸ Pause] [■ Stop] [📸 Screenshot] │  ← Minimal bar    │
│  │ Status: Running Step 3 of 5        │                   │
│  └────────────────────────────────────┘                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Changes

#### 7.1 Preview Mode Route (ui/src/ui/pages/preview-mode.ts)

- Full-screen browser viewport (CSS Grid: 1fr)
- Floating chat panel (position: absolute, draggable)
- Minimal control bar at bottom

#### 7.2 Browser Stream Integration

- Use existing CDP screenshot capability
- 500ms polling when in preview mode
- Pause stream when minimized/hidden

#### 7.3 Chat Overlay Component

- Draggable header (click+drag to reposition)
- Resizable (corner handle)
- Minimize to bubble button
- Same chat controller as main view

#### 7.4 Lightweight Controls

```typescript
type LightweightControls = {
  // Essential actions only
  pauseResume: () => void; // Toggle execution
  stop: () => void; // Halt and finalize
  screenshot: () => void; // Force screenshot capture

  // Status display
  currentStep: string;
  stepNumber: number;
  totalSteps: number;
  isRunning: boolean;
};
```

### Deliverables

- [ ] Preview mode page/route
- [ ] Draggable/resizable chat overlay
- [ ] Browser viewport with live updates
- [ ] Lightweight control bar component
- [ ] Toggle between "Management" and "Preview" views

---

## Phase 8: Gateway - Run State Machine

### Objective

Enforce strict execution lifecycle on the server side.

### State Diagram

```
                    ┌─────────────┐
                    │   idle      │
                    └──────┬──────┘
                           │ start
                           ▼
                    ┌─────────────┐
         ┌──────────│   running   │◄────────┐
         │          └──────┬──────┘         │
         │                 │                │
      pause              stop             resume
         │                 │                │
         ▼                 ▼                │
    ┌─────────┐      ┌─────────────┐         │
    │ paused  │      │  completed  │         │
    └────┬────┘      └─────────────┘         │
         │                                   │
         └───────────────────────────────────┘
                    resume
```

### Changes

#### 8.1 State Enforcement (src/gateway/server-methods/projects.ts)

```typescript
export async function resumeProjectRun(
  deps: GatewayDeps,
  executionId: string,
): Promise<ResumeResult> {
  const execution = await loadExecution(deps, executionId);

  // State validation
  if (execution.status === "running") {
    return { alreadyRunning: true };
  }

  if (execution.status === "completed") {
    throw new Error("Cannot resume completed run. Start a new run instead.");
  }

  // Resume logic...
}

export async function startNewRun(deps: GatewayDeps, templateId: string): Promise<StartResult> {
  // Always create new execution record
  // Never auto-resume existing completed runs
}
```

### Deliverables

- [ ] Strict state machine enforcement
- [ ] Clear error messages for invalid state transitions
- [ ] API endpoints: `POST /executions/{id}/resume`, `POST /executions/{id}/restart`

---

## Phase 9: Testing & Validation

### Objective

Ensure the new system works reliably and doesn't break existing functionality.

### Test Coverage

| Component        | Test Type          | Coverage                          |
| ---------------- | ------------------ | --------------------------------- |
| Step parser      | Unit               | 100% branch coverage              |
| Artifact service | Unit + Integration | Screenshot capture, thumbnail gen |
| State machine    | Unit               | All transitions                   |
| UI components    | Component          | Step timeline, preview mode       |
| E2E flow         | E2E                | Full project run with steps       |

### Validation Scenarios

1. **Legacy execution**: Old run without steps displays correctly (back-compat)
2. **New execution**: Steps appear and update in real-time
3. **Resume flow**: Paused run resumes from correct step
4. **New run flow**: Explicit new run creates fresh execution record
5. **Preview mode**: Browser viewport updates, chat overlay functional
6. **Error handling**: Failed step captures screenshot and error details

### Deliverables

- [ ] Unit tests for all new modules
- [ ] E2E test: complete project run with step validation
- [ ] Backward compatibility test

---

## Phase 10: Migration & Rollout

### Objective

Deploy without breaking existing runs.

### Migration Strategy

1. **Schema migration**: New executions use v3 schema, old remain v2
2. **UI compatibility**: Handle both schemas gracefully
3. **Feature flags**: Each phase behind `projects.stepTracking.enabled`, etc.

### Rollout Phases

1. **Phase 1-4** (Backend): Deploy to gateway, feature-flagged off
2. **Phase 5** (UI): Add step timeline alongside existing summary box
3. **Phase 6** (UX): Switch toolbar to new state machine
4. **Phase 7** (Preview): Add new view mode
5. **Cleanup**: Remove feature flags, deprecate old summary box

### Deliverables

- [ ] Feature flag configuration
- [ ] Migration script for artifact storage directories
- [ ] Rollback plan (revert to v2 schema support)

---

## Summary of Changes by File

### Backend (src/)

| File                                     | Change                                                            |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `src/projects/types.ts`                  | Add StepStatus, StepArtifact, StepResult, update ProjectExecution |
| `src/projects/step-parser.ts`            | New: Parse steps from template annotations                        |
| `src/projects/artifact-service.ts`       | New: Screenshot/thumbnail capture                                 |
| `src/projects/executor.ts`               | Integrate step tracking, artifact collection                      |
| `src/gateway/server-methods/projects.ts` | Add resume/restart endpoints, state machine                       |
| `src/browser/routes/screenshot.ts`       | Add thumbnail generation endpoint                                 |

### Frontend (ui/src/)

| File                                    | Change                                |
| --------------------------------------- | ------------------------------------- |
| `ui/src/ui/components/step-timeline.ts` | New: Step timeline component          |
| `ui/src/ui/components/chat-overlay.ts`  | New: Draggable chat for preview mode  |
| `ui/src/ui/pages/preview-mode.ts`       | New: Preview mode page                |
| `ui/src/ui/controllers/projects.ts`     | Update for step status, resume vs new |
| `ui/src/ui/app-render.ts`               | Add step timeline to main view        |
| `ui/src/ui/styles/projects.css`         | New styles for timeline, preview mode |

### API Contracts

| Endpoint                                          | Change                                          |
| ------------------------------------------------- | ----------------------------------------------- |
| `GET /executions/{id}`                            | Add `steps`, `currentStepId`, `progress`        |
| `POST /executions/{id}/resume`                    | New: Resume paused run                          |
| `POST /executions/{id}/restart`                   | New: Start fresh from template                  |
| `GET /artifacts/{execId}/{stepId}/thumbnail.webp` | New: Thumbnail serving                          |
| WebSocket                                         | New events: `step:start`, `step:complete`, etc. |

---

## Estimates

| Phase                 | Duration     | Risk                         |
| --------------------- | ------------ | ---------------------------- |
| 1. Data Model         | 1 day        | Low                          |
| 2. Step Detection     | 2 days       | Medium (parsing logic)       |
| 3. Artifact Pipeline  | 2 days       | Medium (image processing)    |
| 4. Status API         | 1 day        | Low                          |
| 5. UI - Step Timeline | 3 days       | Medium (Lit components)      |
| 6. Resume vs New      | 2 days       | Medium (state management)    |
| 7. Preview Mode       | 3 days       | High (new view architecture) |
| 8. State Machine      | 2 days       | Low                          |
| 9. Testing            | 3 days       | Medium                       |
| 10. Rollout           | 2 days       | Low                          |
| **Total**             | **~21 days** |                              |

---

## Approval Checklist

- [ ] Plan reviewed and approved
- [ ] Phase 1-2 approved for implementation
- [ ] UI mockups approved (separate Figma/design review)
- [ ] Priority phases identified if scope reduction needed

---

_Plan Version: 1.0_
_Date: 2026-04-03_
_Author: OpenClaw Assistant_
