# RAG 知識庫 — Phase 2：資料來源整合

---

## Phase 2：資料來源整合

### Step 6 — HackMD Source Module

#### 6-1. 取得 HackMD API Token

1. 前往 https://hackmd.io 登入
2. 點右上角頭像 → **Settings**
3. 左側選 **API** → 點 **Generate API token**
4. 複製 token

#### 6-2. 在 `.env` 填入 Token

打開 `apps/backend/.env`，填上：

```env
HACKMD_API_TOKEN=你的_token
```

#### 6-3. 建立模組資料夾

```bash
mkdir -p src/modules/sources/hackmd
```

#### 6-4. 安裝 HTTP 套件

> ⚠️ **注意**：`axios@1.14.1` 和 `axios@0.30.4` 有供應鏈攻擊（夾帶 RAT 木馬），雖已下架但建議**完全不安裝 axios**。
> 此專案改用 **Node.js 18+ 內建的 `fetch`**，不需要額外安裝任何套件。

#### 6-5. 建立 `src/modules/sources/hackmd/hackmd.service.ts`

```ts
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

// 定義 HackMD 筆記的資料結構
type THackMDNote = {
  id: string          // 筆記的唯一識別碼
  title: string       // 筆記標題
  content: string     // 筆記的 markdown 內容
  publishLink: string // 公開連結
  lastChangedAt: string // 最後修改時間
}

@Injectable()
export class HackmdService {
  private readonly logger = new Logger(HackmdService.name)
  private readonly baseUrl = 'https://api.hackmd.io/v1'
  private readonly token: string

  constructor(private configService: ConfigService) {
    this.token = this.configService.get<string>('HACKMD_API_TOKEN')!
  }

  // 取得認證用的 HTTP header
  private get headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    }
  }

  // 取得所有筆記清單（不含內容）
  // 使用 Node.js 內建 fetch，不需要安裝 axios
  async getNoteList(): Promise<{ id: string; title: string }[]> {
    this.logger.log('Fetching HackMD note list...')
    const res = await fetch(`${this.baseUrl}/notes`, { headers: this.headers })
    if (!res.ok) throw new Error(`HackMD API error: ${res.status}`)
    return res.json() as Promise<{ id: string; title: string }[]>
  }

  // 取得單一筆記的完整內容
  async getNoteContent(noteId: string): Promise<THackMDNote> {
    const res = await fetch(`${this.baseUrl}/notes/${noteId}`, { headers: this.headers })
    if (!res.ok) throw new Error(`HackMD API error: ${res.status}`)
    return res.json() as Promise<THackMDNote>
  }

  // 取得所有筆記的完整內容（清單 + 逐一抓內容）
  async getAllNotes(): Promise<THackMDNote[]> {
    const list = await this.getNoteList()
    this.logger.log(`Found ${list.length} notes, fetching content...`)

    const notes: THackMDNote[] = []
    for (const item of list) {
      try {
        const note = await this.getNoteContent(item.id)
        notes.push(note)
      } catch (err) {
        // 單筆失敗不中斷，記錄錯誤後繼續
        this.logger.error(`Failed to fetch note ${item.id}: ${err}`)
      }
    }
    return notes
  }
}
```

#### 6-6. 建立 `src/modules/sources/hackmd/hackmd.module.ts`

```ts
import { Module } from '@nestjs/common'
import { HackmdService } from './hackmd.service'

@Module({
  providers: [HackmdService],
  exports: [HackmdService],
})
export class HackmdModule {}
```

#### 6-7. 在 `app.module.ts` 引入 HackmdModule

```ts
import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { ConfigModule } from './modules/config/config.module'
import { SupabaseModule } from './modules/supabase/supabase.module'
import { EmbeddingModule } from './modules/embedding/embedding.module'
import { HackmdModule } from './modules/sources/hackmd/hackmd.module'

@Module({
  imports: [
    ConfigModule,
    SupabaseModule,
    EmbeddingModule,
    HackmdModule, // HackMD 資料來源模組
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

#### 6-8. 驗證是否正常啟動

```bash
npm run start:dev
```

看到 `Nest application successfully started` 代表成功，按 `Ctrl + C` 停止。

---

### Step 7 — GitHub Source Module

#### 7-1. 取得 GitHub Personal Access Token

1. 前往 https://github.com/settings/tokens/new （Classic）
2. 填寫 Note：`rag-kb`
3. 勾選 **`repo`**（完整 repo 存取）
4. 點 **Generate token**，複製 `ghp_...` 開頭的 token

#### 7-2. 在 `.env` 填入相關設定

打開 `apps/backend/.env`，填上：

```env
GITHUB_TOKEN=ghp_你的_token
GITHUB_OWNER=umon752          # 你的 GitHub 帳號名稱
GITHUB_TOPIC=rag-kb           # 只同步有此 topic 標籤的 repo
```

> **如何在 repo 加 topic 標籤：**
> 1. 進入 GitHub repo 頁面
> 2. 點 **About** 旁邊的齒輪 ⚙️
> 3. Topics 欄位輸入 `rag-kb` → 儲存
>
> 之後新建立的 repo，只要加上 `rag-kb` topic 就會自動被納入同步，不需要改任何設定。

#### 7-3. 建立模組資料夾

```bash
mkdir -p src/modules/sources/github
```

#### 7-4. 安裝 Octokit（GitHub 官方 API 套件）

```bash
cd /Users/gtut_jessie/Documents/tool/rag-kb/apps/backend
npm install @octokit/rest
```

> `@octokit/rest` 是 GitHub 官方提供的 TypeScript SDK，專門用來操作 GitHub API，比自己用 fetch 呼叫更方便

#### 7-5. 建立 `src/modules/sources/github/github.service.ts`

```ts
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Octokit } from '@octokit/rest'

// 定義從 GitHub 抓取的檔案資料結構
type TGitHubFile = {
  repo: string      // repo 名稱，例如 'my-notes'
  path: string      // 檔案路徑，例如 'docs/intro.md'
  content: string   // 檔案的文字內容
  url: string       // GitHub 上的檔案連結
  branch: string    // 所在分支，例如 'main'
}

// 回傳型別：repo 基本資訊 + pushedAt 供 diff 比對
type TRepoInfo = {
  name: string      // repo 名稱（不含 owner）
  pushedAt: string  // 最後 push 時間（ISO 8601）
}

// 不需要抓取的路徑（過濾掉無用的目錄）
const IGNORE_PATHS = ['node_modules/', 'dist/', '.env', '.git/']

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name)
  private octokit: Octokit

  constructor(private configService: ConfigService) {
    this.octokit = new Octokit({
      auth: this.configService.get<string>('GITHUB_TOKEN')!,
    })
  }

  // 取得所有有 rag-kb topic 的 repo 列表（含 pushedAt 供 diff 比對）
  async getTaggedRepos(): Promise<TRepoInfo[]> {
    const owner = this.configService.get<string>('GITHUB_OWNER')!
    const topic = this.configService.get<string>('GITHUB_TOPIC')!

    // 用 GitHub Search API 搜尋有指定 topic 且屬於該帳號的 repo
    const { data } = await this.octokit.search.repos({
      q: `user:${owner} topic:${topic}`,
      per_page: 100,  // 最多取 100 個 repo（GitHub Search API 預設只回傳 30 筆）
    })

    return data.items.map((repo) => ({
      name: repo.name,
      pushedAt: repo.pushed_at ?? new Date(0).toISOString(),
      // pushed_at 可能為 null（空 repo），預設為很舊的時間確保首次一定會 ingest
    }))
  }

  // 取得指定 repo 所有 .md 檔案內容
  async getRepoMarkdownFiles(
    repoName: string,
  ): Promise<Array<{ path: string; content: string; url: string; branch: string }>> {
    const owner = this.configService.get<string>('GITHUB_OWNER')!

    // 取得預設分支名稱
    const { data: repoData } = await this.octokit.repos.get({ owner, repo: repoName })
    const branch = repoData.default_branch

    // 取得整個 repo 的檔案樹（recursive 代表包含所有子資料夾）
    const { data: tree } = await this.octokit.git.getTree({
      owner,
      repo: repoName,
      tree_sha: branch,
      recursive: 'true',
    })

    const mdFiles = tree.tree.filter(
      (f) => f.path?.endsWith('.md') && f.type === 'blob',
    )
    // 型別需明確宣告，否則 TypeScript 會推斷為 never[]
    const results: Array<{ path: string; content: string; url: string; branch: string }> = []

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

  // 取得所有有 rag-kb topic 的 repo 的所有 .md 檔案（全量 ingestion 用）
  async getAllMarkdownFiles(): Promise<TGitHubFile[]> {
    const repos = await this.getTaggedRepos()
    const allFiles: TGitHubFile[] = []
    for (const repo of repos) {
      const files = await this.getRepoMarkdownFiles(repo.name)
      allFiles.push(
        ...files.map((f) => ({
          repo: repo.name,
          path: f.path,
          content: f.content,
          url: f.url,
          branch: f.branch,
        })),
      )
    }
    return allFiles
  }

  // 取得單一檔案內容（Webhook 觸發時使用）
  async getFileContent(
    repo: string,
    filePath: string,
  ): Promise<{ content: string; url: string }> {
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
}
```

#### 7-6. 建立 `src/modules/sources/github/github.module.ts`

```ts
import { Module } from '@nestjs/common'
import { GithubService } from './github.service'

@Module({
  providers: [GithubService],
  exports: [GithubService],
})
export class GithubModule {}
```

#### 7-7. 在 `app.module.ts` 引入 GithubModule

```ts
import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { ConfigModule } from './modules/config/config.module'
import { SupabaseModule } from './modules/supabase/supabase.module'
import { EmbeddingModule } from './modules/embedding/embedding.module'
import { HackmdModule } from './modules/sources/hackmd/hackmd.module'
import { GithubModule } from './modules/sources/github/github.module'

@Module({
  imports: [
    ConfigModule,
    SupabaseModule,
    EmbeddingModule,
    HackmdModule,
    GithubModule, // GitHub 資料來源模組
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

#### 7-8. 驗證是否正常啟動

```bash
npm run start:dev
```

看到 `Nest application successfully started` 代表成功，按 `Ctrl + C` 停止。

---

<!-- 後續步驟將陸續補充 -->
