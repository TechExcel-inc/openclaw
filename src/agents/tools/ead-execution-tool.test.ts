import { describe, expect, it } from "vitest";
import type { ProgressLogEntry } from "../../projects/types.js";
import { countScreenshotsInProgressLog } from "./ead-execution-tool.js";

describe("countScreenshotsInProgressLog", () => {
  it("returns 0 for empty or undefined", () => {
    expect(countScreenshotsInProgressLog(undefined)).toBe(0);
    expect(countScreenshotsInProgressLog([])).toBe(0);
  });

  it("counts tool_result entries with imageUrl or thumbnailUrl", () => {
    const log: ProgressLogEntry[] = [
      { ts: 1, kind: "tool_use", text: "x", toolName: "browser" },
      {
        ts: 2,
        kind: "tool_result",
        text: "Captured browser screenshot.",
        imageUrl: "https://cdn.example/a.png",
      },
      {
        ts: 3,
        kind: "tool_result",
        text: "Captured browser screenshot.",
        thumbnailUrl: "https://cdn.example/b.png",
      },
      { ts: 4, kind: "assistant", text: "ok" },
    ];
    expect(countScreenshotsInProgressLog(log)).toBe(2);
  });

  it("does not count tool_result without image fields", () => {
    const log: ProgressLogEntry[] = [{ ts: 1, kind: "tool_result", text: "ok" }];
    expect(countScreenshotsInProgressLog(log)).toBe(0);
  });
});
