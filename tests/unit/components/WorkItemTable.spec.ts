// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { makeItem } from '@/testing/fixtures';
import type { WorkItem } from '@/types/work-item';

import WorkItemTable from '@/components/WorkItemTable.vue';

/**
 * 表格的資料呈現：排序、唯讀／可編輯、逾期與請假標示、狀態顏色、上移／下移、搜尋結果模式、空狀態。
 * 版面（RWD、截斷）要真的排版，不在這裡測；拖曳（VueDraggable）與截斷（ClampText）換成只渲染內容的空殼
 */
const TODAY = '2026-10-09';

const stubs = {
  VueDraggable: { template: '<div class="work-item-table__body"><slot /></div>' },
  ClampText: { emits: ['toggle'], template: '<div><slot /></div>' },
};

const mountTable = (props: Record<string, unknown> = {}): VueWrapper =>
  mount(WorkItemTable, {
    props: { items: [], today: TODAY, ...props },
    global: { stubs },
  });

const rows = (wrapper: VueWrapper) =>
  wrapper.findAll('.work-item-table__row:not(.work-item-table__row--header)');

const threeItems = (): WorkItem[] => [
  makeItem({ id: 'c', 項次: 3, 工作目標: 'C' }),
  makeItem({ id: 'a', 項次: 1, 工作目標: 'A' }),
  makeItem({ id: 'b', 項次: 2, 工作目標: 'B' }),
];

describe('排序與唯讀', () => {
  it('照項次排序（逾期不會排到前面）', () => {
    const items = threeItems();
    items[0]!.預計期限 = '2026-10-01';
    const wrapper = mountTable({ items });
    expect(rows(wrapper).map((row) => row.attributes('data-id'))).toEqual(['a', 'b', 'c']);
  });

  it('唯讀：沒有操作欄、上移／下移、拖曳把手', () => {
    const wrapper = mountTable({ items: threeItems() });
    expect(wrapper.text()).not.toContain('操作');
    expect(wrapper.find('button[aria-label="編輯"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="上移"]').exists()).toBe(false);
    expect(wrapper.find('.work-item-table__drag-handle').exists()).toBe(false);
  });

  it('可編輯：編輯、複製、刪除送出那一筆', async () => {
    const items = threeItems();
    const wrapper = mountTable({ items, editable: true });
    const second = rows(wrapper)[1]!;
    await second.get('button[aria-label="編輯"]').trigger('click');
    await second.get('button[aria-label="複製"]').trigger('click');
    await second.get('button[aria-label="刪除"]').trigger('click');
    expect(wrapper.emitted('edit')![0]![0]).toMatchObject({ id: 'b' });
    expect(wrapper.emitted('copy')![0]![0]).toMatchObject({ id: 'b' });
    expect(wrapper.emitted('delete')![0]![0]).toMatchObject({ id: 'b' });
  });
});

describe('上移／下移', () => {
  // 平板桌面的項次欄、手機的操作列各有一組，取項次欄那組
  const moveButtons = (wrapper: VueWrapper, rowIndex: number) => {
    const cell = rows(wrapper)[rowIndex]!.get('.work-item-table__cell--index');
    return {
      up: cell.get('button[aria-label="上移"]'),
      down: cell.get('button[aria-label="下移"]'),
    };
  };

  it('第一筆不能上移、最後一筆不能下移', () => {
    const wrapper = mountTable({ items: threeItems(), editable: true });
    expect(moveButtons(wrapper, 0).up.attributes('disabled')).toBeDefined();
    expect(moveButtons(wrapper, 0).down.attributes('disabled')).toBeUndefined();
    expect(moveButtons(wrapper, 2).down.attributes('disabled')).toBeDefined();
  });

  it('下移／上移跟相鄰那筆交換，送出整天的新順序', async () => {
    const wrapper = mountTable({ items: threeItems(), editable: true });
    await moveButtons(wrapper, 0).down.trigger('click');
    await moveButtons(wrapper, 2).up.trigger('click');
    expect(wrapper.emitted('reorder')).toEqual([[['b', 'a', 'c']], [['a', 'c', 'b']]]);
  });

  it('存檔中（reordering）全部停用', () => {
    const wrapper = mountTable({ items: threeItems(), editable: true, reordering: true });
    const buttons = wrapper.findAll('.work-item-table__move-btn');
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true);
  });
});

describe('列的標示', () => {
  it('預計期限已過且完成度 < 100：逾期標線與標籤', () => {
    const wrapper = mountTable({
      items: [
        makeItem({ id: 'over', 項次: 1, 預計期限: '2026-10-08', 完成度: 50 }),
        makeItem({ id: 'done', 項次: 2, 預計期限: '2026-10-08', 完成度: 100 }),
        makeItem({ id: 'none', 項次: 3, 預計期限: '' }),
        makeItem({ id: 'todayDue', 項次: 4, 預計期限: TODAY }),
      ],
    });
    const overdue = rows(wrapper).map((row) => row.classes('work-item-table__row--overdue'));
    expect(overdue).toEqual([true, false, false, false]);
    expect(wrapper.findAll('.work-item-table__badge').map((b) => b.text())).toEqual(['逾期']);
  });

  it('請假列：請假樣式，交辦欄只顯示交辦單位', () => {
    const wrapper = mountTable({
      items: [makeItem({ 狀態: '休假', 交辦單位: '人事室', 交辦人員: '--' })],
    });
    const row = rows(wrapper)[0]!;
    expect(row.classes()).toContain('work-item-table__row--leave');
    expect(row.find('.work-item-table__assignee-person').exists()).toBe(false);
    expect(row.get('.work-item-table__assignee-inline').text()).toBe('人事室');
  });

  it('一般列交辦欄是「人員（單位）」', () => {
    const wrapper = mountTable({ items: [makeItem()] });
    expect(rows(wrapper)[0]!.get('.work-item-table__assignee-inline').text()).toBe(
      '王小明（資訊部）',
    );
  });

  it.each([
    ['待辦', 'todo'],
    ['進行中', 'in-progress'],
    ['確認上線', 'released'],
  ])('狀態「%s」套對應的顏色修飾符', (status) => {
    const wrapper = mountTable({ items: [makeItem({ 狀態: status as WorkItem['狀態'] })] });
    const capsule = wrapper.get('.work-item-table__status');
    expect(capsule.text()).toBe(status);
    expect(capsule.classes().some((c) => c.startsWith('work-item-table__status--'))).toBe(true);
  });

  it('清單外的狀態只套基本樣式，空狀態不顯示膠囊', () => {
    const wrapper = mountTable({
      items: [
        makeItem({ id: 'x', 項次: 1, 狀態: '舊狀態' as WorkItem['狀態'] }),
        makeItem({ id: 'y', 項次: 2, 狀態: '' as WorkItem['狀態'] }),
      ],
    });
    const capsules = wrapper.findAll('.work-item-table__status');
    expect(capsules).toHaveLength(1);
    expect(capsules[0]!.classes()).toEqual(['work-item-table__status']);
  });

  it('完成度照實際值顯示、不補 0；進度條寬度同完成度', () => {
    const wrapper = mountTable({
      items: [
        makeItem({ id: 'a', 項次: 1, 完成度: 70 }),
        makeItem({ id: 'b', 項次: 2, 完成度: 12.25 }),
      ],
    });
    expect(wrapper.findAll('.work-item-table__progress-text').map((t) => t.text())).toEqual([
      '70%',
      '12.25%',
    ]);
    expect(wrapper.get('.work-item-table__progress-bar').attributes('style')).toContain(
      'width: 70%',
    );
  });

  it('預計期限顯示成 YYYY/MM/DD，空值不顯示「期限：」', () => {
    const wrapper = mountTable({
      items: [
        makeItem({ id: 'a', 項次: 1, 預計期限: '2026-10-31' }),
        makeItem({ id: 'b', 項次: 2, 預計期限: '' }),
      ],
    });
    const due = wrapper.findAll('.work-item-table__cell--due:not([role="columnheader"])');
    expect(due[0]!.text()).toBe('期限：2026/10/31');
    expect(due[1]!.text()).toBe('');
  });

  it('專案 Repo 顯示成 # 標籤', () => {
    const wrapper = mountTable({ items: [makeItem({ 專案Repo: ['AAA', 'BBBB'] })] });
    expect(wrapper.findAll('.work-item-table__repo-tag').map((t) => t.text())).toEqual([
      '#AAA',
      '#BBBB',
    ]);
  });
});

describe('搜尋結果模式', () => {
  const searchItems = (): WorkItem[] => [
    makeItem({ id: 'new', 項次: 2, 工作日期: '2026-10-09', 工作目標: '官網首頁' }),
    makeItem({ id: 'old', 項次: 1, 工作日期: '2026-09-30', 工作目標: '官網登入' }),
  ];

  it('照傳進來的順序、項次欄換成工作日期，點日期跳到那天', async () => {
    const wrapper = mountTable({
      items: searchItems(),
      editable: true,
      searchMode: true,
      searchKeyword: '官網',
    });
    expect(wrapper.get('[role="columnheader"]').text()).toBe('工作日期');
    expect(rows(wrapper).map((row) => row.attributes('data-id'))).toEqual(['new', 'old']);
    await wrapper.findAll('.work-item-table__date-link')[1]!.trigger('click');
    expect(wrapper.emitted('goToDate')).toEqual([['2026-09-30']]);
  });

  it('不能調整順序，編輯照常', () => {
    const wrapper = mountTable({ items: searchItems(), editable: true, searchMode: true });
    expect(wrapper.find('button[aria-label="上移"]').exists()).toBe(false);
    expect(wrapper.find('.work-item-table__drag-handle').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="編輯"]').exists()).toBe(true);
  });

  it('標示符合的字（用 mark，不用 v-html）', () => {
    const wrapper = mountTable({
      items: [makeItem({ 工作目標: '<b>官網</b>首頁' })],
      searchMode: true,
      searchKeyword: '官網',
    });
    const target = wrapper.get('.work-item-table__cell--target:not([role="columnheader"])');
    expect(target.findAll('mark').map((m) => m.text())).toEqual(['官網']);
    expect(target.find('b').exists()).toBe(false);
    expect(target.text()).toBe('<b>官網</b>首頁');
  });

  it('不是搜尋模式不標示', () => {
    const wrapper = mountTable({ items: [makeItem({ 工作目標: '官網' })], searchKeyword: '官網' });
    expect(wrapper.find('mark').exists()).toBe(false);
  });
});

describe('月份檢視', () => {
  const monthItems = (): WorkItem[] => [
    makeItem({ id: 'd09-2', 項次: 2, 工作日期: TODAY }),
    makeItem({ id: 'd01-1', 項次: 1, 工作日期: '2026-10-01' }),
    makeItem({ id: 'd09-1', 項次: 1, 工作日期: TODAY }),
    makeItem({ id: 'd05-1', 項次: 1, 工作日期: '2026-10-05' }),
  ];
  const dayOffLabelOf = (date: string): string | null => (date === TODAY ? '國慶日補假' : null);

  const days = (wrapper: VueWrapper) => wrapper.findAll('.work-item-table__day');

  it('共用一個表頭（項次），依日期分組、月初在上面，每天上面一列日期列（日期含星期）', () => {
    const wrapper = mountTable({ items: monthItems(), monthMode: true, dayOffLabelOf });
    expect(wrapper.findAll('.work-item-table__row--header')).toHaveLength(1);
    expect(wrapper.get('[role="columnheader"]').text()).toBe('項次');
    expect(days(wrapper).map((day) => day.get('.work-item-table__date-link').text())).toEqual([
      '10/01（四）',
      '10/05（一）',
      '10/09（五）',
    ]);
    expect(
      days(wrapper)[2]!
        .findAll('.work-item-table__row')
        .map((row) => row.attributes('data-id')),
    ).toEqual(['d09-1', 'd09-2']);
  });

  it('放假徽章只在放假那天；底色每天各自判斷（今天、放假）', () => {
    const wrapper = mountTable({ items: monthItems(), monthMode: true, dayOffLabelOf });
    const [first, , last] = days(wrapper);
    expect(first!.find('.work-item-table__holiday-badge').exists()).toBe(false);
    expect(last!.get('.work-item-table__holiday-badge').text()).toBe('🏮 國慶日補假');
    expect(first!.classes()).not.toContain('work-item-table--viewing-today');
    expect(last!.classes()).toEqual(
      expect.arrayContaining(['work-item-table--viewing-today', 'work-item-table--holiday']),
    );
    expect(wrapper.classes()).not.toContain('work-item-table--viewing-today');
  });

  it('點日期跳到那天', async () => {
    const wrapper = mountTable({ items: monthItems(), monthMode: true });
    await wrapper.findAll('.work-item-table__date-link')[1]!.trigger('click');
    expect(wrapper.emitted('goToDate')).toEqual([['2026-10-05']]);
  });

  it('上移／下移只在同一天內，emit 那天的新順序與日期', async () => {
    const wrapper = mountTable({ items: monthItems(), editable: true, monthMode: true });
    const lastDay = days(wrapper)[2]!;
    const up = lastDay.findAll('.work-item-table__cell--index button[aria-label="上移"]');
    expect(up[0]!.attributes('disabled')).toBeDefined();
    await up[1]!.trigger('click');
    expect(wrapper.emitted('reorder')).toEqual([[['d09-2', 'd09-1'], TODAY]]);
    // 只有一筆的那天：上移、下移都停用
    const single = days(wrapper)[0]!.findAll('.work-item-table__cell--index button');
    expect(single.every((button) => button.attributes('disabled') !== undefined)).toBe(true);
  });
});

describe('空狀態', () => {
  it.each([
    [{ searchMode: true, searchKeyword: '官網' }, '找不到符合「官網」的紀錄'],
    [{ monthMode: true }, '這個月沒有紀錄'],
    [{ dayOffLabel: '中秋節', viewingToday: true }, '今天放假呦！'],
    [{ dayOffLabel: '中秋節' }, '這天放假呦！'],
    [{ viewingToday: true }, '今天還沒有紀錄'],
    [{}, '這天沒有紀錄'],
  ])('%o → %s', (props, text) => {
    expect(mountTable(props).get('.work-item-table__empty').text()).toBe(text);
  });

  it('有紀錄時不顯示', () => {
    expect(
      mountTable({ items: [makeItem()] })
        .find('.work-item-table__empty')
        .exists(),
    ).toBe(false);
  });
});
