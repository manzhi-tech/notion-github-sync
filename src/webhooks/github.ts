import type { Context } from "hono";
import type { Bindings, GitHubEventPayload, GithubType } from "../types";
import { GitHubClient } from "../clients/github";
import { NotionClient } from "../clients/notion";
import { findMapping, insertMapping, insertSyncLog } from "../db/queries";
import { computePropertiesHash, isEcho } from "../sync/hash";
import { githubToNotionProperties, deriveStatus } from "../sync/properties";

// GitHub event actions we care about
const ISSUE_ACTIONS = new Set([
  "opened",
  "edited",
  "closed",
  "reopened",
  "labeled",
  "unlabeled",
  "assigned",
  "unassigned",
]);

const PR_ACTIONS = new Set([
  "opened",
  "edited",
  "closed",
  "reopened",
  "ready_for_review",
  "converted_to_draft",
]);

/**
 * GitHub webhook handler.
 * Verifies HMAC-SHA256 signature, parses event, processes async.
 */
export async function githubWebhookRoute(
  c: Context<{ Bindings: Bindings }>,
): Promise<Response> {
  const env = c.env;
  const body = await c.req.text();

  // Verify signature
  const signature = c.req.header("X-Hub-Signature-256") ?? "";
  const valid = await verifyGithubSignature(body, signature, env.GH_WEBHOOK_SECRET);
  if (!valid) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Parse event
  const eventType = c.req.header("X-GitHub-Event") ?? "";
  let payload: GitHubEventPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const action = payload.action;
  const repo = payload.repository?.full_name;

  if (!repo || !action) {
    return c.json({ error: "Missing repo or action" }, 400);
  }

  // Check repo whitelist
  const allowedRepos = env.GITHUB_REPOS.split(",").map((r) => r.trim());
  if (!allowedRepos.includes(repo)) {
    return c.json({ ok: true, skipped: "repo not in whitelist" }, 202);
  }

  // Check if event type and action are relevant
  let isRelevant = false;
  if (eventType === "issues" && ISSUE_ACTIONS.has(action)) isRelevant = true;
  if (eventType === "pull_request" && PR_ACTIONS.has(action)) isRelevant = true;

  if (!isRelevant) {
    return c.json({ ok: true, skipped: "irrelevant event" }, 202);
  }

  // Process asynchronously
  c.executionCtx.waitUntil(processGithubEvent(env, eventType, payload));

  return c.json({ ok: true }, 202);
}

async function processGithubEvent(
  env: Bindings,
  eventType: string,
  payload: GitHubEventPayload,
): Promise<void> {
  const repo = payload.repository.full_name;
  const skipLabel = env.SYNC_SKIP_LABEL || "no-sync";
  const echoWindow = parseInt(env.SYNC_ECHO_WINDOW_SECONDS, 10) || 10;

  let item: {
    number: number;
    title: string;
    html_url: string;
    state: string;
    labels: Array<{ name: string }>;
    assignees: Array<{ login: string }>;
    created_at: string;
    updated_at: string;
    draft?: boolean;
    merged?: boolean;
    merged_at?: string | null;
  };
  let githubType: GithubType;

  if (eventType === "issues" && payload.issue) {
    item = payload.issue;
    githubType = "issue";
  } else if (eventType === "pull_request" && payload.pull_request) {
    item = payload.pull_request;
    githubType = "pr";
  } else {
    return;
  }

  console.log(
    JSON.stringify({
      event: "webhook_received",
      source: "github",
      type: eventType,
      action: payload.action,
      repo,
      number: item.number,
    }),
  );

  // Check skip label
  if (item.labels.some((l) => l.name === skipLabel)) {
    console.log(
      JSON.stringify({
        event: "sync_skipped",
        reason: "skip_label",
        repo,
        number: item.number,
      }),
    );
    return;
  }

  // Compute hash
  const status = deriveStatus(item);
  const currentHash = await computePropertiesHash(
    item.title,
    status,
    item.labels.map((l) => l.name),
    item.assignees.map((a) => a.login),
  );

  // Find existing mapping
  const mapping = await findMapping(env.DB, repo, item.number);

  if (mapping) {
    // Check echo
    const echo = await isEcho(
      env.DB,
      mapping.id,
      "github_to_notion",
      currentHash,
      echoWindow,
    );

    if (echo) {
      console.log(
        JSON.stringify({
          event: "echo_detected",
          direction: "github_to_notion",
          mapping_id: mapping.id,
        }),
      );
      return;
    }

    // Update existing Notion page
    const notion = new NotionClient(env.NOTION_TOKEN, env.NOTION_DATABASE_ID);
    const properties = githubToNotionProperties(item, repo, githubType, currentHash);
    await notion.updatePage(mapping.notion_page_id, properties);

    // Write sync log
    await insertSyncLog(
      env.DB,
      mapping.id,
      "github_to_notion",
      "properties",
      currentHash,
    );

    console.log(
      JSON.stringify({
        event: "sync_executed",
        direction: "github_to_notion",
        scope: "properties",
        mapping_id: mapping.id,
        action: "update",
      }),
    );
  } else {
    // Create new Notion page
    const notion = new NotionClient(env.NOTION_TOKEN, env.NOTION_DATABASE_ID);
    const properties = githubToNotionProperties(item, repo, githubType, currentHash);
    const page = await notion.createPage(properties);

    // Insert mapping
    const newMapping = await insertMapping(
      env.DB,
      repo,
      item.number,
      githubType,
      page.id,
    );

    // Write sync log
    await insertSyncLog(
      env.DB,
      newMapping.id,
      "github_to_notion",
      "properties",
      currentHash,
    );

    console.log(
      JSON.stringify({
        event: "sync_executed",
        direction: "github_to_notion",
        scope: "properties",
        mapping_id: newMapping.id,
        action: "create",
      }),
    );
  }
}

// ============================================================
// HMAC-SHA256 Signature Verification (Web Crypto API)
// ============================================================

async function verifyGithubSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!signature.startsWith("sha256=")) return false;

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

  const expected =
    "sha256=" +
    Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  return timingSafeEqual(expected, signature);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
