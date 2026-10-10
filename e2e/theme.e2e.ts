import { css, tokenColor } from './helpers';
import { expect, openHome, test } from './fixtures';

/** 深色模式：工具 → 樣式（或標題旁的按鈕）切換，套用 <html data-theme>，選擇記在 localStorage */
const chooseTheme = async (page: import('@playwright/test').Page, label: string) => {
  await page.locator('.home-view__theme-btn').click();
  await page.locator('.n-dropdown-option', { hasText: label }).click();
};

test('切成深色：data-theme、底色與文字色換成深色的色階，重新整理後維持', async ({ page }) => {
  await openHome(page);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');
  const lightBg = await css(page.locator('body'), 'background-color');

  await chooseTheme(page, '深色');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  const darkBg = await css(page.locator('body'), 'background-color');
  expect(darkBg).not.toBe(lightBg);
  // 深色模式把同一組 token 的階數上下對調：主文字 black-800 在深色底上要是淺色
  const text = await tokenColor(page, 'black-800');
  const [r, g, b] = text.match(/\d+/g)!.map(Number);
  expect((r! + g! + b!) / 3).toBeGreaterThan(128);
  await expect(page.locator('.home-view__theme-btn')).toHaveAttribute(
    'aria-label',
    '樣式：目前是深色',
  );

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
});

test('切回淺色', async ({ page }) => {
  await openHome(page);
  await chooseTheme(page, '深色');
  await chooseTheme(page, '淺色');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('唯讀模式（沒登入）：顯示「唯讀模式」，沒有新增與操作欄', async ({ page }) => {
  await openHome(page);
  await expect(page.getByText('唯讀模式')).toBeVisible();
  await expect(page.getByRole('button', { name: '新增' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '編輯' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '使用 Google 帳戶登入' })).toBeVisible();
});
