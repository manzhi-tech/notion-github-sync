import type { BlockWithChildren } from "../clients/notion";
import { BLOCK_WHITELIST, UNSUPPORTED_PLACEHOLDER } from "../types";

/**
 * Convert Notion blocks to Markdown.
 * Supports 20+ block types per spec §9.
 */
export function blocksToMarkdown(
  blocks: BlockWithChildren[],
  imageUrlMap: Record<string, string> = {},
): string {
  const lines: string[] = [];
  let numberedIndex = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const isNumbered = block.type === "numbered_list_item";

    if (isNumbered) {
      numberedIndex++;
    } else {
      numberedIndex = 0;
    }

    const md = convertBlock(block, 0, numberedIndex, imageUrlMap);
    if (md !== null) {
      lines.push(md);
    }
  }

  return lines.join("\n\n");
}

function convertBlock(
  block: BlockWithChildren,
  indent: number,
  numberedIndex: number,
  imageUrlMap: Record<string, string>,
): string | null {
  const prefix = "  ".repeat(indent);

  if (!BLOCK_WHITELIST.has(block.type)) {
    return handleUnsupported(block);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (block as any)[block.type];

  switch (block.type) {
    case "paragraph":
      return prefix + richTextToMd(data.rich_text);

    case "heading_1":
      return prefix + "# " + richTextToMd(data.rich_text);

    case "heading_2":
      return prefix + "## " + richTextToMd(data.rich_text);

    case "heading_3":
      return prefix + "### " + richTextToMd(data.rich_text);

    case "bulleted_list_item": {
      let result = prefix + "- " + richTextToMd(data.rich_text);
      if (block.children?.length) {
        result += "\n" + convertChildren(block.children, indent + 1, imageUrlMap);
      }
      return result;
    }

    case "numbered_list_item": {
      let result = prefix + `${numberedIndex}. ` + richTextToMd(data.rich_text);
      if (block.children?.length) {
        result += "\n" + convertChildren(block.children, indent + 1, imageUrlMap);
      }
      return result;
    }

    case "to_do": {
      const checkbox = data.checked ? "[x]" : "[ ]";
      let result = prefix + `- ${checkbox} ` + richTextToMd(data.rich_text);
      if (block.children?.length) {
        result += "\n" + convertChildren(block.children, indent + 1, imageUrlMap);
      }
      return result;
    }

    case "code": {
      const language = data.language ?? "";
      const code = richTextToMd(data.rich_text, true);
      return prefix + "```" + language + "\n" + code + "\n" + prefix + "```";
    }

    case "quote": {
      let result =
        prefix +
        data.rich_text
          .map((rt: RichText) => richTextSegmentToMd(rt))
          .join("")
          .split("\n")
          .map((line: string) => "> " + line)
          .join("\n");
      if (block.children?.length) {
        const childMd = convertChildren(block.children, 0, imageUrlMap);
        result +=
          "\n" +
          childMd
            .split("\n")
            .map((line) => prefix + "> " + line)
            .join("\n");
      }
      return result;
    }

    case "divider":
      return prefix + "---";

    case "image": {
      const caption = data.caption
        ? richTextToMd(data.caption, true)
        : "";
      let url: string;
      if (data.type === "file") {
        url = imageUrlMap[data.file.url] ?? data.file.url;
      } else {
        url = data.external.url;
      }
      return prefix + `![${caption}](${url})`;
    }

    case "callout": {
      const emoji = data.icon?.emoji ?? "";
      const text = richTextToMd(data.rich_text);
      let result = prefix + `> ${emoji} ${text}`.trim();
      if (block.children?.length) {
        const childMd = convertChildren(block.children, 0, imageUrlMap);
        result +=
          "\n" +
          childMd
            .split("\n")
            .map((line) => prefix + "> " + line)
            .join("\n");
      }
      return result;
    }

    case "toggle": {
      const summary = richTextToMd(data.rich_text);
      const childMd = block.children?.length
        ? "\n\n" + convertChildren(block.children, 0, imageUrlMap) + "\n\n"
        : "\n\n";
      return (
        prefix +
        `<details><summary>${summary}</summary>${childMd}</details>`
      );
    }

    case "table": {
      if (!block.children?.length) return "";
      return convertTable(block.children, data.has_column_header);
    }

    case "bookmark":
      return prefix + `[${data.url}](${data.url})`;

    case "link_preview":
      return prefix + `[${data.url}](${data.url})`;

    case "equation":
      return prefix + `$$${data.expression}$$`;

    default:
      return handleUnsupported(block);
  }
}

function handleUnsupported(block: BlockWithChildren): string | null {
  // Handle special non-whitelist types
  switch (block.type) {
    case "child_page": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const title = (block as any).child_page?.title ?? "子页面";
      const url = `https://notion.so/${block.id.replace(/-/g, "")}`;
      return `[子页面: ${title}](${url})`;
    }
    case "child_database": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const title = (block as any).child_database?.title ?? "数据库";
      const url = `https://notion.so/${block.id.replace(/-/g, "")}`;
      return `[数据库: ${title}](${url})`;
    }
    case "synced_block": {
      if (block.children?.length) {
        return convertChildren(block.children, 0, {});
      }
      return null;
    }
    case "column_list": {
      if (block.children?.length) {
        return convertChildren(block.children, 0, {});
      }
      return null;
    }
    case "column": {
      if (block.children?.length) {
        return convertChildren(block.children, 0, {});
      }
      return null;
    }
    default:
      return UNSUPPORTED_PLACEHOLDER;
  }
}

function convertChildren(
  children: BlockWithChildren[],
  indent: number,
  imageUrlMap: Record<string, string>,
): string {
  const lines: string[] = [];
  let numberedIndex = 0;

  for (const child of children) {
    if (child.type === "numbered_list_item") {
      numberedIndex++;
    } else {
      numberedIndex = 0;
    }
    const md = convertBlock(child, indent, numberedIndex, imageUrlMap);
    if (md !== null) {
      lines.push(md);
    }
  }

  return lines.join("\n");
}

function convertTable(
  rows: BlockWithChildren[],
  hasHeader: boolean,
): string {
  const tableRows: string[][] = [];

  for (const row of rows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cells: any[] = (row as any).table_row?.cells ?? [];
    tableRows.push(cells.map((cell: RichText[]) => richTextToMd(cell, true)));
  }

  if (tableRows.length === 0) return "";

  const lines: string[] = [];
  const colCount = tableRows[0].length;

  // Header row
  lines.push("| " + tableRows[0].join(" | ") + " |");

  // Separator
  lines.push("| " + Array(colCount).fill("---").join(" | ") + " |");

  // Data rows (skip first if it's header)
  const startIdx = hasHeader ? 1 : 0;
  for (let i = startIdx; i < tableRows.length; i++) {
    lines.push("| " + tableRows[i].join(" | ") + " |");
  }

  return lines.join("\n");
}

// ============================================================
// Rich Text → Markdown
// ============================================================

interface RichText {
  type: string;
  plain_text: string;
  text?: { content: string; link?: { url: string } | null };
  mention?: { type: string; page?: { id: string }; user?: { name: string }; date?: { start: string } };
  equation?: { expression: string };
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string;
  };
  href?: string | null;
}

function richTextToMd(
  richText: RichText[],
  plain: boolean = false,
): string {
  if (!richText || !Array.isArray(richText)) return "";
  return richText.map((rt) => richTextSegmentToMd(rt, plain)).join("");
}

function richTextSegmentToMd(
  rt: RichText,
  plain: boolean = false,
): string {
  // Handle mentions
  if (rt.type === "mention" && rt.mention) {
    if (rt.mention.type === "page" && rt.mention.page) {
      const url = `https://notion.so/${rt.mention.page.id.replace(/-/g, "")}`;
      return `[${rt.plain_text}](${url})`;
    }
    if (rt.mention.type === "user" && rt.mention.user) {
      return `@${rt.mention.user.name ?? rt.plain_text}`;
    }
    if (rt.mention.type === "date" && rt.mention.date) {
      return rt.mention.date.start;
    }
    return rt.plain_text;
  }

  // Handle equations
  if (rt.type === "equation" && rt.equation) {
    return `$${rt.equation.expression}$`;
  }

  if (plain) return rt.plain_text;

  let text = rt.plain_text;
  if (!text) return "";

  const ann = rt.annotations;

  // Apply formatting (order matters for nesting)
  if (ann.code) text = `\`${text}\``;
  if (ann.bold && ann.italic) text = `***${text}***`;
  else if (ann.bold) text = `**${text}**`;
  else if (ann.italic) text = `*${text}*`;
  if (ann.strikethrough) text = `~~${text}~~`;

  // Links
  const link = rt.text?.link?.url ?? rt.href;
  if (link) text = `[${text}](${link})`;

  return text;
}
