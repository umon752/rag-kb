import {
  Controller,
  Post,
  Headers,
  Body,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { SyncService } from './sync.service';
import { IngestionService } from '../ingestion/ingestion.service';

@Controller()
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

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
    this.verifyGithubSignature(signature, JSON.stringify(payload));

    const ref = payload['ref'] as string;
    const repository = payload['repository'] as {
      full_name: string;
      default_branch: string;
    };
    const commits = payload['commits'] as Array<{
      added: string[];
      modified: string[];
      removed: string[];
    }>;

    // 只處理推送到預設分支的事件（避免處理 feature branch）
    if (!ref?.endsWith(repository?.default_branch)) {
      return { ok: true };
    }

    // 收集所有新增或修改的 .md 檔案
    const changedFiles = commits
      .flatMap((c) => [...(c.added ?? []), ...(c.modified ?? [])])
      .filter((f) => f.endsWith('.md'));

    // 收集所有刪除的 .md 檔案（從 DB 移除）
    const removedFiles = commits
      .flatMap((c) => c.removed ?? [])
      .filter((f) => f.endsWith('.md'));

    const repoName = repository.full_name.split('/')[1];

    // 重新 ingest 變動的檔案
    for (const filePath of changedFiles) {
      try {
        await this.ingestionService.ingestGithubFile(repoName, filePath);
        this.logger.log(`Webhook: ingested ${repoName}/${filePath}`);
      } catch (error) {
        this.logger.error(`Webhook: failed to ingest ${filePath}`, error);
      }
    }

    // 刪除被移除的檔案
    // (IngestionService.deleteGithubFile 將在下方補充)
    for (const filePath of removedFiles) {
      try {
        await this.ingestionService.deleteGithubFile(repoName, filePath);
        this.logger.log(`Webhook: deleted ${repoName}/${filePath}`);
      } catch (error) {
        this.logger.error(`Webhook: failed to delete ${filePath}`, error);
      }
    }

    return { ok: true };
  }

  // 手動觸發全量同步（開發/管理用）
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async manualSync(): Promise<unknown> {
    this.logger.log('Manual sync triggered');
    return this.syncService.syncAll();
  }

  // 驗證 GitHub Webhook 簽名（HMAC-SHA256）
  private verifyGithubSignature(signature: string, body: string): void {
    const secret = this.configService.get<string>('GITHUB_WEBHOOK_SECRET');
    if (!secret) return; // 若未設定 secret，跳過驗證（本地開發時可用）

    const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    if (signature !== expected) {
      throw new UnauthorizedException('Invalid GitHub webhook signature');
    }
  }
}
