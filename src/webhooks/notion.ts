import type { Context } from "hono";
import type { Bindings, GithubType } from "../types";
import { GitHubClient } from "../clients/github";
import { NotionClient } from "../clients/notion";
import {
  findMappingByNotion,
  insertMapping,
  insertSyncLog,
} from "../db/queries";
import { computePropertiesHash, isEcho } from "../sync/hash";
import {
  parseNotionProperties,
  notionToGithubProperties,
  FIELD_MAPPING,
} from "../sync/properties";
import { scheduleBodySync } from "../sync/debounce";

/**
 * Notion webhook handler.
 * Verifies signature, parses page events, processes async.
 */
export async function notionWebhookRoute(
  c: Context<{ Bindings: Bindings }>,
): Promise<Response> {
  const env = c.env;
  const body = await c.req.text();

  // Verify Notion signature
  const signature = c.req.header("Notion-Signature") ?? "";
  if (env.NOTION_WEBHOOK_SECRET) {
    const valid = await verifyNotionSignature(
      body,
      signature,
      env.NOTION_WEBHOOK_SECRET,
    );
    if (!valid) {
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  let payload: { type: string; data: { id: string } };
  try {
    payload = JSON.parse(body);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const eventType = payload.type;
  const pageId = payload.data?.id;

  if (!pageId) {
    return c.json({ error: "Missing page ID" }, 400);
  }

  console.log(
    JSON.stringify({
      event: "webhook_received",
      source: "notion",
      type: eventType,
      page_id: pageId,
    }),
  );

  // Route by event type
  switch (eventType) {
    case "page.properties_updated":
      c.executionCtx.waitUntil(processNotionPropertiesUpdate(env, pageId));
      break;

    case "page.content_updated": {
      const debounceSeconds =
        parseInt(env.SYNC_BODY_DEBOUNCE_SECONDS, 10) || 30;
      c.executionCtx.waitUntil(
        scheduleBodySync(env.DB, pageId, debounceSeconds),
      );
      break;
    }

    case "page.created":
      c.executionCtx.waitUntil(processNotionPageCreated(env, pageId));
      break;

    case "page.deleted":
      console.log(
        JSON.stringify({
          event: "page_deleted",
          page_id: pageId,
          action: "logged_only",
        }),
      );
      break;

    default:
      console.log(
        JSON.stringify({
          event: "unknown_notion_event",
          type: eventType,
        }),
      );
  }

  return c.json({ ok: true }, 202);
}

/**
 * Handle Notion page properties update → sync to GitHub.
 */
async function processNotionPropertiesUpdate(
  env: Bindings,
  pageId: string,
): Promise<void> {
  const echoWindow = parseInt(env.SYNC_ECHO_WINDOW_SECONDS, 10) || 10;
  const notion = new NotionClient(env.NOTION_TOKEN, env.NOTION_DATABASE_ID);
  const github = new GitHubClient(env.GITHUB_TOKEN);

  // Fetch page
  const page = await notion.getPage(pageId);
  const props = parseNotionProperties(
    page.properties as Record<string, unknown>,
  );

  // Check if Last Synced By is "github" (echo marker, layer 3)
  if (props.lastSyncedBy === "github") {
    // Could be an echo from our own write; additional layers will confirm
  }

  // Compute hash
  const currentHash = await computePropertiesHash(
    props.title,
    props.status,
    props.labels,
    props.assignees,
  );

  // Find mapping
  const mapping = await findMappingByNotion(env.DB, pageId);

  if (mapping) {
    // Check echo
    const echo = await isEcho(
      env.DB,
      mapping.id,
      "notion_to_github",
      currentHash,
      echoWindow,
    );

    if (echo) {
      console.log(
        JSON.stringify({
          event: "echo_detected",
          direction: "notion_to_github",
          mapping_id: mapping.id,
        }),
      );
      return;
    }

    // Update GitHub issue/PR
    const githubProps = notionToGithubProperties(props);
    await github.updateIssue(mapping.github_repo, mapping.github_number, {
      title: githubProps.title,
      state: githubProps.state,
      labels: githubProps.labels,
      assignees: githubProps.assignees,
    });

    // Update Notion marker fields
    await notion.updatePage(pageId, {
      [FIELD_MAPPING.last_synced_by]: { select: { name: "notion" } },
      [FIELD_MAPPING.last_synced_at]: {
        date: { start: new Date().toISOString() },
      },
      [FIELD_MAPPING.sync_hash]: {
        rich_text: [{ text: { content: currentHash } }],
      },
    });

    // Write sync log
    await insertSyncLog(
      env.DB,
      mapping.id,
      "notion_to_github",
      "properties",
      currentHash,
    );

    console.log(
      JSON.stringify({
        event: "sync_executed",
        direction: "notion_to_github",
        scope: "properties",
        mapping_id: mapping.id,
        action: "update",
      }),
    );
  } else {
    // No mapping: if Repo field is set, create a new GitHub issue
    if (!props.repo) {
      console.log(
        JSON.stringify({
          event: "sync_skipped",
          reason: "no_mapping_no_repo",
          page_id: pageId,
        }),
      );
      return;
    }

    // Check repo whitelist
    const allowedRepos = env.GITHUB_REPOS.split(",").map((r) => r.trim());
    if (!allowedRepos.includes(props.repo)) {
      console.log(
        JSON.stringify({
          event: "sync_skipped",
          reason: "repo_not_in_whitelist",
          page_id: pageId,
          repo: props.repo,
        }),
      );
      return;
    }

    // Create GitHub issue
    const issue = await github.createIssue(props.repo, {
      title: props.title,
      labels: props.labels,
      assignees: props.assignees,
    });

    // Insert mapping
    const newMapping = await insertMapping(
      env.DB,
      props.repo,
      issue.number,
      "issue" as GithubType,
      pageId,
    );

    // Update Notion with GitHub info
    await notion.updatePage(pageId, {
      [FIELD_MAPPING.github_id]: { number: issue.number },
      [FIELD_MAPPING.github_url]: { url: issue.html_url },
      [FIELD_MAPPING.github_type]: { select: { name: "issue" } },
      [FIELD_MAPPING.last_synced_by]: { select: { name: "notion" } },
      [FIELD_MAPPING.last_synced_at]: {
        date: { start: new Date().toISOString() },
      },
      [FIELD_MAPPING.sync_hash]: {
        rich_text: [{ text: { content: currentHash } }],
      },
    });

    // Write sync log
    await insertSyncLog(
      env.DB,
      newMapping.id,
      "notion_to_github",
      "properties",
      currentHash,
    );

    console.log(
      JSON.stringify({
        event: "sync_executed",
        direction: "notion_to_github",
        scope: "properties",
        mapping_id: newMapping.id,
        action: "create",
      }),
    );
  }
}

/**
 * Handle Notion page created event.
 * Same logic as properties update for new pages.
 */
async function processNotionPageCreated(
  env: Bindings,
  pageId: string,
): Promise<void> {
  await processNotionPropertiesUpdate(env, pageId);
}

// ============================================================
// Notion Signature Verification
// ============================================================

async function verifyNotionSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!signature) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );

  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
