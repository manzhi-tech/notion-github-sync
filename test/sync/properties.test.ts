import { describe, it, expect } from "vitest";
import {
  deriveStatus,
  githubToNotionProperties,
  parseNotionProperties,
  notionToGithubProperties,
  mapStatusToState,
  FIELD_MAPPING,
} from "../../src/sync/properties";

describe("deriveStatus", () => {
  it("should return Merged for merged PR", () => {
    expect(deriveStatus({ state: "closed", merged: true })).toBe("Merged");
  });

  it("should return Merged when merged_at is set", () => {
    expect(
      deriveStatus({ state: "closed", merged_at: "2024-01-01T00:00:00Z" }),
    ).toBe("Merged");
  });

  it("should return Draft for draft PR", () => {
    expect(deriveStatus({ state: "open", draft: true })).toBe("Draft");
  });

  it("should return Open for open issue", () => {
    expect(deriveStatus({ state: "open" })).toBe("Open");
  });

  it("should return Closed for closed issue", () => {
    expect(deriveStatus({ state: "closed" })).toBe("Closed");
  });
});

describe("githubToNotionProperties", () => {
  it("should produce valid Notion property format", () => {
    const props = githubToNotionProperties(
      {
        number: 42,
        title: "Fix bug",
        html_url: "https://github.com/owner/repo/issues/42",
        state: "open",
        labels: [{ name: "bug" }],
        assignees: [{ login: "alice" }],
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
      "owner/repo",
      "issue",
      "abc123",
    );

    // Title
    expect(props[FIELD_MAPPING.title]).toEqual({
      title: [{ text: { content: "Fix bug" } }],
    });

    // GitHub ID
    expect(props[FIELD_MAPPING.github_id]).toEqual({ number: 42 });

    // Status
    expect(props[FIELD_MAPPING.status]).toEqual({
      status: { name: "Open" },
    });

    // Labels
    expect(props[FIELD_MAPPING.labels]).toEqual({
      multi_select: [{ name: "bug" }],
    });

    // Assignees
    expect(props[FIELD_MAPPING.assignees]).toEqual({
      multi_select: [{ name: "alice" }],
    });

    // Last Synced By
    expect(props[FIELD_MAPPING.last_synced_by]).toEqual({
      select: { name: "github" },
    });
  });
});

describe("parseNotionProperties", () => {
  it("should extract title from Notion title property", () => {
    const props = {
      [FIELD_MAPPING.title]: {
        title: [{ plain_text: "My Issue" }],
      },
      [FIELD_MAPPING.status]: { status: { name: "Open" } },
      [FIELD_MAPPING.labels]: {
        multi_select: [{ name: "bug" }, { name: "urgent" }],
      },
      [FIELD_MAPPING.assignees]: {
        multi_select: [{ name: "alice" }],
      },
      [FIELD_MAPPING.repo]: { select: { name: "owner/repo" } },
      [FIELD_MAPPING.github_type]: { select: { name: "issue" } },
      [FIELD_MAPPING.github_id]: { number: 42 },
      [FIELD_MAPPING.last_synced_by]: { select: { name: "github" } },
    };

    const parsed = parseNotionProperties(props);

    expect(parsed.title).toBe("My Issue");
    expect(parsed.status).toBe("Open");
    expect(parsed.labels).toEqual(["bug", "urgent"]);
    expect(parsed.assignees).toEqual(["alice"]);
    expect(parsed.repo).toBe("owner/repo");
    expect(parsed.githubType).toBe("issue");
    expect(parsed.githubNumber).toBe(42);
    expect(parsed.lastSyncedBy).toBe("github");
  });
});

describe("notionToGithubProperties", () => {
  it("should map Notion properties to GitHub format", () => {
    const result = notionToGithubProperties({
      title: "Bug fix",
      status: "Open",
      labels: ["bug"],
      assignees: ["alice"],
      repo: "owner/repo",
      githubType: "issue",
      githubNumber: 42,
      lastSyncedBy: "notion",
    });

    expect(result.title).toBe("Bug fix");
    expect(result.state).toBe("open");
    expect(result.labels).toEqual(["bug"]);
    expect(result.assignees).toEqual(["alice"]);
  });
});

describe("mapStatusToState", () => {
  it("should map Open to open", () => {
    expect(mapStatusToState("Open")).toBe("open");
  });

  it("should map Closed to closed", () => {
    expect(mapStatusToState("Closed")).toBe("closed");
  });

  it("should map Merged to closed", () => {
    expect(mapStatusToState("Merged")).toBe("closed");
  });

  it("should map Draft to open", () => {
    expect(mapStatusToState("Draft")).toBe("open");
  });

  it("should default to open for unknown status", () => {
    expect(mapStatusToState("Unknown")).toBe("open");
  });
});
