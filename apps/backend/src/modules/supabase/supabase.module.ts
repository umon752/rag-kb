import { Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

// @Module() 是 NestJS 的裝飾器，用來定義模組
// 模組是 NestJS 組織程式碼的基本單位，每個功能都封裝成一個模組
@Module({
  providers: [SupabaseService], // 這個模組提供的服務，NestJS 會幫你建立實例
  exports: [SupabaseService], // 匯出給其他模組使用（不加 exports 的話外部無法注入）
})
export class SupabaseModule {}
