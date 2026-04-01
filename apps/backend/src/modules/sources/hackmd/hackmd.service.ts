import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// 定義 HackMD 筆記的資料結構
type THackMDNote = {
  id: string; // 筆記的唯一識別碼
  title: string; // 筆記標題
  content: string; // 筆記的 markdown 內容
  publishLink: string; // 公開連結
  lastChangedAt: string; // 最後修改時間
};

@Injectable()
export class HackmdService {
  private readonly logger = new Logger(HackmdService.name);
  private readonly baseUrl = 'https://api.hackmd.io/v1';
  private readonly token: string;

  constructor(private configService: ConfigService) {
    this.token = this.configService.get<string>('HACKMD_API_TOKEN')!;
  }

  // 取得認證用的 HTTP header
  private get headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  // 取得所有筆記清單（不含內容）
  // 使用 Node.js 內建 fetch，不需要安裝 axios
  async getNoteList(): Promise<{ id: string; title: string }[]> {
    this.logger.log('Fetching HackMD note list...');
    const res = await fetch(`${this.baseUrl}/notes`, { headers: this.headers });
    if (!res.ok) throw new Error(`HackMD API error: ${res.status}`);
    return res.json() as Promise<{ id: string; title: string }[]>;
  }

  // 取得單一筆記的完整內容
  async getNoteContent(noteId: string): Promise<THackMDNote> {
    const res = await fetch(`${this.baseUrl}/notes/${noteId}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`HackMD API error: ${res.status}`);
    return res.json() as Promise<THackMDNote>;
  }

  // 取得所有筆記的完整內容（清單 + 逐一抓內容）
  async getAllNotes(): Promise<THackMDNote[]> {
    const list = await this.getNoteList();
    this.logger.log(`Found ${list.length} notes, fetching content...`);

    const notes: THackMDNote[] = [];
    for (const item of list) {
      try {
        const note = await this.getNoteContent(item.id);
        notes.push(note);
      } catch (err) {
        // 單筆失敗不中斷，記錄錯誤後繼續
        this.logger.error(`Failed to fetch note ${item.id}: ${err}`);
      }
    }
    return notes;
  }
}
