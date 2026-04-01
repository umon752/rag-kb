import { Module } from '@nestjs/common';
import { HackmdService } from './hackmd.service';

@Module({
  providers: [HackmdService],
  exports: [HackmdService],
})
export class HackmdModule {}
