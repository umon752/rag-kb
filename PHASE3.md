# RAG 知識庫 — Phase 3：Ingestion Pipeline

---

## Phase 3：Ingestion Pipeline

### Step 8 — Ingestion Pipeline（文件切塊 + 向量存入 DB）

#### 8-1. 安裝文字切塊套件

```bash
cd /Users/gtut_jessie/Documents/tool/rag-kb/apps/backend
npm install @langchain/textsplitters
```

> `@langchain/textsplitters` 是 LangChain 獨立拆出的文字切塊工具，不需要安裝整個 LangChain，只用這一個輕量套件

#### 8-2. 建立模組資料夾

```bash
mkdir -p src/modules/ingestion
```

#### 8-3. 建立 `src/modules/ingestion/ingestion.service.ts`

```ts
import { Injectable, Logger } from '@nestjs/common'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { SupabaseService } from '../supabase/supabase.service'
import { EmbeddingService } from '../embedding/embedding.service'
import { HackmdService } from '../sources/hackmd/hackmd.service'
import { GithubService } from '../sources/github/github.service'

// 定義 ingestion 結果的回傳型別
type TIngestionResult = {
  source: string   // 來源名稱，例如 'hackmd' 或 'github'
  total: number    // 總共處理幾筆文件
  chunks: number   // 總共切出幾個 chunk
  errors: number   // 失敗幾筆
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name)

  // 文字切塊器設定：每塊約 512 字元，相鄰塊重疊 50 字元
  // overlap（重疊）的目的是避免重要內容剛好被切在兩塊的邊界
  private splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 512,
    chunkOverlap: 50,
  })

  constructor(
    private supabaseService: SupabaseService,
    private embeddingService: EmbeddingService,
    private hackmdService: HackmdService,
    private githubService: GithubService,
  ) {}

  // 同步單一 HackMD 筆記（Webhook 觸發時使用）
  async ingestHackmdNote(noteId: string): Promise<void> {
    this.logger.log(`Ingesting HackMD note: ${noteId}`)
    const note = await this.hackmdService.getNoteContent(noteId)
    await this.ingestDocument({
      sourceType: 'hackmd',
      sourceId: note.id,
      title: note.title,
      content: note.content,
      metadata: { url: note.publishLink },
    })
  }

  // 全量同步所有 HackMD 筆記
  async ingestAllHackmd(): Promise<TIngestionResult> {
    this.logger.log('Starting full HackMD ingestion...')
    const notes = await this.hackmdService.getAllNotes()
    let chunks = 0
    let errors = 0

    for (const note of notes) {
      try {
        await this.ingestDocument({
          sourceType: 'hackmd',
          sourceId: note.id,
          title: note.title,
          content: note.content,
          metadata: { url: note.publishLink },
        })
        chunks++
      } catch {
        errors++
      }
    }

    return { source: 'hackmd', total: notes.length, chunks, errors }
  }

  // 全量同步所有 GitHub .md 檔案
  async ingestAllGithub(): Promise<TIngestionResult> {
    this.logger.log('Starting full GitHub ingestion...')
    const files = await this.githubService.getAllMarkdownFiles()
    let chunks = 0
    let errors = 0

    for (const file of files) {
      try {
        await this.ingestDocument({
          sourceType: 'github',
          sourceId: `${file.repo}/${file.path}`,
          title: file.path,
          content: file.content,
          metadata: {
            url: file.url,
            repo: file.repo,
            branch: file.branch,
            file_path: file.path,
          },
        })
        chunks++
      } catch {
        errors++
      }
    }

    return { source: 'github', total: files.length, chunks, errors }
  }

  // 核心方法：將單一文件切塊 → embed → 先刪舊資料 → 寫入 Supabase
  private async ingestDocument(doc: {
    sourceType: string
    sourceId: string
    title?: string
    content: string
    metadata?: Record<string, unknown>
  }): Promise<void> {
    // 第一步：切塊，把長文件切成多個小 chunk
    const chunks = await this.splitter.splitText(doc.content)
    if (chunks.length === 0) return

    // 第二步：批次 embed，把所有 chunk 轉成向量
    const embeddings = await this.embeddingService.embedBatch(chunks)

    // 第三步：先刪除此來源的所有舊資料（解決文章內容更新時舊 chunk 殘留的問題）
    await this.supabaseService.deleteDocumentsBySource(doc.sourceType, doc.sourceId)

    // 第四步：整理資料格式，準備寫入 DB
    const documents = chunks.map((chunk, i) => ({
      source_type: doc.sourceType,
      source_id: doc.sourceId,
      title: doc.title,
      content: chunk,
      embedding: embeddings[i],
      metadata: doc.metadata ?? {},
    }))

    // 第五步：寫入 Supabase
    await this.supabaseService.upsertDocuments(documents)
    this.logger.log(`Ingested ${chunks.length} chunks for ${doc.sourceType}:${doc.sourceId}`)
  }
}
```

#### 8-4. 補充 `supabase.service.ts`：新增刪除方法

> 還記得之前提到文章更新時需要「先刪後寫」嗎？現在補上 `deleteDocumentsBySource` 方法。

打開 `src/modules/supabase/supabase.service.ts`，在 `matchDocuments` 方法**後面**加入：

```ts
// 刪除指定來源的所有 chunk（文章更新時先清除舊資料）
async deleteDocumentsBySource(sourceType: string, sourceId: string): Promise<void> {
  const { error } = await this.client
    .from('documents')
    .delete()
    .match({ source_type: sourceType, source_id: sourceId })
    // .match() 是指定條件，等同於 WHERE source_type = ? AND source_id = ?

  if (error) throw new Error(`deleteDocumentsBySource failed: ${error.message}`)
}
```

#### 8-5. 建立 `src/modules/ingestion/ingestion.module.ts`

```ts
import { Module } from '@nestjs/common'
import { IngestionService } from './ingestion.service'
import { SupabaseModule } from '../supabase/supabase.module'
import { EmbeddingModule } from '../embedding/embedding.module'
import { HackmdModule } from '../sources/hackmd/hackmd.module'
import { GithubModule } from '../sources/github/github.module'

@Module({
  imports: [
    SupabaseModule,   // 需要 SupabaseService 寫入 DB
    EmbeddingModule,  // 需要 EmbeddingService 產生向量
    HackmdModule,     // 需要 HackmdService 抓取筆記
    GithubModule,     // 需要 GithubService 抓取 .md 檔
  ],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
```

#### 8-6. 在 `app.module.ts` 引入 IngestionModule

```ts
import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { ConfigModule } from './modules/config/config.module'
import { SupabaseModule } from './modules/supabase/supabase.module'
import { EmbeddingModule } from './modules/embedding/embedding.module'
import { HackmdModule } from './modules/sources/hackmd/hackmd.module'
import { GithubModule } from './modules/sources/github/github.module'
import { IngestionModule } from './modules/ingestion/ingestion.module'

@Module({
  imports: [
    ConfigModule,
    SupabaseModule,
    EmbeddingModule,
    HackmdModule,
    GithubModule,
    IngestionModule, // 文件 ingestion pipeline 模組
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

#### 8-7. 驗證是否正常啟動

```bash
npm run start:dev
```

看到 `Nest application successfully started` 代表成功，按 `Ctrl + C` 停止。

---

<!-- 後續步驟將陸續補充 -->
