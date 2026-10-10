import { test as base, expect, type Page } from '@playwright/test';

/**
 * 瀏覽器測試共用的設定：
 * - 時間固定在 FIXED_NOW（台灣時間的平日上班時間），MSW 的預設資料、「今天」、假日標示才固定
 * - 外部資源換成假的：Google 登入腳本（不連 Google）、台灣行事曆（10/9、10/10 放假）、字型（不下載）
 * - loggedIn: true 時在 sessionStorage 放一個擁有者的假 ID Token，直接進管理畫面（MSW 不驗證 token）
 */
export const FIXED_NOW = new Date('2026-10-07T10:00:00+08:00');
export const TODAY = '2026-10-07';
export const OWNER_EMAIL = 'swzx00@gmail.com';

/** ruyut/TaiwanCalendar 格式的一整年資料：週末與 holidays 放假 */
const makeCalendar = (year: number, holidays: Record<string, string>) => {
  const week = ['日', '一', '二', '三', '四', '五', '六'];
  const entries = [];
  for (let d = new Date(Date.UTC(year, 0, 1)); d.getUTCFullYear() === year;) {
    const iso = d.toISOString().slice(0, 10);
    const day = d.getUTCDay();
    entries.push({
      date: iso.replaceAll('-', ''),
      week: week[day],
      isHoliday: holidays[iso] !== undefined || day === 0 || day === 6,
      description: holidays[iso] ?? '',
    });
    d = new Date(d.getTime() + 86_400_000);
  }
  return entries;
};

/** 假的 Google 登入腳本：renderButton 放一顆按鈕，其他什麼都不做 */
const FAKE_GIS = `
window.google = { accounts: { id: {
  initialize() {},
  disableAutoSelect() {},
  renderButton(el) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '使用 Google 帳戶登入';
    el.appendChild(button);
  },
} } };
`;

const fakeIdToken = (email: string): string => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ email })}.sig`;
};

const prepare = async (page: Page, loggedIn: boolean): Promise<void> => {
  await page.clock.setFixedTime(FIXED_NOW);
  // 用 context.route 不用 page.route：MSW 的 Service Worker 放行的請求是從 Worker 發出的，page.route 攔不到
  const context = page.context();
  await context.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: FAKE_GIS }),
  );
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await context.route(
    /cdn\.jsdelivr\.net\/gh\/ruyut\/TaiwanCalendar\/data\/(\d{4})\.json/,
    (route) => {
      const year = Number(/(\d{4})\.json/.exec(route.request().url())![1]);
      return route.fulfill({
        json: makeCalendar(year, { [`${year}-10-09`]: '國慶日補假', [`${year}-10-10`]: '國慶日' }),
      });
    },
  );
  if (loggedIn) {
    await page.addInitScript((token) => {
      sessionStorage.setItem('google_id_token', token);
    }, fakeIdToken(OWNER_EMAIL));
  }
};

export const test = base.extend<{ loggedIn: boolean }>({
  loggedIn: [false, { option: true }],
  page: async ({ page, loggedIn }, use) => {
    await prepare(page, loggedIn);
    await use(page);
  },
});

/** 打開首頁，等今天的紀錄載入完 */
export const openHome = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(page.locator('.work-item-table__row[data-id]').first()).toBeVisible();
};

export { expect };
