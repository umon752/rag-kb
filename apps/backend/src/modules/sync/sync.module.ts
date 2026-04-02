import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { IngestionModule } from '../ingestion/ingestion.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { HackmdModule } from '../sources/hackmd/hackmd.module';
import { GithubModule } from '../sources/github/github.module';

@Module({
  imports: [
    IngestionModule, // 需要 IngestionService 執行 ingestion
    SupabaseModule, // 需要 SupabaseService 寫 sync_logs
    HackmdModule, // 需要 HackmdService（SyncService 間接用到）
    GithubModule, // 需要 GithubService（SyncService 間接用到）
  ],
  controllers: [SyncController], // 加入 Controller 處理 HTTP 請求
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
