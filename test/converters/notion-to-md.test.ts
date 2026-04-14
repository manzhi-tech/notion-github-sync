import { describe, it, expect } from "vitest";
import { blocksToMarkdown } from "../../src/converters/notion-to-md";
import type { BlockWithChildren } from "../../src/clients/notion";

function makeBlock(
  type: string,
  data: Record<string, unknown>,
  children?: BlockWithChildren[],
): BlockWithChildren {
  return {
    id: "block-" + Math.random().toString(36).slice(2, 8),
    type,
    has_children: !!children?.length,
    [type]: data,
    children,
  } as BlockWithChildren;
}

function makeRichText(content: string, annotations?: Partial<{
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  code: boolean;
  underline: boolean;
  color: string;
}>, link?: string) {
  return {
    type: "text",
    plain_text: content,
    text: { content, link: link ? { url: link } : null },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      code: false,
      underline: false,
      color: "default",
      ...annotations,
    },
  };
}

describe("blocksToMarkdown", () => {
  it("should convert paragraph", () => {
    const blocks = [
      makeBlock("paragraph", {
        rich_text: [makeRichText("Hello world")],
      }),
    ];
    expect(blocksToMarkdown(blocks)).toBe("Hello world");
  });

  it("should convert headings", () => {
    const blocks = [
      makeBlock("heading_1", { rich_text: [makeRichText("H1")] }),
      makeBlock("heading_2", { rich_text: [makeRichText("H2")] }),
      makeBlock("heading_3", { rich_text: [makeRichText("H3")] }),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("# H1");
    expect(md).toContain("## H2");
    expect(md).toContain("### H3");
  });

  it("should convert bulleted list", () => {
    const blocks = [
      makeBlock("bulleted_list_item", {
        rich_text: [makeRichText("Item 1")],
      }),
      makeBlock("bulleted_list_item", {
        rich_text: [makeRichText("Item 2")],
      }),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("- Item 1");
    expect(md).toContain("- Item 2");
  });

  it("should convert numbered list with auto-incrementing numbers", () => {
    const blocks = [
      makeBlock("numbered_list_item", {
        rich_text: [makeRichText("First")],
      }),
      makeBlock("numbered_list_item", {
        rich_text: [makeRichText("Second")],
      }),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("1. First");
    expect(md).toContain("2. Second");
  });

  it("should convert to_do blocks", () => {
    const blocks = [
      makeBlock("to_do", {
        rich_text: [makeRichText("Done task")],
        checked: true,
      }),
      makeBlock("to_do", {
        rich_text: [makeRichText("Pending task")],
        checked: false,
      }),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("- [x] Done task");
    expect(md).toContain("- [ ] Pending task");
  });

  it("should convert code block", () => {
    const blocks = [
      makeBlock("code", {
        rich_text: [makeRichText('console.log("hi")')],
        language: "javascript",
      }),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("```javascript");
    expect(md).toContain('console.log("hi")');
    expect(md).toContain("```");
  });

  it("should convert quote", () => {
    const blocks = [
      makeBlock("quote", {
        rich_text: [makeRichText("A wise quote")],
      }),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("> A wise quote");
  });

  it("should convert divider", () => {
    const blocks = [makeBlock("divider", {})];
    expect(blocksToMarkdown(blocks)).toBe("---");
  });

  it("should convert image with caption", () => {
    const blocks = [
      makeBlock("image", {
        type: "external",
        external: { url: "https://example.com/img.png" },
        caption: [makeRichText("My image")],
      }),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toBe("![My image](https://example.com/img.png)");
  });

  it("should replace Notion-hosted image URL via imageUrlMap", () => {
    const notionUrl = "https://s3.us-west-2.amazonaws.com/notion/img.png";
    const permanentUrl = "https://raw.githubusercontent.com/o/r/main/.notion-assets/abc.png";

    const blocks = [
      makeBlock("image", {
        type: "file",
        file: { url: notionUrl },
        caption: [],
      }),
    ];
    const md = blocksToMarkdown(blocks, { [notionUrl]: permanentUrl });
    expect(md).toContain(permanentUrl);
  });

  it("should convert callout with emoji", () => {
    const blocks = [
      makeBlock("callout", {
        rich_text: [makeRichText("Important note")],
        icon: { emoji: "\u26A0\uFE0F" },
      }),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("> \u26A0\uFE0F Important note");
  });

  it("should convert toggle to details/summary", () => {
    const child = makeBlock("paragraph", {
      rich_text: [makeRichText("Hidden content")],
    });
    const blocks = [
      makeBlock(
        "toggle",
        { rich_text: [makeRichText("Click me")] },
        [child],
      ),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("<details>");
    expect(md).toContain("<summary>Click me</summary>");
    expect(md).toContain("Hidden content");
    expect(md).toContain("</details>");
  });

  it("should convert bookmark", () => {
    const blocks = [
      makeBlock("bookmark", { url: "https://example.com" }),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toBe("[https://example.com](https://example.com)");
  });

  it("should convert equation", () => {
    const blocks = [
      makeBlock("equation", { expression: "E = mc^2" }),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toBe("$$E = mc^2$$");
  });

  it("should handle bold + italic + strikethrough annotations", () => {
    const blocks = [
      makeBlock("paragraph", {
        rich_text: [
          makeRichText("bold", { bold: true }),
          makeRichText(" "),
          makeRichText("italic", { italic: true }),
          makeRichText(" "),
          makeRichText("strike", { strikethrough: true }),
          makeRichText(" "),
          makeRichText("code", { code: true }),
        ],
      }),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("**bold**");
    expect(md).toContain("*italic*");
    expect(md).toContain("~~strike~~");
    expect(md).toContain("`code`");
  });

  it("should handle links in rich text", () => {
    const blocks = [
      makeBlock("paragraph", {
        rich_text: [makeRichText("Click here", {}, "https://example.com")],
      }),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("[Click here](https://example.com)");
  });

  it("should use placeholder for unsupported blocks", () => {
    const blocks = [
      makeBlock("table_of_contents", {}),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("暂不支持同步");
  });

  it("should handle nested bulleted list", () => {
    const child = makeBlock("bulleted_list_item", {
      rich_text: [makeRichText("Nested item")],
    });
    const blocks = [
      makeBlock(
        "bulleted_list_item",
        { rich_text: [makeRichText("Parent item")] },
        [child],
      ),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("- Parent item");
    expect(md).toContain("  - Nested item");
  });
});
