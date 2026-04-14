import { Hono } from "hono";
import type { Bindings } from "../types";
import {
  listMappings,
  countSyncLogsLast24h,
  countImages,
  countPendingDebounce,
  findMapping,
  findMappingByNotion,
  insertSyncLog,
} from "../db/queries";
import { GitHubClient } from "../clients/github";
import { NotionClient } from "../clients/notion";
import { computePropertiesHash } from "../sync/hash";
import {
  githubToNotionProperties,
  parseNotionProperties,
  notionToGithubProperties,
  deriveStatus,
} from "../sync/properties";
import { syncNotionToGithubBody } from "../sync/body";

export const adminRoutes = new Hono<{ Bindings: Bindings }>();

// ============================================================
// GET /admin/mappings
// ============================================================

adminRoutes.get("/mappings", async (c) => {
  const limit = parseInt(c.req.query("limit") ?? "100", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  const { items, total } = await listMappings(c.env.DB, limit, offset);

  return c.json({ total, items });
});

// ============================================================
// POST /admin/resync
// ============================================================

adminRoutes.post("/resync", async (c) => {
  const body = await c.req.json<{
    repo?: string;
    number?: number;
    notion_page_id?: string;
    direction: "github_to_notion" | "notion_to_github" | "both";
    scope: "properties" | "body" | "all";
  }>();

  // Find mapping by GitHub or Notion identifier
  let mapping;
  if (body.repo && body.number) {
    mapping = await findMapping(c.env.DB, body.repo, body.number);
  } else if (body.notion_page_id) {
    mapping = await findMappingByNotion(c.env.DB, body.notion_page_id);
  }

  if (!mapping) {
    return c.json({ error: "Mapping not found" }, 404);
  }

  const env = c.env;

  // Process resync in background
  c.executionCtx.waitUntil(
    (async () => {
      const directions: string[] = [];
      if (body.direction === "both") {
        directions.push("github_to_notion", "notion_to_github");
      } else {
        directions.push(body.direction);
      }

      for (const direction of directions) {
        try {
          if (
            direction === "github_to_notion" &&
            (body.scope === "properties" || body.scope === "all")
          ) {
            await resyncGithubToNotion(env, mapping);
          }

          if (
            direction === "notion_to_github" &&
            (body.scope === "properties" || body.scope === "all")
          ) {
            await resyncNotionToGithub(env, mapping);
          }

          if (
            direction === "notion_to_github" &&
            (body.scope === "body" || body.scope === "all")
          ) {
            await syncNotionToGithubBody(env, mapping.notion_page_id);
          }
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "resync_failed",
              direction,
              scope: body.scope,
              mapping_id: mapping.id,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }
    })(),
  );

  return c.json(
    {
      ok: true,
      mapping_id: mapping.id,
      direction: body.direction,
      scope: body.scope,
    },
    202,
  );
});

// ============================================================
// GET /admin/stats
// ============================================================

adminRoutes.get("/stats", async (c) => {
  const [mappingsResult, syncLogs24h, images, debouncePending] =
    await Promise.all([
      listMappings(c.env.DB, 1, 0),
      countSyncLogsLast24h(c.env.DB),
      countImages(c.env.DB),
      countPendingDebounce(c.env.DB),
    ]);

  return c.json({
    mappings_count: mappingsResult.total,
    sync_logs_last_24h: syncLogs24h,
    images_cached: images.count,
    images_size_bytes: images.total_size,
    debounce_pending: debouncePending,
  });
});

// ============================================================
// Internal helpers for forced resync
// ============================================================

async function resyncGithubToNotion(
  env: Bindings,
  mapping: { id: number; github_repo: string; github_number: number; github_type: string; notion_page_id: string },
): Promise<void> {
  const github = new GitHubClient(env.GITHUB_TOKEN);
  const notion = new NotionClient(env.NOTION_TOKEN, env.NOTION_DATABASE_ID);

  const item = await github.getIssue(mapping.github_repo, mapping.github_number);
  const labels = item.labels.map((l) =>
    typeof l === "string" ? l : (l.name ?? ""),
  );
  const assignees = (item.assignees ?? []).map((a) =>
    typeof a === "string" ? a : (a.login ?? ""),
  );
  const status = deriveStatus(item);
  const hash = await computePropertiesHash(
    item.title,
    status,
    labels,
    assignees,
  );

  const properties = githubToNotionProperties(
    {
      number: item.number,
      title: item.title,
      html_url: item.html_url,
      state: item.state ?? "open",
      labels: labels.map((name) => ({ name })),
      assignees: assignees.map((login) => ({ login })),
      created_at: item.created_at,
      updated_at: item.updated_at,
    },
    mapping.github_repo,
    mapping.github_type as "issue" | "pr",
    hash,
  );

  await notion.updatePage(mapping.notion_page_id, properties);
  await insertSyncLog(env.DB, mapping.id, "github_to_notion", "properties", hash);
}

async function resyncNotionToGithub(
  env: Bindings,
  mapping: { id: number; github_repo: string; github_number: number; notion_page_id: string },
): Promise<void> {
  const github = new GitHubClient(env.GITHUB_TOKEN);
  const notion = new NotionClient(env.NOTION_TOKEN, env.NOTION_DATABASE_ID);

  const page = await notion.getPage(mapping.notion_page_id);
  const props = parseNotionProperties(page.properties as Record<string, unknown>);
  const githubProps = notionToGithubProperties(props);

  const hash = await computePropertiesHash(
    props.title,
    props.status,
    props.labels,
    props.assignees,
  );

  await github.updateIssue(mapping.github_repo, mapping.github_number, {
    title: githubProps.title,
    state: githubProps.state,
    labels: githubProps.labels,
    assignees: githubProps.assignees,
  });

  await insertSyncLog(env.DB, mapping.id, "notion_to_github", "properties", hash);
}
