import type {
  Mapping,
  SyncLog,
  ImageMapping,
  DebounceEntry,
  SyncDirection,
  SyncScope,
  GithubType,
} from "../types";

// ============================================================
// Mappings
// ============================================================

export async function findMapping(
  db: D1Database,
  repo: string,
  number: number,
): Promise<Mapping | null> {
  return db
    .prepare(
      "SELECT * FROM mappings WHERE github_repo = ? AND github_number = ?",
    )
    .bind(repo, number)
    .first<Mapping>();
}

export async function findMappingByNotion(
  db: D1Database,
  notionPageId: string,
): Promise<Mapping | null> {
  return db
    .prepare("SELECT * FROM mappings WHERE notion_page_id = ?")
    .bind(notionPageId)
    .first<Mapping>();
}

export async function insertMapping(
  db: D1Database,
  repo: string,
  number: number,
  type: GithubType,
  notionPageId: string,
): Promise<Mapping> {
  const result = await db
    .prepare(
      `INSERT INTO mappings (github_repo, github_number, github_type, notion_page_id)
       VALUES (?, ?, ?, ?)
       RETURNING *`,
    )
    .bind(repo, number, type, notionPageId)
    .first<Mapping>();
  return result!;
}

export async function updateMappingBodyHash(
  db: D1Database,
  mappingId: number,
  bodyHash: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE mappings SET last_body_hash = ?, last_body_sync_at = datetime('now') WHERE id = ?`,
    )
    .bind(bodyHash, mappingId)
    .run();
}

export async function listMappings(
  db: D1Database,
  limit: number = 100,
  offset: number = 0,
): Promise<{ items: Mapping[]; total: number }> {
  const countResult = await db
    .prepare("SELECT COUNT(*) as total FROM mappings")
    .first<{ total: number }>();
  const items = await db
    .prepare("SELECT * FROM mappings ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .bind(limit, offset)
    .all<Mapping>();
  return { items: items.results, total: countResult?.total ?? 0 };
}

// ============================================================
// Sync Logs
// ============================================================

export async function insertSyncLog(
  db: D1Database,
  mappingId: number,
  direction: SyncDirection,
  scope: SyncScope,
  contentHash: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_logs (mapping_id, direction, scope, content_hash)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(mappingId, direction, scope, contentHash)
    .run();
}

export async function findRecentSyncLog(
  db: D1Database,
  mappingId: number,
  direction: SyncDirection,
): Promise<SyncLog | null> {
  return db
    .prepare(
      `SELECT * FROM sync_logs
       WHERE mapping_id = ? AND direction = ?
       ORDER BY synced_at DESC LIMIT 1`,
    )
    .bind(mappingId, direction)
    .first<SyncLog>();
}

export async function countSyncLogsLast24h(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `SELECT COUNT(*) as count FROM sync_logs
       WHERE synced_at > datetime('now', '-1 day')`,
    )
    .first<{ count: number }>();
  return result?.count ?? 0;
}

// ============================================================
// Image Mappings
// ============================================================

export async function findImageByHash(
  db: D1Database,
  contentHash: string,
): Promise<ImageMapping | null> {
  return db
    .prepare("SELECT * FROM image_mappings WHERE content_hash = ?")
    .bind(contentHash)
    .first<ImageMapping>();
}

export async function insertImageMapping(
  db: D1Database,
  contentHash: string,
  permanentUrl: string,
  sizeBytes: number | null,
  mimeType: string | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO image_mappings (content_hash, permanent_url, size_bytes, mime_type)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(contentHash, permanentUrl, sizeBytes, mimeType)
    .run();
}

export async function countImages(
  db: D1Database,
): Promise<{ count: number; total_size: number }> {
  const result = await db
    .prepare(
      "SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total_size FROM image_mappings",
    )
    .first<{ count: number; total_size: number }>();
  return result ?? { count: 0, total_size: 0 };
}

// ============================================================
// Debounce Queue
// ============================================================

export async function upsertDebounceEntry(
  db: D1Database,
  key: string,
  eventType: string,
  payload: string,
  scheduledAt: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO debounce_queue (key, event_type, payload, scheduled_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         payload = excluded.payload,
         scheduled_at = excluded.scheduled_at`,
    )
    .bind(key, eventType, payload, scheduledAt)
    .run();
}

export async function getReadyDebounceEntries(
  db: D1Database,
): Promise<DebounceEntry[]> {
  const result = await db
    .prepare(
      `SELECT * FROM debounce_queue WHERE scheduled_at <= datetime('now')`,
    )
    .all<DebounceEntry>();
  return result.results;
}

export async function deleteDebounceEntry(
  db: D1Database,
  id: number,
): Promise<void> {
  await db.prepare("DELETE FROM debounce_queue WHERE id = ?").bind(id).run();
}

export async function countPendingDebounce(db: D1Database): Promise<number> {
  const result = await db
    .prepare("SELECT COUNT(*) as count FROM debounce_queue")
    .first<{ count: number }>();
  return result?.count ?? 0;
}
