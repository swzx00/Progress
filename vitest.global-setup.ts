/**
 * Vitest 全域設定：在測試 worker 啟動前把時區固定成台灣（UTC+8）。
 * 前端的日期字串一律用本地時間（src/utils/date.ts），測試結果會受機器時區影響，
 * 固定之後本機（Windows）跟 CI（UTC）跑出來的結果才一致
 */
export default function setup(): void {
  process.env.TZ = 'Asia/Taipei';
}
