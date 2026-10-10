import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, openHome, test } from './fixtures';

/**
 * 無障礙檢查（axe-core，WCAG 2.1 A／AA）：主畫面在淺色、深色模式各掃一次，包含小字對比 ≥ 4.5:1
 * （CLAUDE.md「色彩 token」）、表單欄位要有名稱、aria 用法。只在桌面跑（playwright.config.ts）
 */
test.use({ loggedIn: true });

const scan = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  // 失敗時列出規則、說明與出問題的元素，方便對照
  return violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.map((n) => `${n.target.join(' ')} — ${n.failureSummary ?? ''}`),
  }));
};

const setTheme = async (page: Page, theme: 'light' | 'dark') => {
  await page.addInitScript((mode) => localStorage.setItem('theme-mode', mode), theme);
};

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme === 'light' ? '淺色' : '深色'}模式`, () => {
    test.beforeEach(async ({ page }) => setTheme(page, theme));

    test('主畫面', async ({ page }) => {
      await openHome(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await scan(page)).toEqual([]);
    });

    test('新增表單', async ({ page }) => {
      await openHome(page);
      await page.getByRole('button', { name: '新增' }).click();
      await expect(page.locator('.work-item-form__panel')).toBeVisible();
      expect(await scan(page)).toEqual([]);
    });

    test('搜尋結果', async ({ page }) => {
      await openHome(page);
      const box = page.getByRole('combobox', { name: '搜尋全部紀錄' });
      await box.fill('官網');
      await box.press('Enter');
      await expect(page.getByText('搜尋結果')).toBeVisible();
      expect(await scan(page)).toEqual([]);
    });
  });
}

test.describe('唯讀模式（沒登入）', () => {
  test.use({ loggedIn: false });

  test('主畫面', async ({ page }) => {
    await openHome(page);
    await expect(page.getByText('唯讀模式')).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });
});
