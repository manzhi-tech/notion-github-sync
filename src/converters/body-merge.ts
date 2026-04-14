import { BODY_START_MARKER, BODY_END_MARKER, BODY_WARNING_TEXT } from "../types";

/**
 * Merge synced Notion content into GitHub issue/PR body.
 * Preserves user-written content outside the sync markers.
 * Per spec §7 and §13.4.
 */
export function mergeSyncedRegion(
  oldBody: string,
  newContent: string,
  notionPageId: string,
): string {
  const now = new Date().toISOString();

  const syncedBlock = `${BODY_START_MARKER}
<!-- ${BODY_WARNING_TEXT} -->

${newContent}

${BODY_END_MARKER}

<!-- notion-page-id: ${notionPageId} -->
<!-- last-synced-at: ${now} -->`;

  if (oldBody.includes(BODY_START_MARKER) && oldBody.includes(BODY_END_MARKER)) {
    // Update existing synced region
    const before = oldBody.split(BODY_START_MARKER)[0].trimEnd();
    let after = oldBody.split(BODY_END_MARKER).slice(1).join(BODY_END_MARKER);

    // Clean up old metadata comments at the start of 'after'
    after = after.replace(
      /^\s*(<!--\s*notion-page-id:.*?-->\s*|<!--\s*last-synced-at:.*?-->\s*)+/s,
      "",
    );

    const parts = [before, syncedBlock, after].filter(Boolean);
    return parts.join("\n\n").trim() + "\n";
  }

  // First-time sync: prepend synced block before existing body
  if (oldBody.trim()) {
    return syncedBlock + "\n\n" + oldBody;
  }

  return syncedBlock + "\n";
}

/**
 * Extract the synced markdown content between markers.
 * Returns null if markers are not found.
 */
export function extractSyncedContent(body: string): string | null {
  if (!body.includes(BODY_START_MARKER) || !body.includes(BODY_END_MARKER)) {
    return null;
  }

  const startIdx = body.indexOf(BODY_START_MARKER) + BODY_START_MARKER.length;
  const endIdx = body.indexOf(BODY_END_MARKER);

  if (startIdx >= endIdx) return null;

  // Skip the warning comment line
  let content = body.slice(startIdx, endIdx).trim();
  const warningComment = `<!-- ${BODY_WARNING_TEXT} -->`;
  if (content.startsWith(warningComment)) {
    content = content.slice(warningComment.length).trim();
  }

  return content;
}
