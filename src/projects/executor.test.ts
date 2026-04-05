import { describe, expect, it } from "vitest";
import { __internal } from "./executor.js";
import type { ProgressLogEntry } from "./types.js";

describe("extractRunningSteps (report_running_step thumbnails)", () => {
  it("maps thumbnailUrls to multiple screenshot artifacts", () => {
    const log: ProgressLogEntry[] = [
      {
        ts: 1,
        kind: "tool_use",
        text: "report",
        toolName: "report_running_step",
        toolInput: {
          title: "US News",
          description: "Top pick",
          thumbnailUrls: ["https://cdn.example/a.png", "https://cdn.example/b.png"],
        },
      },
    ];
    const steps = __internal.extractRunningSteps(log);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.artifacts).toHaveLength(2);
    expect(steps[0]?.artifacts[0]?.path).toBe("https://cdn.example/a.png");
    expect(steps[0]?.artifacts[1]?.path).toBe("https://cdn.example/b.png");
  });

  it("caps thumbnailUrls at three per step", () => {
    const log: ProgressLogEntry[] = [
      {
        ts: 1,
        kind: "tool_use",
        text: "report",
        toolName: "report_running_step",
        toolInput: {
          title: "News",
          description: "Many shots",
          thumbnailUrls: [
            "https://cdn.example/1.png",
            "https://cdn.example/2.png",
            "https://cdn.example/3.png",
            "https://cdn.example/4.png",
          ],
        },
      },
    ];
    const steps = __internal.extractRunningSteps(log);
    expect(steps[0]?.artifacts).toHaveLength(3);
    expect(steps[0]?.artifacts[2]?.path).toBe("https://cdn.example/3.png");
  });

  it("maps single thumbnailUrl to one artifact", () => {
    const log: ProgressLogEntry[] = [
      {
        ts: 1,
        kind: "tool_use",
        text: "report",
        toolName: "report_running_step",
        toolInput: {
          title: "One",
          description: "D",
          thumbnailUrl: "https://cdn.example/one.png",
        },
      },
    ];
    const steps = __internal.extractRunningSteps(log);
    expect(steps[0]?.artifacts).toHaveLength(1);
    expect(steps[0]?.artifacts[0]?.thumbnailPath).toBe("https://cdn.example/one.png");
  });

  it("falls back to recent tool_result screenshot when no thumbnail fields", () => {
    const log: ProgressLogEntry[] = [
      {
        ts: 1,
        kind: "tool_result",
        text: "cap",
        imageUrl: "https://s3.example/shot.png",
        thumbnailUrl: "https://s3.example/shot.png",
      },
      {
        ts: 2,
        kind: "tool_use",
        text: "report",
        toolName: "report_running_step",
        toolInput: { title: "M", description: "D" },
      },
    ];
    const steps = __internal.extractRunningSteps(log);
    expect(steps[0]?.artifacts).toHaveLength(1);
    expect(steps[0]?.artifacts[0]?.path).toBe("https://s3.example/shot.png");
  });
});

describe("project executor exploration helpers", () => {
  it("filters dangerous actions and favors navigation sections", () => {
    const candidates = __internal.prepareExploreCandidates(
      [
        {
          exploreId: "1",
          href: "https://example.com/settings",
          inNavigation: true,
          kind: "link",
          label: "Settings",
          sameOrigin: true,
        },
        {
          exploreId: "2",
          href: "https://example.com/delete",
          inNavigation: false,
          kind: "button",
          label: "Delete account",
          sameOrigin: true,
        },
        {
          exploreId: "3",
          href: "https://example.com/reports",
          inNavigation: true,
          kind: "link",
          label: "Reports",
          sameOrigin: true,
        },
      ],
      "section",
      10,
    );

    expect(candidates.map((candidate) => candidate.label)).toEqual(["Settings", "Reports"]);
  });

  it("normalizes labels and page descriptions safely", () => {
    expect(__internal.normalizeExploreLabel("  Team    Management   ")).toBe("Team Management");
    expect(__internal.describePage("https://example.com/home", "  Main Dashboard  ")).toBe(
      "Main Dashboard (https://example.com/home)",
    );
  });
});

describe("provider failure hints", () => {
  it("detects rate limit phrasing", () => {
    expect(__internal.looksLikeProviderRateLimit("API rate limit reached")).toBe(true);
    expect(__internal.looksLikeProviderRateLimit("Error 429 too many requests")).toBe(true);
    expect(__internal.looksLikeProviderRateLimit("Done browsing.")).toBe(false);
  });

  it("resolveFailedRunHints prefers rate limit copy when transcript matches", () => {
    const hints = __internal.resolveFailedRunHints({
      latestAssistantText: "Sorry, rate limit exceeded.",
      tailTextForFailureHints: "",
    });
    expect(hints.executorHint).toContain("rate limit");
    expect(hints.lastErrorMessage).toContain("rate limit");
  });

  it("detects browser TLS and network errors", () => {
    expect(__internal.looksLikeBrowserNetworkBlocker("net::ERR_CERT_COMMON_NAME_INVALID")).toBe(
      true,
    );
    expect(__internal.looksLikeBrowserNetworkBlocker("net::ERR_CONNECTION_REFUSED")).toBe(true);
    expect(__internal.looksLikeBrowserNetworkBlocker("Browser: page failed to load (miss).")).toBe(
      true,
    );
    expect(__internal.looksLikeBrowserNetworkBlocker("All good here.")).toBe(false);
  });

  it("extractLatestBlockerHintFromProgressLog returns newest matching system line", () => {
    const hint = __internal.extractLatestBlockerHintFromProgressLog([
      { ts: 1, kind: "system", text: "Old net::ERR_NAME_NOT_RESOLVED" },
      { ts: 2, kind: "assistant", text: "Working…" },
      { ts: 3, kind: "system", text: "net::ERR_CERT_COMMON_NAME_INVALID at https://1.2.3.4/" },
    ]);
    expect(hint).toContain("ERR_CERT_COMMON_NAME_INVALID");
  });

  it("resolveFailedRunHints surfaces network or TLS when run fails", () => {
    const hints = __internal.resolveFailedRunHints({
      latestAssistantText: "",
      tailTextForFailureHints: "Navigation failed: net::ERR_CONNECTION_REFUSED",
    });
    expect(hints.executorHint).toContain("browser could not load");
    expect(hints.lastErrorMessage).toContain("Navigation failed");
  });

  it("computeHostStallAdvisory returns copy after 5 minutes with a light transcript", () => {
    const now = Date.now();
    const start = now - 5 * 60 * 1000 - 1;
    const text = __internal.computeHostStallAdvisory({
      startTime: start,
      paused: false,
      hasBlockerHint: false,
      messageCount: 4,
    });
    expect(text).toContain("5+ minutes");
    expect(text).toContain("Chrome");
  });

  it("computeHostStallAdvisory stays off before 5 minutes or when transcript is busy", () => {
    const now = Date.now();
    expect(
      __internal.computeHostStallAdvisory({
        startTime: now - 4 * 60 * 1000,
        paused: false,
        hasBlockerHint: false,
        messageCount: 4,
      }),
    ).toBeUndefined();
    expect(
      __internal.computeHostStallAdvisory({
        startTime: now - 6 * 60 * 1000,
        paused: false,
        hasBlockerHint: false,
        messageCount: 20,
      }),
    ).toBeUndefined();
    expect(
      __internal.computeHostStallAdvisory({
        startTime: now - 6 * 60 * 1000,
        paused: false,
        hasBlockerHint: true,
        messageCount: 4,
      }),
    ).toBeUndefined();
  });
});
