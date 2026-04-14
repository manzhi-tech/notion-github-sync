import { describe, it, expect } from "vitest";
import { mergeSyncedRegion, extractSyncedContent } from "../../src/converters/body-merge";
import { BODY_START_MARKER, BODY_END_MARKER } from "../../src/types";

describe("mergeSyncedRegion", () => {
  it("should insert synced block into empty body", () => {
    const result = mergeSyncedRegion("", "# Hello World", "page-123");

    expect(result).toContain(BODY_START_MARKER);
    expect(result).toContain(BODY_END_MARKER);
    expect(result).toContain("# Hello World");
    expect(result).toContain("<!-- notion-page-id: page-123 -->");
    expect(result).toContain("<!-- last-synced-at:");
  });

  it("should prepend synced block before existing content on first sync", () => {
    const existingBody = "Some user content here";
    const result = mergeSyncedRegion(existingBody, "# From Notion", "page-456");

    expect(result).toContain(BODY_START_MARKER);
    expect(result).toContain("# From Notion");
    expect(result).toContain("Some user content here");

    // Synced block should come before user content
    const startIdx = result.indexOf(BODY_START_MARKER);
    const userIdx = result.indexOf("Some user content here");
    expect(startIdx).toBeLessThan(userIdx);
  });

  it("should replace content between markers on subsequent syncs", () => {
    const existingBody = [
      BODY_START_MARKER,
      "<!-- old warning -->",
      "",
      "Old Notion content",
      "",
      BODY_END_MARKER,
      "",
      "<!-- notion-page-id: page-789 -->",
      "<!-- last-synced-at: 2024-01-01T00:00:00Z -->",
      "",
      "User written content below",
    ].join("\n");

    const result = mergeSyncedRegion(existingBody, "Updated content", "page-789");

    expect(result).toContain("Updated content");
    expect(result).not.toContain("Old Notion content");
    expect(result).toContain("User written content below");
  });

  it("should preserve user content outside markers", () => {
    const existingBody = [
      "Header content",
      "",
      BODY_START_MARKER,
      "<!-- warning -->",
      "Old content",
      BODY_END_MARKER,
      "",
      "<!-- notion-page-id: p1 -->",
      "",
      "Footer content",
    ].join("\n");

    const result = mergeSyncedRegion(existingBody, "New content", "p1");

    expect(result).toContain("Header content");
    expect(result).toContain("New content");
    expect(result).toContain("Footer content");
    expect(result).not.toContain("Old content");
  });
});

describe("extractSyncedContent", () => {
  it("should extract content between markers", () => {
    const body = [
      BODY_START_MARKER,
      "<!-- warning -->",
      "",
      "Some synced content",
      "",
      BODY_END_MARKER,
    ].join("\n");

    const content = extractSyncedContent(body);
    expect(content).toContain("Some synced content");
  });

  it("should return null if markers are missing", () => {
    expect(extractSyncedContent("no markers here")).toBeNull();
    expect(extractSyncedContent("")).toBeNull();
  });
});
