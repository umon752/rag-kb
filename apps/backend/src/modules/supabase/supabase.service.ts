import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// 定義文件的資料結構型別
type TDocument = {
  source_type: string; // 來源類型：'hackmd' | 'github'
  source_id: string; // 來源識別碼
  title?: string; // 標題（選填，? 代表可以不傳）
  content: string; // 文字內容（chunk）
  embedding: number[]; // 向量陣列（由 OpenAI embedding 產生）
  metadata?: Record<string, unknown>; // 額外資訊（url、repo 等），選填
};

// 定義搜尋結果的資料結構型別
type TSearchResult = {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number; // 相似度分數（0~1，越高越相似）
};

// @Injectable() 是 NestJS 的裝飾器
// 告訴 NestJS 這個 class 是可以被「注入」到其他地方使用的服務
// NestJS 會自動幫你建立並管理這個 class 的實例，不需要手動 new SupabaseService()
@Injectable()
export class SupabaseService {
  // 宣告一個私有變數存放 Supabase client 實例
  // private 代表只有這個 class 內部可以使用
  private client: SupabaseClient;

  // constructor 是 class 初始化時自動執行的方法
  // 這裡透過依賴注入取得 ConfigService（讀取 .env 的服務）
  // NestJS 看到 constructor 參數有型別標注，就會自動把對應的服務傳進來
  constructor(private configService: ConfigService) {
    // 用 .env 裡的值建立 Supabase client
    // configService.get() 就是讀取環境變數的方法
    // 末尾的 ! 是 TypeScript 語法，告訴編譯器「這個值一定存在，不是 undefined」
    this.client = createClient(
      this.configService.get<string>('SUPABASE_URL')!,
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY')!,
    );
  }

  // async 代表這是非同步方法（等待資料庫回應）
  // 寫入或更新文件向量（若已存在相同 source_type + source_id + content 則忽略）
  async upsertDocuments(documents: TDocument[]): Promise<void> {
    const { error } = await this.client
      .from('documents') // 指定操作 documents 表
      .upsert(documents, { onConflict: 'source_type,source_id,content' });
    // upsert = insert + update：有就更新，沒有就新增
    // onConflict：遇到重複的資料時用哪些欄位判斷「是同一筆」

    // 如果資料庫回傳錯誤，拋出例外讓呼叫方知道
    if (error) throw new Error(`upsertDocuments failed: ${error.message}`);
  }

  // 依向量相似度搜尋最相關的文件
  // embedding：問題轉成的向量，matchCount：要回傳幾筆結果（預設 5 筆）
  async matchDocuments(
    embedding: number[],
    matchCount = 5,
  ): Promise<TSearchResult[]> {
    const { data, error } = await this.client.rpc('match_documents', {
      // rpc 是呼叫 Supabase 裡的自訂 SQL function（就是 Step 2 建立的那個）
      query_embedding: embedding,
      match_count: matchCount,
    });

    if (error) throw new Error(`matchDocuments failed: ${error.message}`);
    return data as TSearchResult[];
  }

  // 刪除指定來源的所有 chunk（文章更新時先清除舊資料）
  async deleteDocumentsBySource(sourceType: string, sourceId: string): Promise<void> {
    const { error } = await this.client
      .from('documents')
      .delete()
      .match({ source_type: sourceType, source_id: sourceId })
      // .match() 是指定條件，等同於 WHERE source_type = ? AND source_id = ?

    if (error) throw new Error(`deleteDocumentsBySource failed: ${error.message}`)
  }
}
