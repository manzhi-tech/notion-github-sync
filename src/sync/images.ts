import type { Bindings, ImageMapping } from "../types";
import { ALLOWED_MIME_TYPES } from "../types";
import { findImageByHash, insertImageMapping } from "../db/queries";
import { GitHubClient } from "../clients/github";
import type { BlockWithChildren } from "../clients/notion";

/**
 * Process images from Notion blocks.
 * Downloads Notion-hosted images, uploads to GitHub repo, returns URL mapping.
 */
export async function processImages(
  blocks: BlockWithChildren[],
  env: Bindings,
  repo: string,
): Promise<Record<string, string>> {
  const imageUrls = collectImageUrls(blocks);
  if (imageUrls.length === 0) return {};

  const github = new GitHubClient(env.GITHUB_TOKEN);
  const maxSizeMb = parseInt(env.SYNC_IMAGE_MAX_SIZE_MB, 10) || 50;
  const repoPath = env.SYNC_IMAGE_REPO_PATH || ".notion-assets";
  const concurrency = 4;

  const urlMap: Record<string, string> = {};

  // Process in batches for concurrency control
  for (let i = 0; i < imageUrls.length; i += concurrency) {
    const batch = imageUrls.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((entry) =>
        processOneImage(entry, env.DB, github, repo, repoPath, maxSizeMb),
      ),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const entry = batch[j];
      if (result.status === "fulfilled" && result.value) {
        urlMap[entry.originalUrl] = result.value;
      }
      // On failure, the original URL stays (no mapping), so the image
      // tag will keep the Notion URL (which may expire)
    }
  }

  return urlMap;
}

interface ImageEntry {
  originalUrl: string;
  isNotionHosted: boolean;
}

function collectImageUrls(blocks: BlockWithChildren[]): ImageEntry[] {
  const entries: ImageEntry[] = [];

  for (const block of blocks) {
    if (block.type === "image") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (block as any).image;
      if (data.type === "file") {
        entries.push({ originalUrl: data.file.url, isNotionHosted: true });
      }
      // External images keep their URL, no processing needed
    }

    // Recurse into children
    if (block.children?.length) {
      entries.push(...collectImageUrls(block.children));
    }
  }

  return entries;
}

async function processOneImage(
  entry: ImageEntry,
  db: D1Database,
  github: GitHubClient,
  repo: string,
  repoPath: string,
  maxSizeMb: number,
): Promise<string | null> {
  if (!entry.isNotionHosted) return null;

  try {
    // Download image
    const response = await fetch(entry.originalUrl, {
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: "image_download_failed",
          url: entry.originalUrl.slice(0, 100),
          status: response.status,
        }),
      );
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!ALLOWED_MIME_TYPES.has(contentType.split(";")[0].trim())) {
      console.warn(
        JSON.stringify({
          event: "image_mime_rejected",
          mime: contentType,
        }),
      );
      return null;
    }

    const bytes = await response.arrayBuffer();
    const sizeMb = bytes.byteLength / (1024 * 1024);
    if (sizeMb > maxSizeMb) {
      console.warn(
        JSON.stringify({
          event: "image_too_large",
          size_mb: sizeMb.toFixed(2),
          max_mb: maxSizeMb,
        }),
      );
      return null;
    }

    // Compute content hash
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
    const contentHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Check cache
    const cached = await findImageByHash(db, contentHash);
    if (cached) {
      return cached.permanent_url;
    }

    // Determine file extension from content type
    const ext = mimeToExtension(contentType);
    const filePath = `${repoPath}/${contentHash.slice(0, 16)}${ext}`;

    // Upload to GitHub
    const commitMessage = `chore: sync notion image ${contentHash.slice(0, 8)}`;
    const permanentUrl = await github.createOrUpdateFile(
      repo,
      filePath,
      bytes,
      commitMessage,
    );

    // Cache the mapping
    await insertImageMapping(
      db,
      contentHash,
      permanentUrl,
      bytes.byteLength,
      contentType,
    );

    console.log(
      JSON.stringify({
        event: "image_uploaded",
        path: filePath,
        size_bytes: bytes.byteLength,
      }),
    );

    return permanentUrl;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "image_process_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

function mimeToExtension(mimeType: string): string {
  const base = mimeType.split(";")[0].trim();
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
  };
  return map[base] ?? ".png";
}
