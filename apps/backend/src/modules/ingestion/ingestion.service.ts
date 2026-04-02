import { Injectable, Logger } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { SupabaseService } from '../supabase/supabase.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { HackmdService } from '../sources/hackmd/hackmd.service';
import { GithubService } from '../sources/github/github.service';

// 定義 ingestion 結果的回傳型別
type TIngestionResult = {
  source: string; // 來源名稱，例如 'hackmd' 或 'github'
  total: number; // 總共處理幾筆文件
  chunks: number; // 總共切出幾個 chunk
  errors: number; // 失敗幾筆
};

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  // 文字切塊器設定：每塊約 512 字元，相鄰塊重疊 50 字元
  // overlap（重疊）的目的是避免重要內容剛好被切在兩塊的邊界
  private splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 512,
    chunkOverlap: 50,
  });

  constructor(
    private supabaseService: SupabaseService,
    private embeddingService: EmbeddingService,
    private hackmdService: HackmdService,
    private githubService: GithubService,
  ) {}

  // 同步單一 HackMD 筆記（Webhook 觸發時使用）
  async ingestHackmdNote(noteId: string): Promise<void> {
    this.logger.log(`Ingesting HackMD note: ${noteId}`);
    const note = await this.hackmdService.getNoteContent(noteId);
    await this.ingestDocument({
      sourceType: 'hackmd',
      sourceId: note.id,
      title: note.title,
      content: note.content,
      metadata: { url: note.publishLink },
    });
  }

  // 全量同步所有 HackMD 筆記
  async ingestAllHackmd(): Promise<TIngestionResult> {
    this.logger.log('Starting full HackMD ingestion...');
    const notes = await this.hackmdService.getAllNotes();
    let chunks = 0;
    let errors = 0;

    for (const note of notes) {
      try {
        await this.ingestDocument({
          sourceType: 'hackmd',
          sourceId: note.id,
          title: note.title,
          content: note.content,
          metadata: { url: note.publishLink },
        });
        chunks++;
      } catch {
        errors++;
      }
    }

    return { source: 'hackmd', total: notes.length, chunks, errors };
  }

  // 全量同步所有 GitHub .md 檔案
  async ingestAllGithub(): Promise<TIngestionResult> {
    this.logger.log('Starting full GitHub ingestion...');
    const files = await this.githubService.getAllMarkdownFiles();
    let chunks = 0;
    let errors = 0;

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
        });
        chunks++;
      } catch {
        errors++;
      }
    }

    return { source: 'github', total: files.length, chunks, errors };
  }

  // 同步單一 GitHub .md 檔案（Webhook 觸發時使用）
  async ingestGithubFile(repo: string, filePath: string): Promise<void> {
    const file = await this.githubService.getFileContent(repo, filePath);
    await this.ingestDocument({
      sourceType: 'github',
      sourceId: `${repo}/${filePath}`,
      title: filePath,
      content: file.content,
      metadata: { url: file.url, repo, file_path: filePath },
    });
  }

  // 刪除單一 GitHub .md 檔案的所有 chunk（Webhook push 刪除事件）
  async deleteGithubFile(repo: string, filePath: string): Promise<void> {
    await this.supabaseService.deleteDocumentsBySource(
      'github',
      `${repo}/${filePath}`,
    );
  }

  // 同步單一 GitHub repo 的所有 .md 檔案（Cron 逐 repo 觸發時使用）
  async ingestAllGithubRepo(repoName: string): Promise<void> {
    const files = await this.githubService.getRepoMarkdownFiles(repoName);

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
      });
    }
  }

  // 核心方法：將單一文件切塊 → embed → 先刪舊資料 → 寫入 Supabase
  private async ingestDocument(doc: {
    sourceType: string;
    sourceId: string;
    title?: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    // 第一步：切塊，把長文件切成多個小 chunk
    const chunks = await this.splitter.splitText(doc.content);
    if (chunks.length === 0) return;

    // 第二步：批次 embed，把所有 chunk 轉成向量
    const embeddings = await this.embeddingService.embedBatch(chunks);

    // 第三步：先刪除此來源的所有舊資料（解決文章內容更新時舊 chunk 殘留的問題）
    await this.supabaseService.deleteDocumentsBySource(
      doc.sourceType,
      doc.sourceId,
    );

    // 第四步：整理資料格式，準備寫入 DB
    const documents = chunks.map((chunk, i) => ({
      source_type: doc.sourceType,
      source_id: doc.sourceId,
      title: doc.title,
      content: chunk,
      embedding: embeddings[i],
      metadata: doc.metadata ?? {},
    }));

    // 第五步：寫入 Supabase
    await this.supabaseService.upsertDocuments(documents);
    this.logger.log(
      `Ingested ${chunks.length} chunks for ${doc.sourceType}:${doc.sourceId}`,
    );
  }
}
