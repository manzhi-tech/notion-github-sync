import type { SyncDirection } from "../types";
import { findRecentSyncLog } from "../db/queries";

/**
 * Compute SHA-256 hash of properties for anti-loop detection.
 * Only hashes fields that participate in sync.
 */
export async function computePropertiesHash(
  title: string,
  status: string,
  labels: string[],
  assignees: string[],
): Promise<string> {
  const normalized = {
    title: title.trim(),
    status,
    labels: [...labels].sort(),
    assignees: [...assignees].sort(),
  };
  const data = JSON.stringify(normalized, null, 0);
  return sha256(data);
}

/**
 * Compute SHA-256 hash of markdown body content.
 * Normalizes whitespace before hashing.
 */
export async function computeBodyHash(markdown: string): Promise<string> {
  const normalized = markdown.replace(/\s+/g, " ").trim();
  return sha256(normalized);
}

/**
 * Three-layer echo detection:
 * 1. Time window: check if opposite-direction sync happened within echo_window_seconds
 * 2. Content hash: compare with last sync log hash
 * 3. Combined: both conditions must be true to consider it an echo
 */
export async function isEcho(
  db: D1Database,
  mappingId: number,
  direction: SyncDirection,
  currentHash: string,
  echoWindowSeconds: number,
): Promise<boolean> {
  const reverseDirection: SyncDirection =
    direction === "github_to_notion"
      ? "notion_to_github"
      : "github_to_notion";

  const lastLog = await findRecentSyncLog(db, mappingId, reverseDirection);

  if (!lastLog) {
    return false;
  }

  // Check time window
  const syncedAt = new Date(lastLog.synced_at + "Z").getTime();
  const now = Date.now();
  const ageSeconds = (now - syncedAt) / 1000;

  if (ageSeconds < echoWindowSeconds && lastLog.content_hash === currentHash) {
    return true;
  }

  return false;
}

// ============================================================
// SHA-256 helper using Web Crypto API
// ============================================================

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
