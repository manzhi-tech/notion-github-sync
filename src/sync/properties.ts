import type { GithubType } from "../types";

// ============================================================
// Fixed Field Mapping (per spec §5)
// ============================================================

export const FIELD_MAPPING = {
  title: "Name",
  github_id: "GitHub ID",
  github_url: "GitHub URL",
  github_type: "GitHub Type",
  repo: "Repo",
  status: "Status",
  labels: "Labels",
  assignees: "Assignees",
  created_at: "Created At",
  updated_at: "Updated At",
  sync_hash: "Sync Hash",
  last_synced_by: "Last Synced By",
  last_synced_at: "Last Synced At",
} as const;

export const STATUS_MAPPING: Record<string, string> = {
  open: "Open",
  closed: "Closed",
  merged: "Merged",
  draft: "Draft",
};

// Reverse: Notion status → GitHub state
const REVERSE_STATUS_MAPPING: Record<string, string> = {
  Open: "open",
  Closed: "closed",
  Merged: "closed",
  Draft: "open",
};

// ============================================================
// Derive GitHub item status
// ============================================================

export function deriveStatus(item: {
  state: string;
  draft?: boolean;
  merged?: boolean;
  merged_at?: string | null;
}): string {
  if (item.merged || item.merged_at) return "Merged";
  if (item.draft) return "Draft";
  return STATUS_MAPPING[item.state] ?? "Open";
}

// ============================================================
// GitHub → Notion Properties
// ============================================================

export function githubToNotionProperties(
  item: {
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
  },
  repo: string,
  githubType: GithubType,
  syncHash: string,
): Record<string, unknown> {
  const status = deriveStatus(item);

  const properties: Record<string, unknown> = {
    [FIELD_MAPPING.title]: {
      title: [{ text: { content: item.title } }],
    },
    [FIELD_MAPPING.github_id]: {
      number: item.number,
    },
    [FIELD_MAPPING.github_url]: {
      url: item.html_url,
    },
    [FIELD_MAPPING.github_type]: {
      select: { name: githubType },
    },
    [FIELD_MAPPING.repo]: {
      select: { name: repo },
    },
    [FIELD_MAPPING.status]: {
      status: { name: status },
    },
    [FIELD_MAPPING.labels]: {
      multi_select: item.labels.map((l) => ({ name: l.name })),
    },
    [FIELD_MAPPING.assignees]: {
      multi_select: item.assignees.map((a) => ({ name: a.login })),
    },
    [FIELD_MAPPING.created_at]: {
      date: { start: item.created_at },
    },
    [FIELD_MAPPING.updated_at]: {
      date: { start: item.updated_at },
    },
    [FIELD_MAPPING.sync_hash]: {
      rich_text: [{ text: { content: syncHash } }],
    },
    [FIELD_MAPPING.last_synced_by]: {
      select: { name: "github" },
    },
    [FIELD_MAPPING.last_synced_at]: {
      date: { start: new Date().toISOString() },
    },
  };

  return properties;
}

// ============================================================
// Notion → GitHub Properties
// ============================================================

export interface ParsedNotionProperties {
  title: string;
  status: string;
  labels: string[];
  assignees: string[];
  repo: string | null;
  githubType: GithubType | null;
  githubNumber: number | null;
  lastSyncedBy: string | null;
}

export function parseNotionProperties(
  properties: Record<string, unknown>,
): ParsedNotionProperties {
  return {
    title: extractTitle(properties[FIELD_MAPPING.title]),
    status: extractStatus(properties[FIELD_MAPPING.status]),
    labels: extractMultiSelect(properties[FIELD_MAPPING.labels]),
    assignees: extractMultiSelect(properties[FIELD_MAPPING.assignees]),
    repo: extractSelect(properties[FIELD_MAPPING.repo]),
    githubType: extractSelect(properties[FIELD_MAPPING.github_type]) as GithubType | null,
    githubNumber: extractNumber(properties[FIELD_MAPPING.github_id]),
    lastSyncedBy: extractSelect(properties[FIELD_MAPPING.last_synced_by]),
  };
}

export function notionToGithubProperties(parsed: ParsedNotionProperties): {
  title: string;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
} {
  const state = mapStatusToState(parsed.status);
  return {
    title: parsed.title,
    state,
    labels: parsed.labels,
    assignees: parsed.assignees,
  };
}

export function mapStatusToState(notionStatus: string): "open" | "closed" {
  const state = REVERSE_STATUS_MAPPING[notionStatus];
  if (state === "closed") return "closed";
  return "open";
}

// ============================================================
// Notion Property Extractors
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTitle(prop: any): string {
  if (!prop?.title) return "";
  return prop.title.map((t: { plain_text: string }) => t.plain_text).join("");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractStatus(prop: any): string {
  return prop?.status?.name ?? "Open";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSelect(prop: any): string | null {
  return prop?.select?.name ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMultiSelect(prop: any): string[] {
  if (!prop?.multi_select) return [];
  return prop.multi_select.map((s: { name: string }) => s.name);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractNumber(prop: any): number | null {
  return prop?.number ?? null;
}
