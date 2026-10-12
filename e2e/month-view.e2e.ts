import type { Page } from '@playwright/test';

import { css, dataRows, tokenColor } from './helpers';
import { expect, test } from './fixtures';

/**
 * 月份檢視（使用者決定）：日／月切換、共用表頭＋每天一列日期列、底色每天各自判斷、只能在同一天內調整順序。
 * MSW 預設資料：今天（2026/10/07）3 筆、昨天（10/06）1 筆
 */
const openMonth = async (page: Page): Promise<void> => {
  await page.goto('/?view=month');
  await expect(dataRows(page)).toHaveCount(4);
};

const day = (page: Page, index: number) => page.locator('.work-item-table__day').nth(index);

test('日／月切換：切到月份檢視再點日期回到那天，網址跟著改', async ({ page }) => {
  await page.goto('/');
  await expect(dataRows(page).first()).toBeVisible();
  await page.getByRole('button', { name: '月', exact: true }).click();
  await expect(page).toHaveURL(/view=month/);
  await expect(dataRows(page)).toHaveCount(4);
  await expect(page.getByText('本月', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '10/06（二）' }).click();
  await expect(page).not.toHaveURL(/view=month/);
  await expect(page).toHaveURL(/date=2026-10-06/);
  await expect(dataRows(page)).toHaveCount(1);
});

test('共用一個表頭，每天上面一列日期列（含星期），月初在上面', async ({ page }) => {
  await openMonth(page);
  await expect(page.locator('.work-item-table__row--header')).toHaveCount(1);
  await expect(page.locator('.work-item-table__date-link')).toHaveText([
    '10/06（二）',
    '10/07（三）',
  ]);
  await expect(day(page, 1).locator('.work-item-table__row[data-id]')).toHaveCount(3);
});

test('底色每天各自判斷：今天藍、其他天黑；平板、桌面日期列有底色與 2px 分隔線', async ({
  page,
}) => {
  await openMonth(page);
  expect(await css(day(page, 0).locator('.work-item-table__row').first(), 'background-color')).toBe(
    await tokenColor(page, 'black-050'),
  );
  expect(await css(day(page, 1).locator('.work-item-table__row').first(), 'background-color')).toBe(
    await tokenColor(page, 'blue-050'),
  );

  if (page.viewportSize()!.width >= 768) {
    const heading = (index: number) => day(page, index).locator('.work-item-table__day-heading');
    expect(await css(heading(0), 'background-color')).toBe(await tokenColor(page, 'black-100'));
    expect(await css(heading(1), 'background-color')).toBe(await tokenColor(page, 'blue-100'));
    expect(await css(heading(1), 'border-top-width')).toBe('2px');
    expect(await css(heading(1), 'border-top-color')).toBe(await tokenColor(page, 'blue-300'));
  }
});

test.describe('登入後', () => {
  test.use({ loggedIn: true });

  test('調整順序只在同一天內：下移後那天的順序改變，其他天不動', async ({ page }) => {
    await openMonth(page);
    const today = day(page, 1);
    const targets = () =>
      today
        .locator('.work-item-table__row[data-id] .work-item-table__cell--target')
        .allInnerTexts();
    const before = await targets();
    await today.getByRole('button', { name: '下移' }).first().click();
    await expect.poll(targets).toEqual([before[1], before[0], before[2]]);
    await expect(day(page, 0).locator('.work-item-table__row[data-id]')).toHaveCount(1);
    // 只有一筆的那天：上移、下移都停用
    for (const button of await day(page, 0)
      .getByRole('button', { name: /上移|下移/ })
      .all()) {
      await expect(button).toBeDisabled();
    }
  });
});

test('不是本月：顯示「回到本月」，點了回到本月', async ({ page }) => {
  await page.goto('/?view=month&date=2026-09-15');
  await expect(page.getByText('這個月沒有紀錄')).toBeVisible();
  await page.getByRole('button', { name: '回到本月' }).click();
  await expect(dataRows(page)).toHaveCount(4);
  await expect(page).toHaveURL(/date=2026-10-07/);
});

test('月份檢視沒有水平捲軸', async ({ page }) => {
  await openMonth(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
