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

test('未登入切換樣式：只記在這台，不寫 Sheet', async ({ page }) => {
  await openHome(page);
  const posts: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST') posts.push(req.postData() ?? '');
  });
  await chooseTheme(page, '深色');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(300);
  expect(posts.filter((body) => body.includes('saveThemeMode'))).toEqual([]);
});

test('切回淺色', async ({ page }) => {
  await openHome(page);
  await chooseTheme(page, '深色');
  await chooseTheme(page, '淺色');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('唯讀模式（沒登入）：顯示「唯讀模式」，沒有新增與操作欄', async ({ page, browserName }) => {
  await openHome(page);
  await expect(page.getByText('唯讀模式')).toBeVisible();
  await expect(page.getByRole('button', { name: '新增' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '編輯' })).toHaveCount(0);
  // WebKit 攔不到 MSW Service Worker 轉發的請求，載入的是真的 Google 登入腳本，按鈕長得不一樣，只在 Chromium 檢查
  if (browserName !== 'webkit') {
    await expect(page.getByRole('button', { name: '使用 Google 帳戶登入' })).toBeVisible();
  }
});

const NIGHT = new Date('2026-10-07T22:00:00+08:00');

const themeOptions = async (page: import('@playwright/test').Page) => {
  await page.locator('.home-view__theme-btn').click();
  const options = page.locator('.n-dropdown-option');
  await expect(options.first()).toBeVisible();
  const labels = await options.allInnerTexts();
  await page.keyboard.press('Escape');
  return labels.map((label) => label.replace('✓', '').trim());
};

test.describe('自動（依日出日落）只有登入才能用', () => {
  test('從沒登入過：選單只有淺色、深色；晚上也是淺色（記住的是自動時）', async ({ page }) => {
    await page.clock.setFixedTime(NIGHT);
    await openHome(page);
    expect(await themeOptions(page)).toEqual(['淺色', '深色']);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test.describe('登入後', () => {
    test.use({ loggedIn: true });

    test('選單有自動，晚上自動切成深色', async ({ page }) => {
      await page.clock.setFixedTime(NIGHT);
      await openHome(page);
      expect(await themeOptions(page)).toEqual(['自動（依日出日落）', '淺色', '深色']);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    });

    test('切換樣式時寫回 Sheet（跨裝置同步）', async ({ page }) => {
      await openHome(page);
      const saved = page.waitForRequest(
        (req) => req.method() === 'POST' && (req.postData() ?? '').includes('"saveThemeMode"'),
      );
      await chooseTheme(page, '深色');
      expect(JSON.parse((await saved).postData()!)).toMatchObject({
        action: 'saveThemeMode',
        themeMode: 'dark',
      });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    });

    test('晚上登出：維持登出當下的深色，重新整理後也一樣；選單只剩淺色、深色', async ({ page }) => {
      await page.clock.setFixedTime(NIGHT);
      await openHome(page);
      const html = page.locator('html');
      await expect(html).toHaveAttribute('data-theme', 'dark');

      await page.getByRole('button', { name: '登出' }).click();
      await expect(page.getByText('唯讀模式')).toBeVisible();
      await expect(html).toHaveAttribute('data-theme', 'dark');
      expect(await themeOptions(page)).toEqual(['淺色', '深色']);

      await page.reload();
      await expect(page.getByText('唯讀模式')).toBeVisible();
      await expect(html).toHaveAttribute('data-theme', 'dark');
    });
  });
});
