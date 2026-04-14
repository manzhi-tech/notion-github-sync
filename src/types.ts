// ============================================================
// Cloudflare Workers Bindings
// ============================================================

export type Bindings = {
  DB: D1Database;
  IMAGES: R2Bucket;

  // Secrets (set via `wrangler secret put`)
  GITHUB_TOKEN: string;
  GH_WEBHOOK_SECRET: string;
  NOTION_TOKEN: string;
  NOTION_WEBHOOK_SECRET: string;

  // Vars (set in wrangler.toml)
  NOTION_DATABASE_ID: string;
  GITHUB_REPOS: string; // comma-separated "owner/repo,owner/repo2"
  SYNC_ECHO_WINDOW_SECONDS: string;
  SYNC_BODY_DEBOUNCE_SECONDS: string;
  SYNC_SKIP_LABEL: string;
  SYNC_IMAGE_STRATEGY: string; // "upload_to_repo" | "r2" | "placeholder"
  SYNC_IMAGE_REPO_PATH: string;
  SYNC_IMAGE_MAX_SIZE_MB: string;
};

// ============================================================
// Database Record Types
// ============================================================

export interface Mapping {
  id: number;
  github_repo: string;
  github_number: number;
  github_type: "issue" | "pr";
  notion_page_id: string;
  created_at: string;
  last_body_hash: string | null;
  last_body_sync_at: string | null;
}

export interface SyncLog {
  id: number;
  mapping_id: number;
  direction: "github_to_notion" | "notion_to_github";
  scope: "properties" | "body";
  content_hash: string;
  synced_at: string;
}

export interface ImageMapping {
  id: number;
  content_hash: string;
  permanent_url: string;
  size_bytes: number | null;
  mime_type: string | null;
  uploaded_at: string;
}

export interface DebounceEntry {
  id: number;
  key: string;
  event_type: string;
  payload: string; // JSON
  scheduled_at: string;
  created_at: string;
}

// ============================================================
// Sync Types
// ============================================================

export type SyncDirection = "github_to_notion" | "notion_to_github";
export type SyncScope = "properties" | "body";
export type GithubType = "issue" | "pr";

export interface GitHubEventPayload {
  action: string;
  repository: {
    full_name: string;
  };
  issue?: GitHubIssuePayload;
  pull_request?: GitHubPullRequestPayload;
}

export interface GitHubIssuePayload {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  created_at: string;
  updated_at: string;
}

export interface GitHubPullRequestPayload {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  draft: boolean;
  merged: boolean;
  merged_at: string | null;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  created_at: string;
  updated_at: string;
}

export interface NotionWebhookPayload {
  type: string;
  data: {
    id: string;
    parent?: {
      database_id?: string;
    };
  };
}

// ============================================================
// Body Sync Config
// ============================================================

export const BODY_START_MARKER =
  "<!-- SYNCED FROM NOTION — DO NOT EDIT BELOW THIS LINE -->";
export const BODY_END_MARKER = "<!-- END SYNCED CONTENT -->";
export const BODY_WARNING_TEXT =
  "此内容由 Notion 自动同步,请勿直接编辑。修改请去 Notion 页面。";

export const UNSUPPORTED_PLACEHOLDER =
  "_[此处内容暂不支持同步,请在 Notion 查看]_";

export const BLOCK_WHITELIST = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "code",
  "quote",
  "divider",
  "image",
  "callout",
  "toggle",
  "table",
  "bookmark",
  "link_preview",
  "equation",
]);

export const IMAGE_PLACEHOLDER_TEMPLATE =
  "> \u{1F5BC}\uFE0F 图片请在 Notion 查看:{notion_page_url}";

export const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);
