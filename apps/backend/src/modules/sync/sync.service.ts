import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { IngestionService } from '../ingestion/ingestion.service'
import { SupabaseService } from '../supabase/supabase.service'
import { HackmdService } from '../sources/hackmd/hackmd.service'
import { GithubService } from '../sources/github/github.service'

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name)

  constructor(
    private ingestionService: IngestionService,
    private supabaseService: SupabaseService,
    private hackmdService: HackmdService,
    private githubService: GithubService,
  ) {}

  // 每天凌晨 0 點同步 HackMD（因無 Webhook，改用輪詢）
  // 搭配 lastChangedAt diff 檢查，只 ingest 有變動的筆記，節省 token 消耗
  @Cron('0 0 * * *')
  async syncHackmd(): Promise<void> {
    this.logger.log('[Cron] 開始同步 HackMD...')
    try {
      const notes = await this.hackmdService.getAllNotes()
      let updated = 0
      let skipped = 0
      let errors = 0

      for (const note of notes) {
        try {
          // 查詢此筆記上次同步時間
          const lastSyncedAt = await this.supabaseService.getLastSyncedAt('hackmd', note.id)

          // 若上次同步時間存在，且筆記沒有更新，則跳過（節省 embedding token）
          if (lastSyncedAt && new Date(note.lastChangedAt) <= new Date(lastSyncedAt)) {
            skipped++
            continue
          }

          // 有變動才重新 ingest
          await this.ingestionService.ingestHackmdNote(note.id)
          updated++
        } catch {
          errors++
        }
      }

      const result = { total: notes.length, updated, skipped, errors }
      this.logger.log(
        `[Cron] HackMD 同步完成：共 ${result.total} 篇，更新 ${result.updated}，跳過 ${result.skipped}，錯誤 ${result.errors}`,
      )
      await this.supabaseService.writeSyncLog('hackmd', 'success', result)
    } catch (error) {
      this.logger.error('[Cron] HackMD 同步失敗', error)
      await this.supabaseService.writeSyncLog('hackmd', 'error', { message: String(error) })
    }
  }

  // 每天凌晨 2 點同步 GitHub
  // 以 repo 層級的 pushed_at 做 diff 檢查：repo 沒有新 push 就整個跳過，節省 API 與 token
  @Cron('0 2 * * *')
  async syncGithub(): Promise<void> {
    this.logger.log('[Cron] 開始同步 GitHub...')
    try {
      const repos = await this.githubService.getTaggedRepos()
      let updated = 0
      let skipped = 0
      let errors = 0

      for (const repo of repos) {
        try {
          // 查此 repo 上次同步時間（以 source_id = repo name 作為識別）
          const lastSyncedAt = await this.supabaseService.getLastSyncedAt('github-repo', repo.name)

          // repo 自上次同步後沒有任何 push，整個跳過（不重新 ingest，0 token 消耗）
          if (lastSyncedAt && new Date(repo.pushedAt) <= new Date(lastSyncedAt)) {
            skipped++
            continue
          }

          // 有 push 才重新 ingest 此 repo 所有 .md 檔案
          await this.ingestionService.ingestAllGithubRepo(repo.name)
          updated++
        } catch {
          errors++
        }
      }

      const result = { total: repos.length, updated, skipped, errors }
      this.logger.log(
        `[Cron] GitHub 同步完成：共 ${result.total} 個 repo，更新 ${result.updated}，跳過 ${result.skipped}，錯誤 ${result.errors}`,
      )
      await this.supabaseService.writeSyncLog('github', 'success', result)
    } catch (error) {
      this.logger.error('[Cron] GitHub 同步失敗', error)
      await this.supabaseService.writeSyncLog('github', 'error', { message: String(error) })
    }
  }

  // 手動觸發全量同步（供 POST /sync API 呼叫）
  async syncAll(): Promise<{ hackmd: unknown; github: unknown }> {
    this.logger.log('[Manual] 手動觸發全量同步...')
    const [hackmd, github] = await Promise.all([
      this.ingestionService.ingestAllHackmd(),
      this.ingestionService.ingestAllGithub(),
    ])
    await this.supabaseService.writeSyncLog('all', 'success', { hackmd, github })
    return { hackmd, github }
  }
}