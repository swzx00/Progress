import { css, dataRows, tokenColor } from './helpers';
import { expect, openHome, test } from './fixtures';

/**
 * RWD（CLAUDE.md「RWD 斷點」）：手機 < 768 卡片式列表、平板 768–1023 表格但完成度／今日工時／預計期限合併、
 * 桌面 ≥ 1024 每個欄位各一欄；三種寬度都不能出現橫向捲軸
 */
test.use({ loggedIn: true });

const header = (page: import('@playwright/test').Page) =>
  page.locator('.work-item-table__row--header');

test('畫面不會出現橫向捲軸', async ({ page }) => {
  await openHome(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('版面依斷點切換', async ({ page }, testInfo) => {
  await openHome(page);
  const project = testInfo.project.name;
  if (project === 'mobile') {
    // 卡片：沒有表頭，處理內容前面有「處理內容：」，工時寫成「工時：4hr」
    await expect(header(page)).toBeHidden();
    const first = dataRows(page).first();
    await expect(first.locator('.work-item-table__mobile-label').first()).toBeVisible();
    await expect(first).toContainText('工時：4hr');
    return;
  }
  await expect(header(page)).toBeVisible();
  const headerText = await header(page).innerText();
  if (project === 'tablet') {
    // 平板：完成度、今日工時、預計期限合併成一欄，不各自一欄
    expect(headerText).not.toContain('預計期限');
  } else {
    for (const label of ['今日工時', '完成度', '預計期限', '狀態', '操作']) {
      expect(headerText).toContain(label);
    }
  }
  // 平板、桌面每一列的高度一致排成表格：同一列的儲存格頂端對齊在列內
  const row = dataRows(page).first();
  const box = (await row.boundingBox())!;
  const cells = row.locator('> .work-item-table__cell:visible');
  for (const cell of await cells.all()) {
    const cellBox = (await cell.boundingBox())!;
    expect(cellBox.y).toBeGreaterThanOrEqual(box.y - 1);
    expect(cellBox.y + cellBox.height).toBeLessThanOrEqual(box.y + box.height + 1);
  }
});

test('逾期列的左側紅色標線與「逾期」標籤', async ({ page }) => {
  await openHome(page);
  const overdue = page.locator('.work-item-table__row--overdue').first();
  await expect(overdue).toBeVisible();
  const red = await tokenColor(page, 'red-600');
  expect(await css(overdue, 'box-shadow')).toContain(red);
  await expect(overdue.locator('.work-item-table__badge')).toHaveText('逾期');
});

test('換到國定假日：顯示假日名稱與放假的空狀態', async ({ page }) => {
  await openHome(page);
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '下一天' }).click();
  await expect(page.getByText('國慶日補假').first()).toBeVisible();
  await expect(page.locator('.work-item-table__empty')).toHaveText('這天放假呦！');
});
