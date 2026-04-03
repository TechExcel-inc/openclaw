---
summary: "Plan for Project Run: Explore and Learn, run status UI, thumbnails, and phased delivery toward live streaming and testing."
read_when:
  - Planning EAD-Exp project execution, executor, or control UI run panel
  - Scoping MVP vs full vision for run steps, screenshots, and chat control
title: "EAD-Exp Project Run (Explore and Learn)"
---

# EAD-Exp Project Run: Explore and Learn

This document captures the **product plan** for recording runs during **AI Explore and Learn**, surfacing **Project Run Status** next to **Project Chat**, and evolving toward **AI testing**, **S3-backed media**, and **live streaming**.

## Goals

1. **Single active run per product** at a time (simple UX and executor state).
2. **Explore and Learn first** (before formal AI testing):
   - The **executor** explores the target (browser automation, many steps).
   - **Thumbnails** (and later full images) record what happened at each step.
   - After the run, **AI** ingests the run, researches the collected data, and produces **EAD-PFM-oriented outputs** plus **test cases** for future **testing and quality control**.
3. **Project Run Status** lives in a **right-hand panel** beside Project Chat; **chat stays active** so the user can steer the run and (later) supply credentials via chat.
4. **Tonight / near-term**: **thumbnails only**; **live streaming** of the session to the EAD-Exp frontend is a **later** milestone.

## Phasing (product)

| Phase | Focus                 | Notes                                                                                                                |
| ----- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **1** | **Explore and Learn** | Executor-driven exploration; step timeline; **one screenshot per step** (MVP); AI synthesis to EAD-PFM + test cases. |
| **2** | **AI testing**        | Execute stored test cases; assertions; regression.                                                                   |
| **3** | **Live streaming**    | Stream executor view to the frontend (complement thumbnails).                                                        |
| **4** | **Polish**            | Multi-thumbnail per step; pause; credentials-in-chat; **S3** for durable media at scale.                             |

## Architecture (concise)

- **Gateway + projects store**: persist `ProjectExecute` (or successor) with **step list**, **status**, **screenshot references** (URLs or ids, not necessarily inline base64 long-term).
- **Executor** (e.g. Playwright): emits **steps**; after each step (or on interval), capture **at least one** image; persist metadata (**No.**, **name**, **description** when available).
- **Control UI**: **Project Chat** center + **Run Status** right panel; **polling** for MVP; **push** (WebSocket) for full vision.
- **AI**: post-run (or streaming) analysis job that maps run results to **EAD-PFM** artifacts and **test case** drafts.
- **S3**: optional; use for production **thumbnail/full image** storage; credentials via **environment** or **config**, never committed.

## MVP vs full vision

| Area        | MVP                                         | Full vision                                           |
| ----------- | ------------------------------------------- | ----------------------------------------------------- |
| Steps       | Number, name, description (where available) | Rich metadata, retries, branching                     |
| Screenshots | **One per step**                            | **Multiple** per step; lightbox                       |
| UI          | **Right panel** + Run Status                | Same + responsive drawer, accessibility               |
| Updates     | **Polling**                                 | **Push** (WebSocket subscriptions)                    |
| Chat        | Active; basic commands (optional)           | **Pause / resume / cancel**; **credentials via chat** |
| Storage     | Local store + inline or small blobs         | **S3** (or equivalent) for images                     |
| Streaming   | Not in MVP                                  | **Live stream** to frontend                           |

## Effort (rough)

These assume **one developer** who already knows this stack (gateway, control UI, projects module).

- **MVP** (steps + **one screenshot per step** + **right panel** + **polling**): on the order of **several days** of focused development.
- **Full vision** (**multi-thumbnail**, **push** updates, **robust pause** and **credentials-in-chat**, **S3**): **multiple weeks**, depending on how polished the AI step text, UX, and security need to be.

## MVP delivery checklist (suggested)

1. **Schema**: extend execution / step types for stable step ids, order, labels, single screenshot ref, run phase (`explore` vs future `test`).
2. **Executor**: step loop; one screenshot per step; write to store; enforce **single active run** per product.
3. **API**: list/get execution; poll-friendly; optional cancel.
4. **UI**: Project Chat layout with **right rail** Run Status; step list + one thumb per step; click to enlarge (lightbox).
5. **AI hook (minimal)**: after run completes, trigger or document **analysis** path to EAD-PFM + test case drafts (can be stubbed first).
6. **Docs**: operator notes for env vars (S3, Playwright) when not using local-only storage.

## Full vision (later) checklist (suggested)

1. **Multi-thumbnail** per step + gallery UX.
2. **WebSocket** (or equivalent) for live step and image updates.
3. **Pause** at step boundaries; **credential** prompts surfaced in chat and applied to executor.
4. **S3** upload pipeline; **signed URLs**; retention policy.
5. **Live streaming** channel and player in the EAD-Exp frontend.
6. **Security**: secrets handling, audit logs, no password echo in transcripts.

## Risks and decisions

- **Credential in chat**: requires strict **state machine** (awaiting input) and **redaction** in logs; defer to full vision if needed.
- **Polling vs push**: MVP polling is simpler; push reduces latency and load for long runs.
- **S3**: optional for MVP; required for scale and many runs.

## Out of scope for MVP

- Live video streaming to the browser.
- Full AI-driven test execution loop.
- Multi-run concurrency per product.
