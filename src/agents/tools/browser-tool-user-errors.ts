/**
 * Map low-level Playwright / browser-control errors into short, actionable text for the model.
 * Appends raw details so operators can still grep logs.
 */
export function formatBrowserToolUserMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (raw.includes("interrupted by another navigation")) {
    return [
      "Browser: navigation was superseded (miss). Another open/navigate started before the previous URL finished loading.",
      "Wait for the current page to settle, then navigate again. Avoid issuing multiple navigations to different URLs at the same time.",
      `Details: ${raw}`,
    ].join("\n");
  }

  if (lower.includes("frame has been detached") || lower.includes("target closed")) {
    return [
      "Browser: tab or page was replaced while an action was in progress (miss).",
      "Retry the action after the page stabilizes, or re-open the tab if needed.",
      `Details: ${raw}`,
    ].join("\n");
  }

  if (lower.includes("timeout") && (lower.includes("navigation") || lower.includes("goto"))) {
    return [
      "Browser: navigation timed out (miss). The site may be slow, blocking automation, or waiting on a long redirect.",
      `Details: ${raw}`,
    ].join("\n");
  }

  if (lower.includes("net::err") || lower.includes("navigation failed")) {
    return [`Browser: page failed to load (miss).`, `Details: ${raw}`].join("\n");
  }

  return raw;
}
