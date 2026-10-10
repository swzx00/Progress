import type { Locator, Page } from '@playwright/test';

/** tokens.scss 的色階在目前主題下算出來的顏色（rgb(...)），用來比對元件的實際顏色 */
export const tokenColor = (page: Page, token: string): Promise<string> =>
  page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(--color-${name})`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);

export const css = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);

/** 資料列（不含表頭） */
export const dataRows = (page: Page): Locator => page.locator('.work-item-table__row[data-id]');
