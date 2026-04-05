import { describe, expect, it } from "vitest";
import { formatBrowserToolUserMessage } from "./browser-tool-user-errors.js";

describe("formatBrowserToolUserMessage", () => {
  it("explains overlapping navigation races", () => {
    const msg = formatBrowserToolUserMessage(
      new Error(
        'page.goto: Navigation to "https://a.com" is interrupted by another navigation to "https://b.com"',
      ),
    );
    expect(msg).toContain("superseded");
    expect(msg).toContain("miss");
    expect(msg).toContain("interrupted by another navigation");
  });

  it("passes through unknown errors", () => {
    expect(formatBrowserToolUserMessage(new Error("custom failure"))).toBe("custom failure");
  });
});
