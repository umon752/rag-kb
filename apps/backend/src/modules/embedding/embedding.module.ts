import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';

@Module({
  providers: [EmbeddingService], // 註冊服務
  exports: [EmbeddingService], // 匯出給其他模組使用
})
export class EmbeddingModule {}
