import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

// @Global() 讓這個模組在整個專案都可用，不需要每個模組單獨 import
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true, // 環境變數全域可用
      envFilePath: '.env', // 指定讀取 .env 檔案
    }),
  ],
})
export class ConfigModule {}
