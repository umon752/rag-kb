# RAG 知識庫

個人 RAG（Retrieval-Augmented Generation）知識庫，整合 HackMD 筆記與 GitHub `.md` 檔案，透過向量搜尋提供 AI Agent 查詢，支援 GitHub Copilot CLI 的 `/ask` 指令。

---

## 技術架構

| 元件 | 技術 |
|------|------|
| 後端 API | NestJS (TypeScript) |
| 向量資料庫 | Supabase pgvector (HNSW index) |
| Embedding 模型 | OpenAI text-embedding-3-small |
| LLM | OpenAI GPT-4o-mini |
| 資料來源 | HackMD API、GitHub API |
| MCP Server | 本地 daemon，供 Copilot CLI / Claude Code 使用 |
| 部署 | Zeabur |

---

## 專案結構

```
rag-kb/
├── apps/
│   ├── backend/          # NestJS 後端 API
│   └── mcp-server/       # MCP Server（本地 daemon）
├── PLAN.md               # 專案完整規劃
├── PHASE1.md             # Phase 1 實作步驟（已完成）
├── PHASE2.md             # Phase 2 實作步驟（已完成）
├── PHASE3.md             # Phase 3 實作步驟（已完成）
└── PHASE4.md             # Phase 4 實作步驟（進行中）
```

---

## 實作進度

### ✅ Phase 1 — 基礎建設（已完成）
- Step 1：NestJS 專案建立
- Step 2：Supabase schema + HNSW index
- Step 3：ConfigModule（`.env` 管理）
- Step 4：SupabaseService
- Step 5：EmbeddingService（text-embedding-3-small，batch 支援）

### ✅ Phase 2 — 資料來源（已完成）
- Step 6：HackMD Source Module（使用 Node.js 內建 fetch）
- Step 7：GitHub Source Module（topic-based 自動發現 repo）

### ✅ Phase 3 — Ingestion Pipeline（已完成）
- Step 8：文件切塊（`@langchain/textsplitters`）→ embed → 先刪後寫 → 存 Supabase

### 🔄 Phase 4 — Webhook 自動同步（進行中）
- Step 9：Cron 排程同步（HackMD 每天凌晨 0 點、GitHub 每天凌晨 2 點）
  - ✅ 9-1：安裝 `@nestjs/schedule`
  - ✅ 9-2：SyncService（含 `lastChangedAt` diff 檢查、Repo `pushed_at` diff 檢查）
  - ✅ 9-3：補充 `supabase.service.ts`（`writeSyncLog`、`getLastSyncedAt`、`getLastSuccessSyncAt`）
  - ⬜ 9-4：建立 `sync.module.ts`（**目前進度到這裡**）
  - ⬜ Step 10：GitHub Webhook Handler（即時同步）

### ⬜ Phase 5 — RAG Agent + `/ask` API（待開始）
- Step 11：Agent Module（向量搜尋 + GPT-4o-mini 生成回答）
- Step 12：`POST /ask` API
- Step 13：`POST /sync` 手動同步 API

### ⬜ Phase 6 — MCP Server（待開始）
- Step 14：MCP Server 建立
- Step 15：Claude `/ask` slash command
- Step 16：MCP configs

### ⬜ Phase 7 — 部署（待開始）
- Step 17：Dockerfile
- Step 18：Zeabur 設定

---

## 環境變數

複製 `.env.example` 並填入對應值：

```bash
cp apps/backend/.env.example apps/backend/.env
```

| 變數名稱 | 說明 |
|----------|------|
| `OPENAI_API_KEY` | OpenAI API 金鑰 |
| `SUPABASE_URL` | Supabase 專案 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role 金鑰 |
| `HACKMD_API_TOKEN` | HackMD API Token |
| `GITHUB_TOKEN` | GitHub Personal Access Token |
| `GITHUB_OWNER` | GitHub 帳號名稱 |
| `GITHUB_TOPIC` | 用來篩選 repo 的 topic（預設：`rag-kb`） |
| `GITHUB_WEBHOOK_SECRET` | GitHub Webhook 驗證密鑰 |

---

## 啟動開發環境

```bash
cd apps/backend
npm install
npm run start:dev
```

---

## GitHub repo 自動納入

只要在 GitHub repo 加上 `rag-kb` topic，該 repo 的所有 `.md` 檔案就會自動被同步至向量資料庫，無需手動設定。

Settings → General → Topics → 輸入 `rag-kb`
