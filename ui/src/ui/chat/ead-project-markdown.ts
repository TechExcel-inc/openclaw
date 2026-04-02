import type { ProjectExecute, ProjectTemplate } from "../../../../src/projects/types.js";

function escapeMd(text: string): string {
  return text.replace(/\|/g, "\\|");
}

export function formatTemplateProjectMarkdown(t: ProjectTemplate): string {
  const lines: string[] = [
    `# ${escapeMd(t.name)}`,
    "",
    t.description.trim() || "_No description._",
    "",
  ];

  if (t.targetUrl?.trim()) {
    lines.push(`**Target:** ${escapeMd(t.targetUrl.trim())}`, "");
  }

  lines.push("## Summary", "");
  lines.push(
    `- **Total test steps:** ${t.totalTestSteps}`,
    `- **Failed steps (last run):** ${t.failedTestSteps}`,
    "",
  );

  if (t.pfmNodes?.length) {
    lines.push("## Test plan outline", "");
    for (const node of t.pfmNodes) {
      lines.push(`### ${escapeMd(node.title)}`, "");
      for (const tc of node.testCases ?? []) {
        lines.push(`- **${escapeMd(tc.title)}**`);
        for (const step of tc.testSteps ?? []) {
          lines.push(`  ${step.sortOrder}. ${escapeMd(step.procedureText)}`);
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n").trim();
}

export function formatExecutionProjectMarkdown(ex: ProjectExecute): string {
  const lines: string[] = [
    `# ${escapeMd(ex.name)}`,
    "",
    ex.description.trim() || "_No description._",
    "",
    "## Run status",
    "",
    `- **Status:** ${ex.status}`,
    `- **Progress:** ${ex.progressPercentage}%`,
    "",
  ];

  if (ex.targetUrl?.trim()) {
    lines.push(`**Target:** ${escapeMd(ex.targetUrl.trim())}`, "");
  }

  if (ex.results?.length) {
    lines.push("## Running steps", "");
    for (const node of ex.results) {
      lines.push(`### ${escapeMd(node.title)} (${node.status})`, "");
      for (const tc of node.testCaseRuns ?? []) {
        lines.push(`- **${escapeMd(tc.title)}** — ${tc.status}`);
        for (const step of tc.testCaseStepRuns ?? []) {
          const st = step.status;
          lines.push(`  - Step ${step.sortOrder}: ${escapeMd(step.procedureText)} → **${st}**`);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}
