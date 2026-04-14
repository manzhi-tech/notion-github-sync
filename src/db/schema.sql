-- 映射表：Notion page ↔ GitHub issue/PR
CREATE TABLE IF NOT EXISTS mappings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  github_repo         TEXT NOT NULL,
  github_number       INTEGER NOT NULL,
  github_type         TEXT NOT NULL,
  notion_page_id      TEXT NOT NULL UNIQUE,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_body_hash      TEXT,
  last_body_sync_at   DATETIME,
  UNIQUE(github_repo, github_number)
);

CREATE INDEX IF NOT EXISTS idx_mappings_notion ON mappings(notion_page_id);
CREATE INDEX IF NOT EXISTS idx_mappings_github ON mappings(github_repo, github_number);

-- 同步日志：用于防回声 + 调试
CREATE TABLE IF NOT EXISTS sync_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_id      INTEGER NOT NULL,
  direction       TEXT NOT NULL,
  scope           TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  synced_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(mapping_id) REFERENCES mappings(id)
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_mapping ON sync_logs(mapping_id, synced_at DESC);

-- 图片缓存：去重 + 避免重复上传
CREATE TABLE IF NOT EXISTS image_mappings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  content_hash    TEXT NOT NULL UNIQUE,
  permanent_url   TEXT NOT NULL,
  size_bytes      INTEGER,
  mime_type       TEXT,
  uploaded_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 防抖队列持久化
CREATE TABLE IF NOT EXISTS debounce_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT NOT NULL UNIQUE,
  event_type      TEXT NOT NULL,
  payload         TEXT NOT NULL,
  scheduled_at    DATETIME NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
