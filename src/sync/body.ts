import type { Bindings } from "../types";
import { findMappingByNotion, updateMappingBodyHash, insertSyncLog } from "../db/queries";
import { computeBodyHash, isEcho } from "./hash";
import { processImages } from "./images";
import { blocksToMarkdown } from "../converters/notion-to-md";
import { mergeSyncedRegion } from "../converters/body-merge";
import { GitHubClient } from "../clients/github";
import { NotionClient } from "../clients/notion";

/**
 * Sync Notion page body to GitHub issue/PR body.
 * One-directional: Notion → GitHub only.
 * Per spec §13.3.
 */
export async function syncNotionToGithubBody(
  env: Bindings,
  pageId: string,
): Promise<void> {
  const mapping = await findMappingByNotion(env.DB, pageId);
  if (!mapping) {
    console.log(
      JSON.stringify({
        event: "body_sync_skipped",
        reason: "no_mapping",
        page_id: pageId,
      }),
    );
    return;
  }

  const echoWindow = parseInt(env.SYNC_ECHO_WINDOW_SECONDS, 10) || 10;
  const notion = new NotionClient(env.NOTION_TOKEN, env.NOTION_DATABASE_ID);
  const github = new GitHubClient(env.GITHUB_TOKEN);

  // 1. Fetch Notion blocks
  const blocks = await notion.getBlocks(pageId);

  // 2. Process images
  const imageUrlMap = await processImages(blocks, env, mapping.github_repo);

  // 3. Convert to markdown
  const markdown = blocksToMarkdown(blocks, imageUrlMap);

  // 4. Compute hash and compare
  const newHash = await computeBodyHash(markdown);

  if (mapping.last_body_hash === newHash) {
    console.log(
      JSON.stringify({
        event: "body_sync_skipped",
        reason: "content_unchanged",
        mapping_id: mapping.id,
      }),
    );
    return;
  }

  // 5. Check echo
  const echo = await isEcho(
    env.DB,
    mapping.id,
    "notion_to_github",
    newHash,
    echoWindow,
  );
  if (echo) {
    console.log(
      JSON.stringify({
        event: "echo_detected",
        direction: "notion_to_github",
        scope: "body",
        mapping_id: mapping.id,
      }),
    );
    return;
  }

  // 6. Read current GitHub body and merge
  const issue = await github.getIssue(mapping.github_repo, mapping.github_number);
  const newBody = mergeSyncedRegion(
    issue.body ?? "",
    markdown,
    pageId,
  );

  // 7. Update GitHub
  await github.updateIssue(mapping.github_repo, mapping.github_number, {
    body: newBody,
  });

  // 8. Update mapping and write sync log
  await updateMappingBodyHash(env.DB, mapping.id, newHash);
  await insertSyncLog(env.DB, mapping.id, "notion_to_github", "body", newHash);

  console.log(
    JSON.stringify({
      event: "sync_executed",
      direction: "notion_to_github",
      scope: "body",
      mapping_id: mapping.id,
      github_repo: mapping.github_repo,
      github_number: mapping.github_number,
    }),
  );
}
