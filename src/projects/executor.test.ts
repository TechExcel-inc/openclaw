import { describe, expect, it } from "vitest";
import { __internal } from "./executor.js";

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
