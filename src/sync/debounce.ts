import type { Bindings } from "../types";
import {
  getReadyDebounceEntries,
  deleteDebounceEntry,
  upsertDebounceEntry,
} from "../db/queries";
import { syncNotionToGithubBody } from "./body";

/**
 * Schedule a body sync for a Notion page.
 * Uses D1-based debounce: writes/updates debounce_queue with
 * scheduled_at = now + debounce_seconds.
 */
export async function scheduleBodySync(
  db: D1Database,
  pageId: string,
  debounceSeconds: number,
): Promise<void> {
  const key = `notion_body:${pageId}`;
  const scheduledAt = new Date(
    Date.now() + debounceSeconds * 1000,
  ).toISOString();

  await upsertDebounceEntry(
    db,
    key,
    "body_sync",
    JSON.stringify({ page_id: pageId }),
    scheduledAt,
  );

  console.log(
    JSON.stringify({
      event: "debounce_scheduled",
      key,
      scheduled_at: scheduledAt,
    }),
  );
}

/**
 * Process all ready debounce entries.
 * Called by Cron Trigger (every minute).
 */
export async function processReadyDebounceItems(
  env: Bindings,
): Promise<void> {
  const entries = await getReadyDebounceEntries(env.DB);

  if (entries.length === 0) return;

  console.log(
    JSON.stringify({
      event: "debounce_processing",
      count: entries.length,
    }),
  );

  for (const entry of entries) {
    try {
      const payload = JSON.parse(entry.payload);

      if (entry.event_type === "body_sync") {
        await syncNotionToGithubBody(env, payload.page_id);
      }

      await deleteDebounceEntry(env.DB, entry.id);

      console.log(
        JSON.stringify({
          event: "debounce_processed",
          key: entry.key,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "debounce_handler_failed",
          key: entry.key,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      // Don't delete failed entries; they'll be retried next cron run
    }
  }
}
