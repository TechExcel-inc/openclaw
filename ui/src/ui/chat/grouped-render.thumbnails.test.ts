import { describe, expect, it } from "vitest";
import {
  collectThumbnailUrlsForMessage,
  extractReportRunningStepThumbnailUrls,
} from "./grouped-render.ts";

describe("extractReportRunningStepThumbnailUrls", () => {
  it("returns up to three thumbnailUrls from toolcall", () => {
    const msg = {
      role: "assistant",
      toolCallId: "tc1",
      content: [
        {
          type: "toolcall",
          name: "report_running_step",
          arguments: {
            title: "Step",
            description: "Done",
            thumbnailUrls: ["https://a.example/1.png", "https://a.example/2.png"],
          },
        },
        { type: "toolresult", name: "report_running_step", text: "ok" },
      ],
      timestamp: Date.now(),
    };
    expect(extractReportRunningStepThumbnailUrls(msg)).toEqual([
      "https://a.example/1.png",
      "https://a.example/2.png",
    ]);
  });

  it("caps at three URLs", () => {
    const msg = {
      role: "assistant",
      content: [
        {
          type: "toolcall",
          name: "report_running_step",
          arguments: {
            thumbnailUrls: ["https://x/1", "https://x/2", "https://x/3", "https://x/4"],
          },
        },
      ],
      timestamp: Date.now(),
    };
    expect(extractReportRunningStepThumbnailUrls(msg)).toHaveLength(3);
  });

  it("uses thumbnailUrl when thumbnailUrls absent", () => {
    const msg = {
      role: "assistant",
      content: [
        {
          type: "toolcall",
          name: "report_running_step",
          arguments: { thumbnailUrl: "https://one.example/s.png" },
        },
      ],
      timestamp: Date.now(),
    };
    expect(extractReportRunningStepThumbnailUrls(msg)).toEqual(["https://one.example/s.png"]);
  });

  it("returns empty for browser tool", () => {
    const msg = {
      role: "assistant",
      content: [
        {
          type: "toolcall",
          name: "browser",
          arguments: { action: "open", url: "https://cnn.com" },
        },
      ],
      timestamp: Date.now(),
    };
    expect(extractReportRunningStepThumbnailUrls(msg)).toEqual([]);
  });
});

describe("collectThumbnailUrlsForMessage", () => {
  it("includes browser screenshot image blocks when report_running_step has no URLs", () => {
    const msg = {
      role: "tool",
      content: [
        {
          type: "image",
          source: { type: "base64", data: "iVBORw0KGgo=", media_type: "image/png" },
        },
      ],
      timestamp: Date.now(),
    };
    const urls = collectThumbnailUrlsForMessage(msg);
    expect(urls.length).toBe(1);
    expect(urls[0]).toMatch(/^data:image\/png;base64,/);
  });

  it("collectThumbnailUrlsForMessage reads browser tool image blocks (data + mimeType)", () => {
    const msg = {
      role: "tool",
      content: [
        { type: "text", text: "Captured." },
        { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
      ],
      timestamp: Date.now(),
    };
    const urls = collectThumbnailUrlsForMessage(msg);
    expect(urls.length).toBe(1);
    expect(urls[0]).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("merges report URLs with image blocks (deduped, capped)", () => {
    const msg = {
      role: "assistant",
      content: [
        {
          type: "toolcall",
          name: "report_running_step",
          arguments: { thumbnailUrl: "https://cdn.example/a.png" },
        },
        { type: "image_url", image_url: { url: "https://cdn.example/b.png" } },
      ],
      timestamp: Date.now(),
    };
    expect(collectThumbnailUrlsForMessage(msg)).toEqual([
      "https://cdn.example/a.png",
      "https://cdn.example/b.png",
    ]);
  });
});
