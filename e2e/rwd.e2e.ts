import { css, dataRows, tokenColor } from './helpers';
import { expect, openHome, test } from './fixtures';

/**
 * RWD（CLAUDE.md「RWD 斷點」）：手機 < 768 卡片式列表、平板 768–1023 表格但完成度／今日工時／預計期限合併、
 * 桌面 ≥ 1024 每個欄位各一欄；三種寬度都不能出現橫向捲軸
 */
test.use({ loggedIn: true });

const WEBKIT_NO_FAKE_CALENDAR =
  'WebKit 攔不到 MSW Service Worker 轉發的請求，假的台灣行事曆不會生效（會連到真的行事曆）';

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
  // 手機專案（mobile、iphone）用 isMobile 判斷，平板／桌面看寬度
  const width = page.viewportSize()!.width;
  if (testInfo.project.use.isMobile) {
    // 卡片：沒有表頭，處理內容前面有「處理內容：」，工時寫成「工時：4hr」
    await expect(header(page)).toBeHidden();
    const first = dataRows(page).first();
    await expect(first.locator('.work-item-table__mobile-label').first()).toBeVisible();
    await expect(first).toContainText('工時：4hr');
    return;
  }
  await expect(header(page)).toBeVisible();
  const headerText = await header(page).innerText();
  if (width < 1024) {
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

test('換到國定假日：顯示假日名稱與放假的空狀態', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', WEBKIT_NO_FAKE_CALENDAR);
  await openHome(page);
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '下一天' }).click();
  await expect(page.getByText('國慶日補假').first()).toBeVisible();
  await expect(page.locator('.work-item-table__empty')).toHaveText('這天放假呦！');
});

const rectTop = (locator: import('@playwright/test').Locator) =>
  locator.evaluate((el) => el.getBoundingClientRect().top);

test('往下捲：平板、桌面工具列固定在最上方、表頭接在它下面；手機都不固定', async ({
  page,
}, testInfo) => {
  // 視窗壓矮，預設資料（3 筆）才捲得夠遠
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 330 });
  await openHome(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const nav = page.locator('.date-nav');

  if (testInfo.project.use.isMobile) {
    await expect.poll(() => rectTop(nav)).toBeLessThan(0);
    return;
  }
  // 還沒固定住時表頭沒有陰影
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(header(page)).not.toHaveClass(/work-item-table__row--stuck/);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  await expect.poll(() => rectTop(nav)).toBe(0);
  // 固定住時表頭下緣有陰影
  await expect(header(page)).toHaveClass(/work-item-table__row--stuck/);
  expect(await css(header(page), 'box-shadow')).not.toBe('none');
  const navHeight = await nav.evaluate((el) => el.getBoundingClientRect().height);
  await expect.poll(() => rectTop(header(page))).toBeCloseTo(navHeight, 0);
  // 工具列、表頭蓋在資料列上面：最上方點到的是工具列，緊接在下面的是表頭
  const hits = await page.evaluate((h) => {
    const at = (y: number) => document.elementFromPoint(window.innerWidth / 2, y);
    return [!!at(5)?.closest('.date-nav'), !!at(h + 5)?.closest('.work-item-table__row--header')];
  }, navHeight);
  expect(hits).toEqual([true, true]);
});

test('返回最上：捲過頁首才出現，點了回到最頂端並消失', async ({ page }) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 330 });
  await openHome(page);
  const button = page.getByRole('button', { name: '返回最上' });
  await expect(button).toBeHidden();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  const viewport = page.viewportSize()!;
  // 固定在右下角
  expect(viewport.width - (box.x + box.width)).toBeLessThanOrEqual(32);
  expect(viewport.height - (box.y + box.height)).toBeLessThanOrEqual(32);

  await button.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(button).toBeHidden();
});

test('捲到最底：最後一列在「返回最上」上方，不會被蓋住', async ({ page }) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 330 });
  await openHome(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const button = page.getByRole('button', { name: '返回最上' });
  await expect(button).toBeVisible();
  const last = (await dataRows(page).last().boundingBox())!;
  const top = (await button.boundingBox())!.y;
  expect(last.y + last.height).toBeLessThanOrEqual(top);
});

test('沒有紀錄：空狀態下面不留白（平板、桌面撐到畫面底部），頁面不用捲動', async ({ page }) => {
  await page.goto('/?date=2026-10-08');
  const empty = page.locator('.work-item-table__empty');
  await expect(empty).toHaveText('這天沒有紀錄');
  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );
  expect(scrollable).toBeLessThanOrEqual(0);
  if (page.viewportSize()!.width >= 768) {
    const box = (await empty.boundingBox())!;
    expect(box.y + box.height).toBeCloseTo(page.viewportSize()!.height, 0);
  }
});
