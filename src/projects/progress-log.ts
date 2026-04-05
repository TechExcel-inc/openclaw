import type { ProgressLogEntry } from "./types.js";

/** Counts progress-log entries that carry a stored browser screenshot URL. */
export function countScreenshotsInProgressLog(log: ProgressLogEntry[] | undefined): number {
  if (!log?.length) {
    return 0;
  }
  let n = 0;
  for (const e of log) {
    if (e.kind !== "tool_result") {
      continue;
    }
    const url = e.imageUrl?.trim() ?? e.thumbnailUrl?.trim();
    if (url) {
      n += 1;
    }
  }
  return n;
}
