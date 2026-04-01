import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class EmbeddingService {
  // Logger 是 NestJS 內建的日誌工具，方便在終端機看到執行狀態
  private readonly logger = new Logger(EmbeddingService.name);
  private openai: OpenAI;

  constructor(private configService: ConfigService) {
    // 建立 OpenAI client，帶入 API Key
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY')!,
    });
  }

  // 將單一文字轉成向量（1536 維的數字陣列）
  async embedText(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small', // 使用的 embedding 模型
      input: text,
    });
    return response.data[0].embedding; // 回傳向量陣列
  }

  // 將多筆文字批次轉成向量（避免一筆一筆呼叫 API，減少請求次數）
  async embedBatch(texts: string[]): Promise<number[][]> {
    this.logger.log(`Embedding ${texts.length} chunks...`);

    // 每次最多送 100 筆給 OpenAI（避免超過 API 限制）
    const batchSize = 100;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize); // 取出這一批

      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: batch,
      });

      // 把這批結果加入 results 陣列
      results.push(...response.data.map((item) => item.embedding));
      this.logger.log(
        `Embedded ${Math.min(i + batchSize, texts.length)} / ${texts.length}`,
      );
    }

    return results;
  }
}
