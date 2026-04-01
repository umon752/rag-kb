import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './modules/config/config.module';
import { SupabaseModule } from './modules/supabase/supabase.module';
import { EmbeddingModule } from './modules/embedding/embedding.module';
import { HackmdModule } from './modules/sources/hackmd/hackmd.module';
import { GithubModule } from './modules/sources/github/github.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';

@Module({
  imports: [
    ConfigModule, // 環境變數模組（必須在最前面）
    SupabaseModule, // Supabase 資料庫連線模組
    EmbeddingModule, // OpenAI Embedding 模組
    HackmdModule, // HackMD 資料來源模組
    GithubModule, // GitHub 資料來源模組
    IngestionModule, // 文件 ingestion pipeline 模組
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
