import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Octokit } from '@octokit/rest'

// 定義從 GitHub 抓取的檔案資料結構
type TGitHubFile = {
  repo: string      // repo 名稱，例如 'umon752/my-notes'
  path: string      // 檔案路徑，例如 'docs/intro.md'
  content: string   // 檔案的文字內容
  url: string       // GitHub 上的檔案連結
  branch: string    // 所在分支，例如 'main'
}

// 不需要抓取的路徑（過濾掉無用的目錄）
const IGNORE_PATHS = ['node_modules/', 'dist/', '.env', '.git/']

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name)
  private octokit: Octokit
  private owner: string
  private topic: string

  constructor(private configService: ConfigService) {
    this.octokit = new Octokit({
      auth: this.configService.get<string>('GITHUB_TOKEN')!,
    })
    this.owner = this.configService.get<string>('GITHUB_OWNER')!
    // 預設 topic 為 'rag-kb'，只同步有此標籤的 repo
    this.topic = this.configService.get<string>('GITHUB_TOPIC') ?? 'rag-kb'
  }

  // 自動取得帳號下所有有指定 topic 的 repo 清單
  async getTaggedRepos(): Promise<string[]> {
    this.logger.log(`Fetching repos with topic "${this.topic}" for ${this.owner}...`)

    // 用 GitHub Search API 搜尋有指定 topic 且屬於該帳號的 repo
    const { data } = await this.octokit.search.repos({
      q: `user:${this.owner} topic:${this.topic}`,
      per_page: 100, // 最多取 100 個 repo
    })

    const repos = data.items.map((item) => item.full_name)
    this.logger.log(`Found ${repos.length} repos with topic "${this.topic}": ${repos.join(', ')}`)
    return repos
  }

  // 取得單一 repo 下所有 .md 檔案的內容
  async getRepoMarkdownFiles(repoFullName: string): Promise<TGitHubFile[]> {
    const [owner, repo] = repoFullName.split('/')
    this.logger.log(`Fetching .md files from ${repoFullName}...`)

    // 取得 repo 的預設分支（main 或 master）
    const { data: repoData } = await this.octokit.repos.get({ owner, repo })
    const branch = repoData.default_branch

    // 取得整個 repo 的檔案樹（recursive 代表包含所有子資料夾）
    const { data: tree } = await this.octokit.git.getTree({
      owner,
      repo,
      tree_sha: branch,
      recursive: 'true',
    })

    // 只保留 .md 檔案，並排除 IGNORE_PATHS 裡的路徑
    const mdFiles = (tree.tree ?? []).filter(
      (item) =>
        item.type === 'blob' &&
        item.path?.endsWith('.md') &&
        !IGNORE_PATHS.some((ignore) => item.path?.startsWith(ignore)),
    )

    this.logger.log(`Found ${mdFiles.length} .md files in ${repoFullName}`)

    // 逐一取得每個檔案的內容
    const files: TGitHubFile[] = []
    for (const file of mdFiles) {
      try {
        const { data } = await this.octokit.repos.getContent({
          owner,
          repo,
          path: file.path!,
        })

        if ('content' in data && typeof data.content === 'string') {
          // GitHub API 回傳的內容是 Base64 編碼，需要解碼成文字
          const content = Buffer.from(data.content, 'base64').toString('utf-8')
          files.push({
            repo: repoFullName,
            path: file.path!,
            content,
            url: data.html_url ?? '',
            branch,
          })
        }
      } catch (err) {
        this.logger.error(`Failed to fetch ${file.path}: ${err}`)
      }
    }

    return files
  }

  // 取得所有有 rag-kb topic 的 repo 的 .md 檔案
  async getAllMarkdownFiles(): Promise<TGitHubFile[]> {
    const repos = await this.getTaggedRepos() // 自動取得有 topic 的 repo 清單
    const allFiles: TGitHubFile[] = []
    for (const repo of repos) {
      const files = await this.getRepoMarkdownFiles(repo)
      allFiles.push(...files)
    }
    return allFiles
  }
}