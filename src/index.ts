import { Hono } from "hono";
import type { Bindings } from "./types";
import { GitHubClient } from "./clients/github";
import { NotionClient } from "./clients/notion";
import { githubWebhookRoute } from "./webhooks/github";
import { notionWebhookRoute } from "./webhooks/notion";
import { adminRoutes } from "./admin/routes";
import { processReadyDebounceItems } from "./sync/debounce";

const app = new Hono<{ Bindings: Bindings }>();

// ============================================================
// Health Check
// ============================================================

app.get("/health", async (c) => {
  const env = c.env;

  let dbOk = false;
  try {
    const result = await env.DB.prepare("SELECT 1 as ok").first<{ ok: number }>();
    dbOk = result?.ok === 1;
  } catch {
    dbOk = false;
  }

  let githubOk = false;
  try {
    const github = new GitHubClient(env.GITHUB_TOKEN);
    githubOk = await github.validateConnection();
  } catch {
    githubOk = false;
  }

  let notionOk = false;
  let notionSchemaOk = false;
  try {
    const notion = new NotionClient(env.NOTION_TOKEN, env.NOTION_DATABASE_ID);
    notionOk = await notion.validateConnection();
    if (notionOk) {
      const schema = await notion.validateDatabaseSchema();
      notionSchemaOk = schema.valid;
    }
  } catch {
    notionOk = false;
  }

  const allOk = dbOk && githubOk && notionOk && notionSchemaOk;

  return c.json(
    {
      status: allOk ? "ok" : "degraded",
      checks: {
        db: dbOk,
        github: githubOk,
        notion: notionOk,
        notion_schema: notionSchemaOk,
      },
    },
    allOk ? 200 : 503,
  );
});

// ============================================================
// Webhook Routes
// ============================================================

app.post("/webhook/github", githubWebhookRoute);
app.post("/webhook/notion", notionWebhookRoute);

// ============================================================
// Admin Routes
// ============================================================

app.route("/admin", adminRoutes);

// ============================================================
// Export for Cloudflare Workers
// ============================================================

export default {
  fetch: app.fetch,

  // Cron trigger: process debounce queue
  async scheduled(
    _event: ScheduledEvent,
    env: Bindings,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(processReadyDebounceItems(env));
  },
};
