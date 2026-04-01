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