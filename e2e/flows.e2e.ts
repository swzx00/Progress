import type { Locator, Page } from '@playwright/test';

import { dataRows } from './helpers';
import { expect, openHome, test } from './fixtures';

/**
 * 完整操作流程：在真的瀏覽器裡新增、編輯、刪除、請假、複製本日、調整順序、搜尋、匯出、本日總結。
 * 打 MSW 假後端（每次打開頁面資料重來），流程跟版面寬度無關，只在桌面跑（playwright.config.ts）。
 * 今天（2026/10/07）的預設資料：官網改版 4hr、會員系統優化 3hr、年度報告 1hr，共 8hr
 */
test.use({ loggedIn: true });

const drawer = (page: Page): Locator => page.locator('.work-item-form__panel');
const field = (page: Page, label: string): Locator =>
  drawer(page).locator('label', { hasText: label });

/** 從可搜尋下拉選單（NSelect）選一個值 */
const choose = async (page: Page, label: string, value: string): Promise<void> => {
  await field(page, label).locator('.n-base-selection').click();
  await page.locator('.n-base-select-option', { hasText: value }).first().click();
};

const save = (page: Page) => drawer(page).getByRole('button', { name: '儲存' }).click();
const toast = (page: Page): Locator => page.locator('.app-toast');
const targets = (page: Page) =>
  dataRows(page).locator('.work-item-table__cell--target').allInnerTexts();
const dailyTotal = (page: Page): Locator => page.getByText(/今日工時合計：/);

test('新增：選下拉、填欄位、儲存後出現在最後一筆，項次接續、工時合計更新', async ({ page }) => {
  await openHome(page);
  await page.getByRole('button', { name: '新增' }).click();
  await expect(drawer(page).getByText('4', { exact: true })).toBeVisible();
  await choose(page, '交辦單位', '資訊部');
  await choose(page, '交辦人員', '王小明');
  await choose(page, '專案名稱', '官網改版');
  await field(page, '工作目標').locator('textarea').fill('E2E 新增的紀錄');
  await field(page, '今日工時').locator('input').fill('2');
  await save(page);

  await expect(drawer(page)).toBeHidden();
  await expect(dataRows(page)).toHaveCount(4);
  expect((await targets(page)).at(-1)).toContain('E2E 新增的紀錄');
  await expect(dataRows(page).last().locator('.work-item-table__cell--index')).toContainText('4');
  await expect(dailyTotal(page)).toContainText('10hr');
});

test('新增：沒填必填欄位不送出，顯示錯誤', async ({ page }) => {
  await openHome(page);
  await page.getByRole('button', { name: '新增' }).click();
  await save(page);
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).locator('.work-item-form__error').first()).toBeVisible();
  await expect(dataRows(page)).toHaveCount(3);
});

test('新增：當天工時合計超過 24 小時被擋下', async ({ page }) => {
  await openHome(page);
  await page.getByRole('button', { name: '新增' }).click();
  await choose(page, '交辦單位', '資訊部');
  await choose(page, '交辦人員', '王小明');
  await choose(page, '專案名稱', '官網改版');
  await field(page, '工作目標').locator('textarea').fill('超時');
  await field(page, '今日工時').locator('input').fill('17');
  await save(page);
  await expect(drawer(page)).toContainText('當天工時合計不可超過 24 小時');
  await expect(drawer(page)).toBeVisible();
});

test('編輯：改工作目標，表格跟著更新；改了沒存按取消會先確認', async ({ page }) => {
  await openHome(page);
  await dataRows(page).first().getByRole('button', { name: '編輯' }).first().click();
  const target = field(page, '工作目標').locator('textarea');
  await expect(target).toHaveValue('首頁切版');

  await target.fill('改過的目標');
  await drawer(page).getByRole('button', { name: '取消' }).click();
  const confirm = page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog').filter({ hasText: '放棄' }));
  await expect(confirm.first()).toBeVisible();
  await confirm
    .first()
    .getByRole('button', { name: /繼續編輯|取消/ })
    .first()
    .click();
  await expect(drawer(page)).toBeVisible();

  await save(page);
  await expect(drawer(page)).toBeHidden();
  expect((await targets(page))[0]).toContain('改過的目標');
});

test('刪除：先確認，確認後那筆消失、工時合計更新', async ({ page }) => {
  await openHome(page);
  await dataRows(page).first().getByRole('button', { name: '刪除' }).first().click();
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({
    hasText: '確定要刪除這筆紀錄嗎？',
  });
  await expect(confirm).toContainText('官網改版');
  await confirm.getByRole('button', { name: '刪除' }).click();
  await expect(dataRows(page)).toHaveCount(2);
  expect(await targets(page)).not.toContain('首頁切版');
  await expect(dailyTotal(page)).toContainText('4hr');
});

test('請假：選假別、時數，儲存後是請假列', async ({ page }) => {
  await openHome(page);
  await page.getByRole('button', { name: '請假' }).click();
  await choose(page, '假別', '特休');
  await field(page, '請假時數').locator('input').fill('4');
  await save(page);
  await expect(drawer(page)).toBeHidden();
  await expect(page.locator('.work-item-table__row--leave')).toHaveCount(1);
  await expect(dailyTotal(page)).toContainText('12hr');
});

test('複製本日：預設下一個工作日，複製後跳到那天、筆數相同、工時歸零', async ({ page }) => {
  await openHome(page);
  await page.getByRole('button', { name: '複製本日' }).click();
  const dialog = page.locator('.copy-day-dialog__panel');
  await expect(dialog.locator('input[type="date"]')).toHaveValue('2026-10-08');
  await dialog.getByRole('button', { name: '複製', exact: true }).click();
  await expect(toast(page)).toContainText('已複製 3 筆紀錄到 2026/10/08');
  await expect(page.getByRole('textbox', { name: '選擇日期' })).toHaveValue(/2026\/10\/08/);
  await expect(dataRows(page)).toHaveCount(3);
  // 處理內容、今日工時是當天的內容，複製後清空（docs/ui/copy.md）
  await expect(dailyTotal(page)).toContainText('0hr');
});

test('調整順序：下移後順序改變，換天再回來還是新的順序', async ({ page }) => {
  await openHome(page);
  await dataRows(page)
    .first()
    .locator('.work-item-table__cell--index')
    .getByRole('button', { name: '下移' })
    .click();
  await expect.poll(() => targets(page)).toEqual(['登入流程重構', '首頁切版', '資料彙整']);
  await page.getByRole('button', { name: '下一天' }).click();
  await page.getByRole('button', { name: '上一天' }).click();
  await expect.poll(() => targets(page)).toEqual(['登入流程重構', '首頁切版', '資料彙整']);
});

test('拖曳排序：把第一筆拖到最後，存檔後順序維持', async ({ page }) => {
  await openHome(page);
  const handle = (i: number) => dataRows(page).nth(i).locator('.work-item-table__drag-handle');
  const from = (await handle(0).boundingBox())!;
  const to = (await dataRows(page).nth(2).boundingBox())!;
  // 拖曳用 Sortable 的 fallback 模式（滑鼠事件模擬），要一步一步移動才會觸發排序
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  const x = from.x + from.width / 2;
  const y = to.y + to.height - 5;
  await page.mouse.move(x, y, { steps: 20 });
  // Sortable 換位置有 150ms 動畫，機器忙的時候（WebKit 平行跑）滑鼠可能比動畫先到，
  // 放開前確認佔位（ghost）已經排到最後；還沒到就在原地小幅移動，讓 Sortable 重新判斷
  const ghostIsLast = () =>
    page
      .locator('.work-item-table__row[data-id]:not(.work-item-table__row--dragging)')
      .last()
      .evaluate((el) => el.classList.contains('work-item-table__row--ghost'));
  for (let i = 0; i < 10 && !(await ghostIsLast()); i++) {
    await page.waitForTimeout(200);
    await page.mouse.move(x, y + (i % 2 ? -3 : 3), { steps: 3 });
  }
  await page.mouse.up();
  await expect.poll(() => targets(page)).toEqual(['登入流程重構', '資料彙整', '首頁切版']);
  await page.getByRole('button', { name: '下一天' }).click();
  await page.getByRole('button', { name: '上一天' }).click();
  await expect.poll(() => targets(page)).toEqual(['登入流程重構', '資料彙整', '首頁切版']);
});

test('搜尋：Enter 搜尋全部紀錄，點結果的日期跳到那天、離開搜尋', async ({ page }) => {
  await openHome(page);
  const box = page.getByRole('combobox', { name: '搜尋全部紀錄' });
  await box.fill('官網');
  await box.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: '搜尋結果' })).toContainText('官網');
  const firstDate = dataRows(page).first().locator('.work-item-table__date-link');
  await firstDate.click();
  await expect(page.getByText('搜尋結果')).toBeHidden();
  await expect(box).toHaveValue('');
});

test('匯出 Excel：選月份匯出，下載的檔名是那個月、檔案是 xlsx', async ({ page }) => {
  // 測試用的 Chromium 對中文檔名一律回報成 download，改記下連結的 download 屬性來比對檔名
  await page.addInitScript(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      (window as unknown as { __downloadNames: string[] }).__downloadNames ??= [];
      (window as unknown as { __downloadNames: string[] }).__downloadNames.push(this.download);
      click.call(this);
    };
  });
  await openHome(page);
  await page.getByRole('button', { name: '工具' }).click();
  await page.locator('.n-dropdown-option', { hasText: '匯出 Excel' }).click();
  await page.getByRole('button', { name: '月份' }).click();
  const download = page.waitForEvent('download');
  await page.locator('.export-modal__export-btn').click();
  const file = await (await download).path();
  const names = await page.evaluate(
    () => (window as unknown as { __downloadNames: string[] }).__downloadNames,
  );
  expect(names).toEqual(['工作進度_2026-10.xlsx']);
  // xlsx 是 zip：開頭是 PK
  const { readFileSync } = await import('node:fs');
  expect(readFileSync(file).subarray(0, 2).toString()).toBe('PK');
  await expect(toast(page)).toContainText('已匯出');
});

test('本日總結：整理成文字', async ({ page }) => {
  await openHome(page);
  await page.getByRole('button', { name: '工具' }).click();
  await page.locator('.n-dropdown-option', { hasText: '本日總結' }).click();
  const text = page.getByRole('textbox', { name: '本日總結內容' });
  // 每筆是「項次.Repo 或專案名稱」＋「- 處理內容」（規則在 utils/day-summary）
  await expect(text).toHaveValue(/^1\.AAA,BBBB\n- 完成首頁 RWD 調整\n2\.member-web/);
  await expect(text).toHaveValue(/3\.年度報告\n- 等待業務部提供數據$/);
});

test('網址帶 ?date=：開到那天，切換日期同步網址（不新增瀏覽紀錄），重新整理還是那天', async ({
  page,
}) => {
  await page.goto('/?date=2026-10-06');
  await expect(dataRows(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: '回到今天' })).toBeVisible();

  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole('button', { name: '上一天' }).click();
  await expect(page).toHaveURL(/\?date=2026-10-05$/);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);

  await page.reload();
  await expect(page).toHaveURL(/\?date=2026-10-05$/);
  await expect(page.getByRole('button', { name: '回到今天' })).toBeVisible();

  await page.getByRole('button', { name: '回到今天' }).click();
  await expect(page).toHaveURL(/\?date=2026-10-07$/);
  await expect(dataRows(page)).toHaveCount(3);
});

test('網址的 date 不正確：退回今天，並把參數從網址拿掉', async ({ page }) => {
  await page.goto('/?date=2026-02-30');
  await expect(dataRows(page)).toHaveCount(3);
  await expect(page).toHaveURL(/\/$/);
});

test('網址帶 ?q=：開頁面就搜尋，搜尋同步網址，點工作日期離開搜尋、網址換成那天', async ({
  page,
}) => {
  await page.goto('/?q=官網');
  const box = page.getByRole('combobox', { name: '搜尋全部紀錄' });
  await expect(box).toHaveValue('官網');
  await expect(page.getByRole('status').filter({ hasText: '搜尋結果' })).toContainText('官網');

  await box.fill('首頁');
  await box.press('Enter');
  await expect(page).toHaveURL(/\?q=%E9%A6%96%E9%A0%81$/);

  await page.reload();
  await expect(box).toHaveValue('首頁');
  await dataRows(page).last().locator('.work-item-table__date-link').click();
  await expect(page.getByText('搜尋結果')).toBeHidden();
  await expect(page).toHaveURL(/\?date=2026-10-06$/);
});

test('有遮罩時頁面不能捲動、不顯示捲軸：表單上再疊確認對話框，全部關掉才還原', async ({ page }) => {
  await openHome(page);
  const overflow = () => page.evaluate(() => getComputedStyle(document.documentElement).overflowY);
  expect(await overflow()).not.toBe('hidden');

  await dataRows(page).first().getByRole('button', { name: '編輯' }).first().click();
  await expect(drawer(page)).toBeVisible();
  expect(await overflow()).toBe('hidden');

  // 改了沒存按取消：表單上面再開放棄變更的確認對話框，關掉確認對話框後表單還開著，仍然鎖著
  await field(page, '工作目標').locator('textarea').fill('改過的目標');
  await drawer(page).getByRole('button', { name: '取消' }).click();
  const confirm = page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog').filter({ hasText: '放棄' }));
  await expect(confirm.first()).toBeVisible();
  await confirm
    .first()
    .getByRole('button', { name: /繼續編輯|取消/ })
    .first()
    .click();
  await expect(drawer(page)).toBeVisible();
  expect(await overflow()).toBe('hidden');

  await save(page);
  await expect(drawer(page)).toBeHidden();
  await expect.poll(overflow).not.toBe('hidden');
});
