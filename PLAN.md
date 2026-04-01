# RAG 個人知識庫系統 — 實作計劃

## 問題與目標

建立一個個人 RAG（Retrieval-Augmented Generation）知識庫，整合 HackMD 和 GitHub 的 `.md` 筆記/文件，存入向量資料庫，提供 AI Agent 使用，並透過 `/ask` 指令在 Copilot CLI / Claude Code 中查詢。

---

## 技術選型

| 項目           | 選擇                                   | 說明                                |
| -------------- | -------------------------------------- | ----------------------------------- |
| 後端框架       | NestJS (TypeScript)                    | 模組化架構，適合分離各資料來源      |
| 向量 + 關聯 DB | Supabase pgvector                      | 1 個 DB 同時存向量與同步記錄        |
| 生成回答 LLM   | OpenAI GPT-4o-mini                     | 高 CP 值，約 $0.15/百萬 input token |
| Embedding      | OpenAI text-embedding-3-small          | 極便宜，$0.02/百萬 token，1536 維   |
| 資料來源       | HackMD API + GitHub API (Octokit)      | Phase 1，只抓 .md 檔案              |
| 同步機制       | Webhook 自動觸發                       | HackMD/GitHub 事件觸發更新          |
| 整合方式       | MCP Server + Claude Code Slash Command | 同時支援 Copilot CLI 和 Claude Code |
| 部署           | Zeabur                                 | NestJS backend 容器化部署           |

### 存入 DB 的檔案類型

- **HackMD**：所有筆記（原生 Markdown）
- **GitHub**：只存 `.md` 檔案，排除 `node_modules/`、`dist/`、`.env*`
- 每次回答都包含來源（repo 名稱 + 檔案路徑），方便追溯原始內容

---

## 為什麼用 Monorepo？

本專案有兩個獨立的執行單元，但彼此緊密相關：

| 子專案             | 部署位置    | 用途                                                |
| ------------------ | ----------- | --------------------------------------------------- |
| `apps/backend/`    | Zeabur 雲端 | 核心 API：ingestion、RAG、Webhook                   |
| `apps/mcp-server/` | 本機常駐    | 橋接 AI 工具（Copilot CLI / Claude Code）與後端 API |

放在同一個 repo 的好處：共用型別定義、同步開發、統一版本控制。

---

## 架構概覽

```
使用者 (在 Copilot CLI 或 Claude Code 中)
 │
 ├── /ask "問題"
 │     │
 │     ▼
 │   MCP Server (本機常駐)
 │   └── tool: ask_knowledge_base(query)
 │              │
 │              ▼
 │         NestJS API POST /ask (Zeabur)
 │              │
 │         OpenAI embed 問題 (text-embedding-3-small)
 │              │
 │         Supabase pgvector 相似度搜尋
 │              │
 │         OpenAI GPT-4o-mini 生成回答
 │              └──→ 回傳答案 + 來源（repo/檔案路徑）
 │
 ├── HackMD Webhook ──→ POST /webhooks/hackmd
 │                             │
 │                    抓取筆記內容 → 切塊 → embed → upsert
 │
 └── GitHub Webhook ──→ POST /webhooks/github
                              │
                     只處理 .md 檔 push 異動 → 切塊 → embed → upsert
```

### /ask 整合方式

**GitHub Copilot CLI**：透過 `/mcp` 指令註冊本機 MCP server，之後直接在對話中呼叫 `ask_knowledge_base` tool，或輸入 `/ask 問題` 觸發。

**Claude Code**：

1. MCP 設定（`~/.claude/mcp.json`）— 同 Copilot CLI 共用同一個 MCP server
2. Slash command（`.claude/commands/ask.md`）— 輸入 `/ask 問題` 時，Claude 自動呼叫 MCP tool 並格式化回傳結果

---

## 專案結構

```
rag-kb/
├── apps/
│   ├── backend/             # NestJS 後端（部署 Zeabur）
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── config/          # 環境變數管理
│   │   │   │   ├── supabase/        # Supabase client + pgvector ops
│   │   │   │   ├── embedding/       # OpenAI text-embedding-3-small
│   │   │   │   ├── ingestion/       # 文件切塊 + 嵌入 pipeline
│   │   │   │   ├── sources/
│   │   │   │   │   ├── hackmd/      # HackMD API 整合
│   │   │   │   │   └── github/      # GitHub API 整合 (Octokit，只抓 .md)
│   │   │   │   ├── agent/           # RAG 查詢引擎 (GPT-4o-mini)
│   │   │   │   └── webhooks/        # Webhook handlers
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   ├── .env.example
│   │   ├── package.json
│   │   └── Dockerfile
│   └── mcp-server/          # MCP Server（本機常駐）
│       ├── src/
│       │   └── index.ts     # MCP tools: ask_knowledge_base, sync_knowledge
│       └── package.json
├── configs/                 # AI 工具設定範本
│   ├── copilot-mcp.json     # Copilot CLI MCP 設定範本
│   └── claude/
│       ├── mcp.json         # Claude Code MCP 設定範本
│       └── commands/
│           └── ask.md       # Claude Code /ask slash command
├── supabase/
│   └── migrations/
│       └── 001_init.sql     # documents + sync_logs 表格 + pgvector
└── README.md
```

---

## Supabase 資料庫 Schema

```sql
-- 啟用 pgvector 擴充
create extension if not exists vector;

-- 文件向量表
create table documents (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,   -- 'hackmd' | 'github'
  source_id text not null,     -- HackMD note ID / GitHub file path
  title text,
  content text not null,       -- chunk 文字
  embedding vector(1536),      -- text-embedding-3-small 維度
  metadata jsonb,              -- { url, repo, branch, file_path, author... }
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(source_type, source_id, content)  -- 避免重複
);

-- 同步記錄表
create table sync_logs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id text,
  status text not null,        -- 'success' | 'error'
  message text,
  synced_at timestamptz default now()
);

-- 相似度搜尋 function
create function match_documents(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (id uuid, content text, metadata jsonb, similarity float)
language sql stable as $$
  select id, content, metadata, 1 - (embedding <=> query_embedding) as similarity
  from documents
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

---

## 實作 Todos（18 項，7 個階段）

### Phase 1: 基礎建設

1. **project-scaffold** — 初始化 monorepo（`apps/backend` NestJS + `apps/mcp-server` TypeScript）
2. **supabase-schema** — 建立 `supabase/migrations/001_init.sql`，啟用 pgvector，建立 documents 和 sync_logs 表
3. **config-module** — NestJS `ConfigModule`，型別安全地載入 .env 環境變數
4. **supabase-module** — `@supabase/supabase-js` client，封裝 `upsertDocuments()` 和 `matchDocuments(embedding)` 方法
5. **embedding-service** — OpenAI `text-embedding-3-small`，支援單筆與批次，加入 retry 與 rate limit 處理

### Phase 2: 資料來源整合

6. **hackmd-source** — HackMD API Token，取得所有筆記清單與 markdown 內容
7. **github-source** — Octokit，抓取 `GITHUB_REPOS` 設定的 repos 中所有 `.md` 檔案（排除 `node_modules/`, `dist/`, `.env*`）

### Phase 3: Ingestion Pipeline

8. **ingestion-pipeline** — RecursiveTextSplitter（512 token, 50 overlap）→ batch embed → upsert Supabase，寫入 sync_logs

### Phase 4: Webhook 自動同步

9. **webhook-hackmd** — 驗證 webhook secret，接收 HackMD publish 事件 → 觸發該筆記 ingestion
10. **webhook-github** — 驗證 HMAC-SHA256 signature，監聽 push 事件，只處理 `.md` 檔案變更

### Phase 5: RAG Agent + API

11. **agent-module** — query → embed → `match_documents` → 組 prompt context → GPT-4o-mini → 回傳答案 + 來源
12. **ask-api** — `POST /ask { query: string }` → `{ answer: string, sources: Source[] }`
13. **sync-api** — `POST /sync?source=hackmd|github` 手動觸發全量同步

### Phase 6: MCP Server + AI 工具整合

14. **mcp-server** — `@modelcontextprotocol/sdk`，暴露 `ask_knowledge_base(query)` 和 `sync_knowledge(source?)` tools
15. **claude-slash-command** — `configs/claude/commands/ask.md`，定義 `/ask $ARGUMENTS` slash command
16. **mcp-configs** — `configs/copilot-mcp.json` + `configs/claude/mcp.json` 範本，附安裝說明

### Phase 7: 部署

17. **dockerfile** — `apps/backend/Dockerfile`，multi-stage build，基於 node:20-alpine
18. **zeabur-config** — `zbpack.json` 設定，README.md 撰寫完整部署與環境變數說明

---

## 環境變數清單（.env.example）

```env
# OpenAI
OPENAI_API_KEY=

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# HackMD
HACKMD_API_TOKEN=

# GitHub
GITHUB_TOKEN=
GITHUB_REPOS=owner/repo1,owner/repo2   # 要同步的 repos，逗號分隔

# Webhook 安全
HACKMD_WEBHOOK_SECRET=
GITHUB_WEBHOOK_SECRET=

# Backend
BACKEND_URL=https://your-app.zeabur.app  # MCP server 呼叫用
PORT=3000
```

---

## 備注

- **HackMD Webhook**：需使用 [HackMD API](https://hackmd.io/@hackmd-api/developer-portal)，觸發條件為筆記發佈/更新。
- **GitHub Webhook**：監聽 `push` 事件，只處理 `.md` 檔案異動，排除 `node_modules/`, `dist/`, `.env*`。
- **Chunking 策略**：每 chunk 約 512 token，overlap 50 token；回答附上 `metadata.file_path` 與 `metadata.repo` 讓使用者可追溯原始位置。
- **未來擴充（Phase 2+）**：Notion、自建雲端筆記站（RESTful API + Webhook）。
