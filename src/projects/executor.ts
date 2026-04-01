import { loadProjectsStore, saveProjectsStore, resolveProjectsStorePath } from "./store.js";

const executionControllers = new Map<string, AbortController>();

/**
 * Runs the EAD_AutoTest execution sequence asynchronously.
 * Phase 3 will inject headless-browser logic and step validation here.
 */
export async function runProjectExecution(executionId: string): Promise<void> {
  const storePath = resolveProjectsStorePath();
  const store = await loadProjectsStore(storePath);
  const execution = store.executions.find((e) => e.id === executionId);

  if (!execution) {
    throw new Error(`Execution ${executionId} not found`);
  }

  const template = store.templates.find((t) => t.id === execution.linkedTemplateId);
  if (!template) {
    execution.status = "error";
    await saveProjectsStore(storePath, store);
    throw new Error(`Template not found for execution`);
  }

  const abortController = new AbortController();
  executionControllers.set(executionId, abortController);

  let browser;
  try {
    execution.status = "running";
    execution.progressPercentage = 10;
    await saveProjectsStore(storePath, store);

    // Launch Playwright via chromium (headless is default in Playwright, but explicit here)
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ headless: true });

    if (abortController.signal.aborted) {
      return;
    }

    execution.progressPercentage = 30;
    await saveProjectsStore(storePath, store);

    const page = await browser.newPage();

    if (abortController.signal.aborted) {
      return;
    }

    try {
      let target = template.targetUrl || "https://example.com";
      if (!target.startsWith("http://") && !target.startsWith("https://")) {
        target = "https://" + target;
      }
      await page.goto(target, { waitUntil: "networkidle", timeout: 15000 });
      execution.progressPercentage = 70;
      await saveProjectsStore(storePath, store);

      // Simulate taking screenshots for Test Cases / Steps
      // In a real EAD_AutoTest phase 5 we'll tie screenshots into Test_Case_Step_Run
      const screenshotBuffer = await page.screenshot({ fullPage: true });
      const base64Screenshot = "data:image/png;base64," + screenshotBuffer.toString("base64");

      execution.results = [
        {
          nodeId: "mock-n-1",
          nodeKey: "home",
          type: "page",
          title: "Homepage",
          status: "Success",
          testCaseRuns: [
            {
              caseId: "tc-1",
              title: "Smoke Test Navigation",
              status: "Success",
              testCaseStepRuns: [
                {
                  stepId: "step-1",
                  sortOrder: 1,
                  procedureText: `Navigate to ${target}`,
                  expectedResult: "Page loads without errors",
                  actualResult: "Loaded successfully",
                  mustPass: true,
                  status: "Success",
                  screenshotUrl: base64Screenshot,
                  executionTimeMs: 1500,
                },
              ],
            },
          ],
        },
      ];

      execution.progressPercentage = 90;
      await saveProjectsStore(storePath, store);
    } catch (pageErr) {
      console.error("Page navigation failed in auto-test execution:", pageErr);
      throw pageErr; // will be caught by outer catch
    }

    if (abortController.signal.aborted) {
      return;
    }

    execution.progressPercentage = 100;
    execution.status = "completed";
    execution.durationMs = Date.now() - (execution.startTime ?? Date.now());

    await saveProjectsStore(storePath, store);
  } catch (err) {
    console.error("Project executor encountered a fatal error:", err);
    execution.status = "error";
    execution.progressPercentage = 0;
    execution.durationMs = Date.now() - (execution.startTime || Date.now());
    await saveProjectsStore(storePath, store);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    executionControllers.delete(executionId);
  }
}

/**
 * Cancels a running EAD_AutoTest execution payload.
 */
export async function cancelProjectExecution(executionId: string): Promise<void> {
  const controller = executionControllers.get(executionId);
  if (controller) {
    controller.abort();
    executionControllers.delete(executionId);
  }
}
