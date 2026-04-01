# RAG 知識庫 — Phase 4：Webhook 自動同步

---

## Phase 4：Webhook 自動同步

當 HackMD 筆記更新、或 GitHub repo 有 push 事件時，自動觸發重新同步，讓向量資料庫保持最新內容。

---

### Step 9 — HackMD Webhook Handler

HackMD 目前**沒有官方 Webhook**，改用 **排程輪詢（Cron Job）** 方案：
定時拉取所有筆記，比對 `lastChangedAt`，只更新有變動的筆記。

#### 9-1. 安裝排程套件

```bash
cd /Users/gtut_jessie/Documents/tool/rag-kb/apps/backend
npm install @nestjs/schedule
```

> `@nestjs/schedule` 是 NestJS 官方排程模組，底層用 `node-cron`

#### 9-2. 建立 `src/modules/sync/sync.service.ts`

```ts
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { IngestionService } from '../ingestion/ingestion.service'
import { SupabaseService } from '../supabase/supabase.service'
import { HackmdService } from '../sources/hackmd/hackmd.service'
import { GithubService } from '../sources/github/github.service'

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name)

  constructor(
    private ingestionService: IngestionService,
    private supabaseService: SupabaseService,
    private hackmdService: HackmdService,
    private githubService: GithubService,
  ) {}

  // 每天凌晨 0 點同步 HackMD（因無 Webhook，改用輪詢）
  // 搭配 lastChangedAt diff 檢查，只 ingest 有變動的筆記，節省 token 消耗
  @Cron('0 0 * * *')
  async syncHackmd(): Promise<void> {
    this.logger.log('[Cron] 開始同步 HackMD...')
    try {
      const notes = await this.hackmdService.getAllNotes()
      let updated = 0
      let skipped = 0
      let errors = 0

      for (const note of notes) {
        try {
          // 查詢此筆記上次同步時間
          const lastSyncedAt = await this.supabaseService.getLastSyncedAt('hackmd', note.id)

          // 若上次同步時間存在，且筆記沒有更新，則跳過（節省 embedding token）
          if (lastSyncedAt && new Date(note.lastChangedAt) <= new Date(lastSyncedAt)) {
            skipped++
            continue
          }

          // 有變動才重新 ingest
          await this.ingestionService.ingestHackmdNote(note.id)
          updated++
        } catch {
          errors++
        }
      }

      const result = { total: notes.length, updated, skipped, errors }
      this.logger.log(
        `[Cron] HackMD 同步完成：共 ${result.total} 篇，更新 ${result.updated}，跳過 ${result.skipped}，錯誤 ${result.errors}`,
      )
      await this.supabaseService.writeSyncLog('hackmd', 'success', result)
    } catch (error) {
      this.logger.error('[Cron] HackMD 同步失敗', error)
      await this.supabaseService.writeSyncLog('hackmd', 'error', { message: String(error) })
    }
  }

  // 每天凌晨 2 點同步 GitHub
  // 以 repo 層級的 pushed_at 做 diff 檢查：repo 沒有新 push 就整個跳過，節省 API 與 token
  @Cron('0 2 * * *')
  async syncGithub(): Promise<void> {
    this.logger.log('[Cron] 開始同步 GitHub...')
    try {
      const repos = await this.githubService.getTaggedRepos()
      let updated = 0
      let skipped = 0
      let errors = 0

      for (const repo of repos) {
        try {
          // 查此 repo 上次同步時間（以 source_id = repo name 作為識別）
          const lastSyncedAt = await this.supabaseService.getLastSyncedAt('github-repo', repo.name)

          // repo 自上次同步後沒有任何 push，整個跳過（不重新 ingest，0 token 消耗）
          if (lastSyncedAt && new Date(repo.pushedAt) <= new Date(lastSyncedAt)) {
            skipped++
            continue
          }

          // 有 push 才重新 ingest 此 repo 所有 .md 檔案
          await this.ingestionService.ingestAllGithubRepo(repo.name)
          updated++
        } catch {
          errors++
        }
      }

      const result = { total: repos.length, updated, skipped, errors }
      this.logger.log(
        `[Cron] GitHub 同步完成：共 ${result.total} 個 repo，更新 ${result.updated}，跳過 ${result.skipped}，錯誤 ${result.errors}`,
      )
      await this.supabaseService.writeSyncLog('github', 'success', result)
    } catch (error) {
      this.logger.error('[Cron] GitHub 同步失敗', error)
      await this.supabaseService.writeSyncLog('github', 'error', { message: String(error) })
    }
  }

  // 手動觸發全量同步（供 POST /sync API 呼叫）
  async syncAll(): Promise<{ hackmd: unknown; github: unknown }> {
    this.logger.log('[Manual] 手動觸發全量同步...')
    const [hackmd, github] = await Promise.all([
      this.ingestionService.ingestAllHackmd(),
      this.ingestionService.ingestAllGithub(),
    ])
    await this.supabaseService.writeSyncLog('all', 'success', { hackmd, github })
    return { hackmd, github }
  }
}
```

#### 9-3. 補充 `supabase.service.ts`：新增兩個方法

打開 `src/modules/supabase/supabase.service.ts`，在最後加入：

```ts
// 寫入同步紀錄
async writeSyncLog(source: string, status: 'success' | 'error', meta?: unknown): Promise<void> {
  const { error } = await this.client.from('sync_logs').insert({
    source,
    status,
    meta: meta ?? {},
    synced_at: new Date().toISOString(),
  })
  if (error) this.logger.error(`writeSyncLog failed: ${error.message}`)
}

// 查詢指定來源文件的上次同步時間（用於 diff 檢查，避免重複 embed）
async getLastSyncedAt(sourceType: string, sourceId: string): Promise<string | undefined> {
  const { data } = await this.client
    .from('documents')
    .select('updated_at')
    .match({ source_type: sourceType, source_id: sourceId })
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  return data?.updated_at ?? undefined
}
```

> `sync_logs` 資料表在 Phase 1 建立 Supabase schema 時已一併建好

> **注意 `getLastSyncedAt` 的兩種使用情境：**
> - HackMD：`sourceType = 'hackmd'`，`sourceId = note.id`（查文件層級）
> - GitHub repo diff：`sourceType = 'github-repo'`，`sourceId = repo.name`（查 repo 層級）
>
> GitHub repo 層級的 sync 紀錄由 `writeSyncLog('github', ...)` 寫入 `sync_logs`，
> 而 `getLastSyncedAt` 查的是 `documents` 表。因此需要在 `ingestAllGithubRepo` 完成後，
> 額外寫一筆 `documents` 佔位記錄，或改從 `sync_logs` 查時間。
>
> **最簡單的做法**：把 `getLastSyncedAt` 改為查 `sync_logs`：

補充第二個版本給 GitHub repo diff 使用（查 `sync_logs` 表）：

```ts
// 查詢 sync_logs 中指定來源的上次成功同步時間（給 GitHub repo diff 用）
async getLastSuccessSyncAt(source: string): Promise<string | undefined> {
  const { data } = await this.client
    .from('sync_logs')
    .select('synced_at')
    .eq('source', `github-repo:${source}`)  // 用 source 名稱區分不同 repo
    .eq('status', 'success')
    .order('synced_at', { ascending: false })
    .limit(1)
    .single()

  return data?.synced_at ?? undefined
}
```

同時更新 `syncGithub` 的呼叫方式（`SyncService` 中）：

```ts
// 查此 repo 上次同步時間（改查 sync_logs）
const lastSyncedAt = await this.supabaseService.getLastSuccessSyncAt(repo.name)
```

同步成功後也要寫入此 repo 的 log：

```ts
// ingestAllGithubRepo 完成後寫入 repo 層級的 sync log
await this.supabaseService.writeSyncLog(`github-repo:${repo.name}`, 'success', {})
updated++
```

#### 9-4. 建立 `src/modules/sync/sync.module.ts`

```ts
import { Module } from '@nestjs/common'
import { SyncService } from './sync.service'
import { IngestionModule } from '../ingestion/ingestion.module'
import { SupabaseModule } from '../supabase/supabase.module'
import { HackmdModule } from '../sources/hackmd/hackmd.module'
import { GithubModule } from '../sources/github/github.module'

@Module({
  imports: [
    IngestionModule,  // 需要 IngestionService 執行 ingestion
    SupabaseModule,   // 需要 SupabaseService 寫 sync_logs
    HackmdModule,     // 需要 HackmdService（SyncService 間接用到）
    GithubModule,     // 需要 GithubService（SyncService 間接用到）
  ],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
```

---

### Step 10 — GitHub Webhook Handler

GitHub **有官方 Webhook**！當 repo 有 `push` 事件時，GitHub 會主動 POST 到你的 API，觸發即時同步。

#### 10-0. 補充 `github.service.ts`：新增 `getTaggedRepos()` 方法

> `syncGithub` 需要取得有 `rag-kb` topic 的 repo 列表，同時拿到 `pushedAt` 做 diff 比對

打開 `src/modules/sources/github/github.service.ts`，加入：

```ts
// 回傳型別：repo 基本資訊 + pushedAt 供 diff 比對
type TRepoInfo = {
  name: string      // repo 名稱（不含 owner）
  pushedAt: string  // 最後 push 時間（ISO 8601）
}

// 取得所有有 rag-kb topic 的 repo 列表（含 pushedAt）
async getTaggedRepos(): Promise<TRepoInfo[]> {
  const owner = this.configService.get<string>('GITHUB_OWNER')!
  const topic = this.configService.get<string>('GITHUB_TOPIC')!

  const { data } = await this.octokit.search.repos({
    q: `user:${owner} topic:${topic}`,
    per_page: 100,
  })

  return data.items.map((repo) => ({
    name: repo.name,
    pushedAt: repo.pushed_at ?? new Date(0).toISOString(),
    // pushed_at 可能為 null（空 repo），預設為很舊的時間確保首次一定會 ingest
  }))
}
```

#### 10-1. 補充 `ingestion.service.ts`：新增 `ingestAllGithubRepo()` 方法

> `syncGithub` 需要以 repo 為單位觸發 ingestion（而非全部 repo 一起）

打開 `src/modules/ingestion/ingestion.service.ts`，在 `ingestAllGithub` 後面加入：

```ts
// 同步單一 GitHub repo 的所有 .md 檔案（Cron 逐 repo 觸發時使用）
async ingestAllGithubRepo(repoName: string): Promise<void> {
  const files = await this.githubService.getRepoMarkdownFiles(repoName)

  for (const file of files) {
    await this.ingestDocument({
      sourceType: 'github',
      sourceId: `${repoName}/${file.path}`,
      title: file.path,
      content: file.content,
      metadata: {
        url: file.url,
        repo: repoName,
        file_path: file.path,
      },
    })
  }
}
```

#### 10-2. 補充 `github.service.ts`：新增 `getRepoMarkdownFiles()` 方法

> 原有的 `getAllMarkdownFiles()` 是跨所有 repo，現在需要單一 repo 版本

```ts
// 取得指定 repo 所有 .md 檔案（供 ingestAllGithubRepo 使用）
async getRepoMarkdownFiles(
  repoName: string,
): Promise<Array<{ path: string; content: string; url: string; branch: string }>> {
  const owner = this.configService.get<string>('GITHUB_OWNER')!

  // 取得預設分支名稱
  const { data: repoData } = await this.octokit.repos.get({ owner, repo: repoName })
  const branch = repoData.default_branch

  // 取得整個 repo 的檔案樹
  const { data: tree } = await this.octokit.git.getTree({
    owner,
    repo: repoName,
    tree_sha: branch,
    recursive: 'true',
  })

  const mdFiles = tree.tree.filter((f) => f.path?.endsWith('.md') && f.type === 'blob')
  const results = []

  for (const file of mdFiles) {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo: repoName,
        path: file.path!,
      })
      if (Array.isArray(data) || data.type !== 'file') continue

      results.push({
        path: file.path!,
        content: Buffer.from(data.content, 'base64').toString('utf-8'),
        url: data.html_url ?? '',
        branch,
      })
    } catch {
      // 單一檔案失敗不中斷整個 repo
    }
  }

  return results
}
```

#### 10-3. 建立 Webhook Controller

建立 `src/modules/sync/sync.controller.ts`：

```ts
import {
  Controller,
  Post,
  Headers,
  Body,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac } from 'crypto'
import { SyncService } from './sync.service'
import { IngestionService } from '../ingestion/ingestion.service'

@Controller()
export class SyncController {
  private readonly logger = new Logger(SyncController.name)

  constructor(
    private syncService: SyncService,
    private ingestionService: IngestionService,
    private configService: ConfigService,
  ) {}

  // GitHub Webhook — 接收 push 事件，觸發受影響 .md 檔案重新 ingest
  @Post('webhook/github')
  @HttpCode(HttpStatus.OK)
  async githubWebhook(
    @Headers('x-hub-signature-256') signature: string,
    @Body() payload: Record<string, unknown>,
  ): Promise<{ ok: boolean }> {
    // 驗證 GitHub 送來的簽名，防止偽造請求
    this.verifyGithubSignature(signature, JSON.stringify(payload))

    const ref = payload['ref'] as string
    const repository = payload['repository'] as { full_name: string; default_branch: string }
    const commits = payload['commits'] as Array<{
      added: string[]
      modified: string[]
      removed: string[]
    }>

    // 只處理推送到預設分支的事件（避免處理 feature branch）
    if (!ref?.endsWith(repository?.default_branch)) {
      return { ok: true }
    }

    // 收集所有新增或修改的 .md 檔案
    const changedFiles = commits
      .flatMap((c) => [...(c.added ?? []), ...(c.modified ?? [])])
      .filter((f) => f.endsWith('.md'))

    // 收集所有刪除的 .md 檔案（從 DB 移除）
    const removedFiles = commits
      .flatMap((c) => c.removed ?? [])
      .filter((f) => f.endsWith('.md'))

    const repoName = repository.full_name.split('/')[1]

    // 重新 ingest 變動的檔案
    for (const filePath of changedFiles) {
      try {
        await this.ingestionService.ingestGithubFile(repoName, filePath)
        this.logger.log(`Webhook: ingested ${repoName}/${filePath}`)
      } catch (error) {
        this.logger.error(`Webhook: failed to ingest ${filePath}`, error)
      }
    }

    // 刪除被移除的檔案
    // (IngestionService.deleteGithubFile 將在下方補充)
    for (const filePath of removedFiles) {
      try {
        await this.ingestionService.deleteGithubFile(repoName, filePath)
        this.logger.log(`Webhook: deleted ${repoName}/${filePath}`)
      } catch (error) {
        this.logger.error(`Webhook: failed to delete ${filePath}`, error)
      }
    }

    return { ok: true }
  }

  // 手動觸發全量同步（開發/管理用）
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async manualSync(): Promise<unknown> {
    this.logger.log('Manual sync triggered')
    return this.syncService.syncAll()
  }

  // 驗證 GitHub Webhook 簽名（HMAC-SHA256）
  private verifyGithubSignature(signature: string, body: string): void {
    const secret = this.configService.get<string>('GITHUB_WEBHOOK_SECRET')
    if (!secret) return // 若未設定 secret，跳過驗證（本地開發時可用）

    const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    if (signature !== expected) {
      throw new UnauthorizedException('Invalid GitHub webhook signature')
    }
  }
}
```

#### 10-4. 補充 `ingestion.service.ts`：新增單檔案處理方法

打開 `src/modules/ingestion/ingestion.service.ts`，在 `ingestAllGithub` 方法**後面**加入：

```ts
// 同步單一 GitHub .md 檔案（Webhook 觸發時使用）
async ingestGithubFile(repo: string, filePath: string): Promise<void> {
  const file = await this.githubService.getFileContent(repo, filePath)
  await this.ingestDocument({
    sourceType: 'github',
    sourceId: `${repo}/${filePath}`,
    title: filePath,
    content: file.content,
    metadata: { url: file.url, repo, file_path: filePath },
  })
}

// 刪除單一 GitHub .md 檔案的所有 chunk（Webhook push 刪除事件）
async deleteGithubFile(repo: string, filePath: string): Promise<void> {
  await this.supabaseService.deleteDocumentsBySource('github', `${repo}/${filePath}`)
}
```

#### 10-5. 補充 `github.service.ts`：新增單檔案讀取方法

打開 `src/modules/sources/github/github.service.ts`，加入：

```ts
// 取得單一檔案內容（Webhook 觸發時使用）
async getFileContent(repo: string, filePath: string): Promise<{ content: string; url: string }> {
  const owner = this.configService.get<string>('GITHUB_OWNER')!

  const { data } = await this.octokit.repos.getContent({
    owner,
    repo,
    path: filePath,
  })

  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error(`${filePath} is not a file`)
  }

  return {
    content: Buffer.from(data.content, 'base64').toString('utf-8'),
    url: data.html_url ?? '',
  }
}
```

#### 10-6. 更新 `sync.module.ts`：加入 Controller

```ts
import { Module } from '@nestjs/common'
import { SyncService } from './sync.service'
import { SyncController } from './sync.controller'
import { IngestionModule } from '../ingestion/ingestion.module'
import { SupabaseModule } from '../supabase/supabase.module'
import { HackmdModule } from '../sources/hackmd/hackmd.module'
import { GithubModule } from '../sources/github/github.module'

@Module({
  imports: [IngestionModule, SupabaseModule, HackmdModule, GithubModule],
  controllers: [SyncController],  // 加入 Controller 處理 HTTP 請求
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
```

#### 10-7. 在 `app.module.ts` 引入 SyncModule 和 ScheduleModule

```ts
import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { ConfigModule } from './modules/config/config.module'
import { SupabaseModule } from './modules/supabase/supabase.module'
import { EmbeddingModule } from './modules/embedding/embedding.module'
import { HackmdModule } from './modules/sources/hackmd/hackmd.module'
import { GithubModule } from './modules/sources/github/github.module'
import { IngestionModule } from './modules/ingestion/ingestion.module'
import { SyncModule } from './modules/sync/sync.module'

@Module({
  imports: [
    ScheduleModule.forRoot(),  // 啟用排程功能（必須放最前）
    ConfigModule,
    SupabaseModule,
    EmbeddingModule,
    HackmdModule,
    GithubModule,
    IngestionModule,
    SyncModule,  // Webhook + 排程同步模組
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

#### 10-8. 在 `.env` 加入 Webhook Secret

```env
GITHUB_WEBHOOK_SECRET=your_webhook_secret_here
```

> 值可以是任意隨機字串，GitHub 設定 Webhook 時填一樣的值即可

#### 10-9. 在 GitHub 設定 Webhook（每個 repo 都要設定一次）

1. 進入 GitHub repo → **Settings** → **Webhooks** → **Add webhook**
2. **Payload URL**：`https://你的部署網址/webhook/github`
3. **Content type**：`application/json`
4. **Secret**：填入和 `GITHUB_WEBHOOK_SECRET` 一樣的值
5. **Which events**：選 **Just the push event**
6. 按 **Add webhook**

> ⚠️ 本地開發時 GitHub 無法送到 `localhost`，可使用 [ngrok](https://ngrok.com/) 暫時建立公開 URL 測試：
> ```bash
> ngrok http 3000
> ```

#### 10-10. 驗證是否正常啟動

```bash
npm run start:dev
```

看到以下訊息代表排程已啟動：
```
[Nest] SchedulerRegistry initialized
```

確認 API 端點可以呼叫：
```bash
curl -X POST http://localhost:3000/sync
```

應回傳：`{"hackmd":{"source":"hackmd",...},"github":{"source":"github",...}}`

---

<!-- 後續步驟將陸續補充 -->
