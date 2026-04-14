# Notion ↔ GitHub 双向同步服务

Webhook 驱动的同步服务，在 Notion 数据库和 GitHub issues/PRs 之间保持数据一致。部署在 Cloudflare Workers 免费套餐上。

## 功能

- **Properties 双向同步**：Notion 数据库字段 ↔ GitHub issue/PR 属性（title、state、labels、assignees 等）
- **Body 单向同步**：Notion 页面内容 → GitHub issue/PR body（Markdown 格式）
- **图片同步**：Notion 正文图片 → 上传到 GitHub repo 的 `.notion-assets/` 目录
- **防循环**：三层防护（时间窗口 + 内容 hash + 标记字段）
- **映射管理**：Cloudflare D1 维护 Notion page 和 GitHub issue/PR 的对应关系

## 技术栈

| 组件 | 选型 |
|------|------|
| 语言 | TypeScript |
| 运行时 | Cloudflare Workers |
| Web 框架 | Hono |
| GitHub SDK | @octokit/rest |
| Notion SDK | @notionhq/client |
| 数据库 | Cloudflare D1 (边缘 SQLite) |
| 图片存储 | GitHub repo / Cloudflare R2 |
| 测试 | vitest |

## 快速开始

### 前置要求

- Node.js 18+
- Cloudflare 账号（免费）
- GitHub Personal Access Token
- Notion Integration Token

### 安装

```bash
npm install
```

### 本地开发

```bash
# 创建本地 D1 数据库并初始化
npm run db:init:local

# 创建 .dev.vars 文件放入 secrets
cat > .dev.vars << 'EOF'
GITHUB_TOKEN=ghp_your_token
GH_WEBHOOK_SECRET=your_webhook_secret
NOTION_TOKEN=ntn_your_token
NOTION_WEBHOOK_SECRET=your_notion_secret
EOF

# 启动本地开发服务器
npm run dev
```

### 运行测试

```bash
npm test
```

### 部署到 Cloudflare

```bash
# 登录
npx wrangler login

# 创建 D1 数据库
npx wrangler d1 create notion-github-sync
# 将返回的 database_id 更新到 wrangler.toml

# 初始化表结构
npm run db:init

# 创建 R2 存储桶（可选，用于图片存储）
npx wrangler r2 bucket create notion-assets

# 设置 Secrets
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put GH_WEBHOOK_SECRET
npx wrangler secret put NOTION_TOKEN

# 部署
npm run deploy
```

部署后得到 URL：`https://notion-github-sync.<account>.workers.dev`

### 配置 Webhooks

**GitHub**（每个 repo）：
1. Settings → Webhooks → Add webhook
2. Payload URL：`https://your-url/webhook/github`
3. Content type：`application/json`
4. Secret：和 `GH_WEBHOOK_SECRET` 一致
5. 事件：Issues、Pull requests

**Notion**：
1. https://www.notion.so/my-integrations
2. 启用 webhook，URL：`https://your-url/webhook/notion`
3. 订阅 page 相关事件

## API 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/webhook/github` | POST | GitHub webhook |
| `/webhook/notion` | POST | Notion webhook |
| `/admin/mappings` | GET | 查看所有映射 |
| `/admin/resync` | POST | 手动触发重新同步 |
| `/admin/stats` | GET | 同步统计 |

## Notion 数据库字段

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| Name | Title | ✅ | 任务标题 |
| GitHub ID | Number | ✅ | issue/PR number |
| GitHub URL | URL | ✅ | 完整链接 |
| GitHub Type | Select | ✅ | `issue` / `pr` |
| Repo | Select | ✅ | `owner/repo` |
| Status | Status | ✅ | `Open` / `Closed` / `Merged` / `Draft` |
| Labels | Multi-select | | GitHub labels |
| Assignees | Multi-select | | GitHub usernames |
| Created At | Date | | 创建时间 |
| Updated At | Date | | 更新时间 |
| Sync Hash | Text | | 内部使用 |
| Last Synced By | Select | | `github` / `notion` |
| Last Synced At | Date | | 最后同步时间 |

## License

AGPL-3.0
