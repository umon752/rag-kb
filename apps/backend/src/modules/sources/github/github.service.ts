import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';

// 定義從 GitHub 抓取的檔案資料結構
type TGitHubFile = {
  repo: string; // repo 名稱，例如 'umon752/my-notes'
  path: string; // 檔案路徑，例如 'docs/intro.md'
  content: string; // 檔案的文字內容
  url: string; // GitHub 上的檔案連結
  branch: string; // 所在分支，例如 'main'
};

// 回傳型別：repo 基本資訊 + pushedAt 供 diff 比對
type TRepoInfo = {
  name: string; // repo 名稱（不含 owner）
  pushedAt: string; // 最後 push 時間（ISO 8601）
};

// 不需要抓取的路徑（過濾掉無用的目錄）
const IGNORE_PATHS = ['node_modules/', 'dist/', '.env', '.git/'];

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);
  private octokit: Octokit;

  constructor(private configService: ConfigService) {
    this.octokit = new Octokit({
      auth: this.configService.get<string>('GITHUB_TOKEN')!,
    });
  }

  // 取得所有有 rag-kb topic 的 repo 列表（含 pushedAt 供 diff 比對）
  async getTaggedRepos(): Promise<TRepoInfo[]> {
    const owner = this.configService.get<string>('GITHUB_OWNER')!;
    const topic = this.configService.get<string>('GITHUB_TOPIC')!;

    const { data } = await this.octokit.search.repos({
      q: `user:${owner} topic:${topic}`,
      per_page: 100,
    });

    return data.items.map((repo) => ({
      name: repo.name,
      pushedAt: repo.pushed_at ?? new Date(0).toISOString(),
      // pushed_at 可能為 null（空 repo），預設為很舊的時間確保首次一定會 ingest
    }));
  }

  // 取得指定 repo 所有 .md 檔案（供 ingestAllGithubRepo 使用）
  async getRepoMarkdownFiles(
    repoName: string,
  ): Promise<
    Array<{ path: string; content: string; url: string; branch: string }>
  > {
    const owner = this.configService.get<string>('GITHUB_OWNER')!;

    // 取得預設分支名稱
    const { data: repoData } = await this.octokit.repos.get({
      owner,
      repo: repoName,
    });
    const branch = repoData.default_branch;

    // 取得整個 repo 的檔案樹
    const { data: tree } = await this.octokit.git.getTree({
      owner,
      repo: repoName,
      tree_sha: branch,
      recursive: 'true',
    });

    const mdFiles = tree.tree.filter(
      (f) => f.path?.endsWith('.md') && f.type === 'blob',
    );
    const results: Array<{ path: string; content: string; url: string; branch: string }> = [];

    for (const file of mdFiles) {
      try {
        const { data } = await this.octokit.repos.getContent({
          owner,
          repo: repoName,
          path: file.path!,
        });
        if (Array.isArray(data) || data.type !== 'file') continue;

        results.push({
          path: file.path!,
          content: Buffer.from(data.content, 'base64').toString('utf-8'),
          url: data.html_url ?? '',
          branch,
        });
      } catch {
        // 單一檔案失敗不中斷整個 repo
      }
    }

    return results;
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
    const owner = this.configService.get<string>('GITHUB_OWNER')!;

    const { data } = await this.octokit.repos.getContent({
      owner,
      repo,
      path: filePath,
    });

    if (Array.isArray(data) || data.type !== 'file') {
      throw new Error(`${filePath} is not a file`);
    }

    return {
      content: Buffer.from(data.content, 'base64').toString('utf-8'),
      url: data.html_url ?? '',
    };
  }
}
