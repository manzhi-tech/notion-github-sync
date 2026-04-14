import { describe, it, expect } from "vitest";
import { computePropertiesHash, computeBodyHash } from "../../src/sync/hash";

describe("computePropertiesHash", () => {
  it("should produce consistent hash for same input", async () => {
    const hash1 = await computePropertiesHash("Title", "Open", ["bug"], ["user1"]);
    const hash2 = await computePropertiesHash("Title", "Open", ["bug"], ["user1"]);
    expect(hash1).toBe(hash2);
  });

  it("should produce different hash for different title", async () => {
    const hash1 = await computePropertiesHash("Title A", "Open", [], []);
    const hash2 = await computePropertiesHash("Title B", "Open", [], []);
    expect(hash1).not.toBe(hash2);
  });

  it("should normalize label order", async () => {
    const hash1 = await computePropertiesHash("T", "Open", ["b", "a"], []);
    const hash2 = await computePropertiesHash("T", "Open", ["a", "b"], []);
    expect(hash1).toBe(hash2);
  });

  it("should normalize assignee order", async () => {
    const hash1 = await computePropertiesHash("T", "Open", [], ["z", "a"]);
    const hash2 = await computePropertiesHash("T", "Open", [], ["a", "z"]);
    expect(hash1).toBe(hash2);
  });

  it("should trim title whitespace", async () => {
    const hash1 = await computePropertiesHash("  Title  ", "Open", [], []);
    const hash2 = await computePropertiesHash("Title", "Open", [], []);
    expect(hash1).toBe(hash2);
  });
});

describe("computeBodyHash", () => {
  it("should produce consistent hash", async () => {
    const hash1 = await computeBodyHash("# Hello\n\nWorld");
    const hash2 = await computeBodyHash("# Hello\n\nWorld");
    expect(hash1).toBe(hash2);
  });

  it("should normalize whitespace", async () => {
    const hash1 = await computeBodyHash("Hello   World");
    const hash2 = await computeBodyHash("Hello World");
    expect(hash1).toBe(hash2);
  });

  it("should produce different hash for different content", async () => {
    const hash1 = await computeBodyHash("Content A");
    const hash2 = await computeBodyHash("Content B");
    expect(hash1).not.toBe(hash2);
  });
});
