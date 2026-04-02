# RAG 知識庫 — 實作步驟紀錄

---

## Phase 1：基礎建設

### Step 1 — 初始化 NestJS Backend

#### 1-1. 確認環境

先確認你有安裝必要工具：

```bash
node -v    # 需要 v20+
npm -v
```

#### 1-2. 安裝 NestJS CLI

```bash
npm install -g @nestjs/cli
```

#### 1-3. 在專案資料夾建立 backend

```bash
cd /Users/gtut_jessie/Documents/tool/rag-kb
mkdir apps
cd apps
nest new backend --package-manager npm
```

##### 💡 `nest new backend --package-manager npm`：

- nest = 剛才安裝的 NestJS CLI 工具
- new backend = 建立一個名為 backend 的新專案
- --package-manager npm = 指定用 npm 管理套件（避免它問你要選哪個）

> 詢問 package manager 時選 **npm**

#### 1-4. 建立 mcp-server 資料夾

```bash
cd /Users/gtut_jessie/Documents/tool/rag-kb
mkdir -p apps/mcp-server/src
```

#### 1-5. 建立根目錄的 `package.json`（monorepo 用）

```bash
cd /Users/gtut_jessie/Documents/tool/rag-kb
npm init -y
```

---

### Step 2 — 建立 Supabase 專案與 pgvector Schema

#### 2-1. 建立 Supabase 帳號與專案

1. 前往 https://supabase.com 註冊或登入
2. 點 **New Project**
3. 填寫：
   - **Name**：`rag-kb`
   - **Database Password**：設定一組強密碼（記下來）
   - **Region**：選 `Northeast Asia (Tokyo)`（離台灣最近）
4. 點 **Create new project**，等待約 1 分鐘建立完成

#### 2-2. 取得連線資訊

建立完成後：

1. 左側選單點 **Project Settings → API**
2. 複製以下兩個值（之後 `.env` 會用到）：
   - **Project URL**（`https://xxxx.supabase.co`）
   - **service_role** secret key（`eyJ...` 開頭）

#### 2-3. 建立 migration 資料夾與 SQL 檔

在終端機執行：

```bash
cd /Users/gtut_jessie/Documents/tool/rag-kb
mkdir -p supabase/migrations
```

##### 💡 什麼是 Migration？

Migration 是「資料庫結構變更的版本紀錄」。就像 git commit 記錄程式碼的變更，migration 記錄**資料庫的變更歷程**：

```
supabase/migrations/
├── 001_init.sql          ← 第一版：建立 documents、sync_logs 表
├── 002_add_tags.sql      ← 第二版：新增 tags 欄位
└── 003_add_index.sql     ← 第三版：加索引提升效能
```

**為什麼要有這個資料夾？**

- 讓團隊/未來的自己知道資料庫是怎麼一步步演變的
- 換環境部署時，可以重新執行這些 SQL 重建資料庫
- 不用靠記憶去想「我當初建了什麼表」

> 這個專案中，你在 Supabase SQL Editor 手動執行的那段 SQL，同時也存一份到 `supabase/migrations/001_init.sql`，讓 repo 裡有紀錄。兩邊內容一樣，migration 資料夾純粹是備份與文件用途。

#### 2-4. 在 Supabase 執行 Schema SQL

1. 左側選單點 **SQL Editor**
2. 點 **New query**
3. 貼上以下 SQL 並點 **Run**：

```sql
-- 啟用 pgvector 擴充
create extension if not exists vector;

-- 文件向量表
create table documents (
  id uuid primary key default gen_random_uuid(), -- 唯一識別碼（自動產生）
  source_type text not null,                     -- 來源類型（'hackmd' 或 'github'）
  source_id text not null,                       -- 來源識別碼（HackMD note ID / GitHub 檔案路徑）
  title text,                                    -- 文件標題
  content text not null,                         -- 切塊後的文字內容（chunk）
  embedding vector(1536),                        -- 向量（由 OpenAI embedding 產生，1536 維）
  metadata jsonb,                                -- 額外資訊（url、repo、branch、file_path 等）
  created_at timestamptz default now(),          -- 建立時間
  updated_at timestamptz default now(),          -- 最後更新時間
  unique(source_type, source_id, content)        -- 避免重複寫入相同內容
);

-- 同步記錄表
create table sync_logs (
  id uuid primary key default gen_random_uuid(),   -- 唯一識別碼（自動產生）
  source text not null,                             -- 來源名稱（'hackmd', 'github', 'github-repo:repo-name', 'all'）
  status text not null,                             -- 同步結果（'success' 或 'error'）
  meta jsonb,                                       -- 額外資訊（同步結果統計、錯誤訊息等）
  synced_at timestamptz default now()               -- 同步時間
);

-- 相似度搜尋 function
create or replace function match_documents(
  query_embedding vector(1536), -- 查詢問題的向量
  match_count int default 5     -- 回傳幾筆最相似的結果
)
returns table (id uuid, content text, metadata jsonb, similarity float)
language sql stable as $$
  select id, content, metadata, 1 - (embedding <=> query_embedding) as similarity
  from documents
  order by embedding <=> query_embedding -- 依向量距離排序（越小越相似）
  limit match_count;
$$;
```

4. 看到 **Success. No rows returned** 代表執行成功

#### 2-5. 建立 HNSW 向量索引

在 SQL Editor 再開一個 **New query**，執行：

```sql
-- 建立 HNSW 索引，提升向量相似度搜尋速度
-- vector_cosine_ops = 使用餘弦相似度（OpenAI embedding 建議使用此方式）
create index on documents
using hnsw (embedding vector_cosine_ops);
```

> **為什麼要加索引？** 無索引時每次搜尋都要比對所有資料（暴力搜尋）。HNSW 是目前最主流的 ANN（近似最近鄰）演算法，資料量越大效果越明顯。現在資料量小感受不出差異，但先建好，未來資料增加也不用再補。

---

### Step 3 — NestJS Config Module（環境變數管理）

#### 3-1. 安裝必要套件

```bash
cd /Users/gtut_jessie/Documents/tool/rag-kb/apps/backend
npm install @nestjs/config
```

#### 3-2. 建立 `.env` 檔案

```bash
# 在 backend 資料夾建立 .env
touch .env
```

用編輯器打開 `.env`，貼上以下內容（之後填入真實值）：

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
GITHUB_OWNER=          # 你的 GitHub 帳號名稱
GITHUB_TOPIC=rag-kb    # 只同步有此 topic 標籤的 repo

# Webhook 安全
GITHUB_WEBHOOK_SECRET=

# Backend
PORT=3000
```

#### 3-3. 建立 `.env.example`（存入 git 的版本，不含機密值）

```bash
cp .env .env.example
```

> `.env` 已在 `.gitignore` 裡，不會被推上 GitHub；`.env.example` 會推上去讓別人知道需要哪些環境變數。

#### 3-4. 建立 config 模組資料夾

```bash
mkdir -p src/modules/config
```

#### 3-5. 建立 `src/modules/config/config.module.ts`

建立檔案，內容如下：

```ts
import { Global, Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";

// @Global() 讓這個模組在整個專案都可用，不需要每個模組單獨 import
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true, // 環境變數全域可用
      envFilePath: ".env", // 指定讀取 .env 檔案
    }),
  ],
})
export class ConfigModule {}
```

#### 3-6. 在 `app.module.ts` 引入 ConfigModule

打開 `src/app.module.ts`，修改成：

```ts
import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ConfigModule } from "./modules/config/config.module";

@Module({
  imports: [ConfigModule], // 引入自訂的 ConfigModule，讓環境變數在全專案可用
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

#### 3-7. 驗證是否正常啟動

```bash
cd /Users/gtut_jessie/Documents/tool/rag-kb/apps/backend
npm run start:dev
```

看到 `Nest application successfully started` 代表成功，按 `Ctrl + C` 停止。

---

### Step 4 — Supabase Module（資料庫連線）

#### 4-1. 安裝 Supabase 套件

```bash
cd /Users/gtut_jessie/Documents/tool/rag-kb/apps/backend
npm install @supabase/supabase-js
```

#### 4-2. 建立模組資料夾

```bash
mkdir -p src/modules/supabase
```

#### 4-3. 建立 `src/modules/supabase/supabase.service.ts`

```ts
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// 定義文件的資料結構型別
type TDocument = {
  source_type: string; // 來源類型：'hackmd' | 'github'
  source_id: string; // 來源識別碼
  title?: string; // 標題（選填，? 代表可以不傳）
  content: string; // 文字內容（chunk）
  embedding: number[]; // 向量陣列（由 OpenAI embedding 產生）
  metadata?: Record<string, unknown>; // 額外資訊（url、repo 等），選填
};

// 定義搜尋結果的資料結構型別
type TSearchResult = {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number; // 相似度分數（0~1，越高越相似）
};

// @Injectable() 是 NestJS 的裝飾器
// 告訴 NestJS 這個 class 是可以被「注入」到其他地方使用的服務
// NestJS 會自動幫你建立並管理這個 class 的實例，不需要手動 new SupabaseService()
@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private client: SupabaseClient;

  // constructor 是 class 初始化時自動執行的方法
  // 這裡透過依賴注入取得 ConfigService（讀取 .env 的服務）
  // NestJS 看到 constructor 參數有型別標注，就會自動把對應的服務傳進來
  constructor(private configService: ConfigService) {
    // 用 .env 裡的值建立 Supabase client
    // configService.get() 就是讀取環境變數的方法
    // 末尾的 ! 是 TypeScript 語法，告訴編譯器「這個值一定存在，不是 undefined」
    this.client = createClient(
      this.configService.get<string>("SUPABASE_URL")!,
      this.configService.get<string>("SUPABASE_SERVICE_ROLE_KEY")!,
    );
  }

  // async 代表這是非同步方法（等待資料庫回應）
  // 寫入或更新文件向量（若已存在相同 source_type + source_id + content 則忽略）
  async upsertDocuments(documents: TDocument[]): Promise<void> {
    const { error } = await this.client
      .from("documents") // 指定操作 documents 表
      .upsert(documents, { onConflict: "source_type,source_id,content" });
    // upsert = insert + update：有就更新，沒有就新增
    // onConflict：遇到重複的資料時用哪些欄位判斷「是同一筆」

    // 如果資料庫回傳錯誤，拋出例外讓呼叫方知道
    if (error) throw new Error(`upsertDocuments failed: ${error.message}`);
  }

  // 依向量相似度搜尋最相關的文件
  // embedding：問題轉成的向量，matchCount：要回傳幾筆結果（預設 5 筆）
  async matchDocuments(
    embedding: number[],
    matchCount = 5,
  ): Promise<TSearchResult[]> {
    const { data, error } = await this.client.rpc("match_documents", {
      // rpc 是呼叫 Supabase 裡的自訂 SQL function（就是 Step 2 建立的那個）
      query_embedding: embedding,
      match_count: matchCount,
    });

    if (error) throw new Error(`matchDocuments failed: ${error.message}`);
    return data as TSearchResult[];
  }
}
```

#### 4-4. 建立 `src/modules/supabase/supabase.module.ts`

```ts
import { Module } from "@nestjs/common";
import { SupabaseService } from "./supabase.service";

// @Module() 是 NestJS 的裝飾器，用來定義模組
// 模組是 NestJS 組織程式碼的基本單位，每個功能都封裝成一個模組
@Module({
  providers: [SupabaseService], // 這個模組提供的服務，NestJS 會幫你建立實例
  exports: [SupabaseService], // 匯出給其他模組使用（不加 exports 的話外部無法注入）
})
export class SupabaseModule {}
```

#### 4-5. 在 `app.module.ts` 引入 SupabaseModule

打開 `src/app.module.ts`，加入 `SupabaseModule`：

```ts
import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ConfigModule } from "./modules/config/config.module";
import { SupabaseModule } from "./modules/supabase/supabase.module";

@Module({
  imports: [
    ConfigModule, // 環境變數模組（必須在最前面）
    SupabaseModule, // Supabase 資料庫連線模組
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

#### 4-6. 驗證是否正常啟動

.env 填入剛剛的 subabase url、subabase service role key：

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

```bash
npm run start:dev
```

看到 `Nest application successfully started` 代表成功，按 `Ctrl + C` 停止。

---

### Step 5 — Embedding Service（OpenAI 向量轉換）

#### 5-1. 安裝 OpenAI 套件

```bash
cd /Users/gtut_jessie/Documents/tool/rag-kb/apps/backend
npm install openai
```

#### 5-2. 在 `.env` 填入 OpenAI API Key

打開 `apps/backend/.env`，填上：

```env
OPENAI_API_KEY=sk-...
```

> 前往 https://platform.openai.com/api-keys 建立 API Key

#### 5-3. 建立模組資料夾

```bash
mkdir -p src/modules/embedding
```

#### 5-4. 建立 `src/modules/embedding/embedding.service.ts`

```ts
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";

@Injectable()
export class EmbeddingService {
  // Logger 是 NestJS 內建的日誌工具，方便在終端機看到執行狀態
  private readonly logger = new Logger(EmbeddingService.name);
  private openai: OpenAI;

  constructor(private configService: ConfigService) {
    // 建立 OpenAI client，帶入 API Key
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>("OPENAI_API_KEY")!,
    });
  }

  // 將單一文字轉成向量（1536 維的數字陣列）
  async embedText(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: "text-embedding-3-small", // 使用的 embedding 模型
      input: text,
    });
    return response.data[0].embedding; // 回傳向量陣列
  }

  // 將多筆文字批次轉成向量（避免一筆一筆呼叫 API，減少請求次數）
  async embedBatch(texts: string[]): Promise<number[][]> {
    this.logger.log(`Embedding ${texts.length} chunks...`);

    // 每次最多送 100 筆給 OpenAI（避免超過 API 限制）
    const batchSize = 100;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize); // 取出這一批

      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: batch,
      });

      // 把這批結果加入 results 陣列
      results.push(...response.data.map((item) => item.embedding));
      this.logger.log(
        `Embedded ${Math.min(i + batchSize, texts.length)} / ${texts.length}`,
      );
    }

    return results;
  }
}
```

#### 5-5. 建立 `src/modules/embedding/embedding.module.ts`

```ts
import { Module } from "@nestjs/common";
import { EmbeddingService } from "./embedding.service";

@Module({
  providers: [EmbeddingService], // 註冊服務
  exports: [EmbeddingService], // 匯出給其他模組使用
})
export class EmbeddingModule {}
```

#### 5-6. 在 `app.module.ts` 引入 EmbeddingModule

```ts
import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ConfigModule } from "./modules/config/config.module";
import { SupabaseModule } from "./modules/supabase/supabase.module";
import { EmbeddingModule } from "./modules/embedding/embedding.module";

@Module({
  imports: [
    ConfigModule, // 環境變數模組（必須在最前面）
    SupabaseModule, // Supabase 資料庫連線模組
    EmbeddingModule, // OpenAI Embedding 模組
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

#### 5-7. 驗證是否正常啟動

```bash
npm run start:dev
```

看到 `Nest application successfully started` 代表成功，按 `Ctrl + C` 停止。

---

<!-- 後續步驟將陸續補充 -->
