import { dataRows } from './helpers';
import { expect, openHome, test } from './fixtures';

/**
 * 文字截斷（ClampText）：收合時手機 3 行、平板桌面 2 行，被截斷才出現「…<展開>」；
 * 點了整列展開、出現「<收合>」；有滑鼠的裝置滑過顯示全文 tooltip
 */
test.use({ loggedIn: true });

const LONG_TEXT = '完成首頁 RWD 調整，'.repeat(30);

/** 把第一筆的處理內容改成很長的文字 */
const saveLongDetail = async (page: import('@playwright/test').Page) => {
  await openHome(page);
  await dataRows(page).first().getByRole('button', { name: '編輯' }).first().click();
  await page.getByLabel('處理內容').fill(LONG_TEXT);
  await page.getByRole('button', { name: '儲存' }).click();
  await expect(page.locator('.work-item-form')).toBeHidden();
};

const detailCell = (page: import('@playwright/test').Page) =>
  dataRows(page).first().locator('.work-item-table__cell--detail');

const lineCount = (cell: import('@playwright/test').Locator) =>
  cell.locator('.clamp-text__body').evaluate((el) => {
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
    return Math.round(el.getBoundingClientRect().height / lineHeight);
  });

test('長文字收合時截斷到指定行數，出現「<展開>」；展開後全文、出現「<收合>」', async ({
  page,
}, testInfo) => {
  await saveLongDetail(page);
  const cell = detailCell(page);
  const expand = cell.getByRole('button', { name: '<展開>' });
  await expect(expand).toBeVisible();
  expect(await lineCount(cell)).toBe(testInfo.project.name === 'mobile' ? 3 : 2);

  await expand.click();
  await expect(cell.getByRole('button', { name: '<收合>' })).toBeVisible();
  expect(await lineCount(cell)).toBeGreaterThan(3);
  await expect(dataRows(page).first()).toHaveClass(/work-item-table__row--expanded/);

  await cell.getByRole('button', { name: '<收合>' }).click();
  await expect(expand).toBeVisible();
});

test('短文字不截斷，沒有「<展開>」', async ({ page }) => {
  await openHome(page);
  await expect(detailCell(page).getByRole('button', { name: '<展開>' })).toHaveCount(0);
});

test('有滑鼠的裝置：滑過被截斷的文字顯示全文；觸控裝置不顯示', async ({ page }, testInfo) => {
  await saveLongDetail(page);
  await detailCell(page).locator('.clamp-text__body').hover();
  const tooltip = page.locator('.n-tooltip', { hasText: LONG_TEXT.trim() });
  if (testInfo.project.name === 'mobile') {
    await page.waitForTimeout(600);
    await expect(tooltip).toHaveCount(0);
  } else {
    await expect(tooltip).toBeVisible();
  }
});
