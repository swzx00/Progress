/**
 * 測試用的假 Google 試算表，只實作 Code.gs 用到的 API，行為盡量貼近真的 Sheet：
 * - 寫入時跟 Sheet 一樣自動轉型：純數字字串 → 數字、TRUE／FALSE → 布林、YYYY/MM/DD → 日期、
 *   HH:mm → 時間（1899/12/30 的 Date）；儲存格是純文字格式（@）就維持字串
 * - getRange 超出分頁的列數、或列數是 0 時丟錯（新分頁預設 1000 列）
 * - getLastRow／getLastColumn 是最後一個有值的列／欄
 * - getDataRange 是有值的範圍（空白分頁是 A1）；clear 清值與格式，clearContent 只清值
 * - deleteRow 會刪掉那一列（後面的列往上補），insertRowsAfter 補的列沿用上一列的儲存格格式
 * - 日期用 Code.gs 那個 vm 環境的 Date 建立，Code.gs 裡的 instanceof Date 才認得
 */
export type CellValue = string | number | boolean | Date;

interface Cell {
  value: CellValue;
  format: string;
}

const DEFAULT_ROWS = 1000;
const DEFAULT_COLUMNS = 26;

const isEmpty = (value: CellValue): boolean => value === '' || value === null;

export class FakeSheet {
  readonly name: string;
  private rows: Cell[][];
  frozenRows = 0;
  private readonly DateCtor: DateConstructor;

  constructor(
    name: string,
    DateCtor: DateConstructor,
    rows = DEFAULT_ROWS,
    cols = DEFAULT_COLUMNS,
  ) {
    this.name = name;
    this.DateCtor = DateCtor;
    this.rows = Array.from({ length: rows }, () => this.emptyRow(cols));
  }

  private emptyRow(cols: number, formats?: string[]): Cell[] {
    return Array.from({ length: cols }, (_, i) => ({ value: '', format: formats?.[i] ?? '' }));
  }

  getName(): string {
    return this.name;
  }

  getMaxRows(): number {
    return this.rows.length;
  }

  getMaxColumns(): number {
    return this.rows[0]?.length ?? 0;
  }

  getLastRow(): number {
    for (let r = this.rows.length - 1; r >= 0; r--) {
      if (this.rows[r]!.some((cell) => !isEmpty(cell.value))) return r + 1;
    }
    return 0;
  }

  getLastColumn(): number {
    let last = 0;
    this.rows.forEach((row) =>
      row.forEach((cell, c) => {
        if (!isEmpty(cell.value) && c + 1 > last) last = c + 1;
      }),
    );
    return last;
  }

  getRange(row: number, col: number, numRows = 1, numCols = 1): FakeRange {
    if (numRows < 1 || numCols < 1) {
      throw new Error('The number of rows or columns in the range must be at least 1');
    }
    if (row < 1 || col < 1 || row + numRows - 1 > this.getMaxRows()) {
      throw new Error('Those rows are out of bounds.');
    }
    if (col + numCols - 1 > this.getMaxColumns()) {
      throw new Error('Those columns are out of bounds.');
    }
    return new FakeRange(this, row, col, numRows, numCols);
  }

  /** 有值的範圍；整張空白時跟 Sheet 一樣回傳 A1 */
  getDataRange(): FakeRange {
    return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }

  /** 清掉整張分頁的值與格式 */
  clear(): void {
    this.rows.forEach((row) =>
      row.forEach((cell) => {
        cell.value = '';
        cell.format = '';
      }),
    );
    this.frozenRows = 0;
  }

  setFrozenRows(n: number): void {
    this.frozenRows = n;
  }

  deleteRow(row: number): void {
    this.rows.splice(row - 1, 1);
  }

  insertRowsAfter(after: number, howMany: number): void {
    const formats = this.rows[after - 1]!.map((cell) => cell.format);
    const cols = this.getMaxColumns();
    const added = Array.from({ length: howMany }, () => this.emptyRow(cols, formats));
    this.rows.splice(after, 0, ...added);
  }

  insertColumnAfter(after: number): void {
    this.rows.forEach((row) => row.splice(after, 0, { value: '', format: '' }));
  }

  /** @internal */
  cell(row: number, col: number): Cell {
    return this.rows[row - 1]![col - 1]!;
  }

  /** @internal 依 Sheet 的規則把寫入的值轉型 */
  coerce(value: unknown, format: string): CellValue {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'string') return value as CellValue;
    if (format === '@' || value === '') return value;
    const trimmed = value.trim();
    if (/^(true|false)$/i.test(trimmed)) return trimmed.toUpperCase() === 'TRUE';
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    const date = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(trimmed);
    if (date) return new this.DateCtor(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
    const time = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
    if (time) return new this.DateCtor(1899, 11, 30, Number(time[1]), Number(time[2]));
    return value;
  }

  /** @internal 整列（資料列）照指定欄位排序 */
  sortRows(fromRow: number, count: number, specs: { column: number; ascending: boolean }[]): void {
    const slice = this.rows.slice(fromRow - 1, fromRow - 1 + count);
    const key = (value: CellValue): number | string =>
      value instanceof this.DateCtor ? (value as Date).getTime() : (value as number | string);
    slice.sort((a, b) => {
      for (const { column, ascending } of specs) {
        const va = a[column - 1]!.value;
        const vb = b[column - 1]!.value;
        // 空白一律排最後
        if (isEmpty(va) !== isEmpty(vb)) return isEmpty(va) ? 1 : -1;
        const ka = key(va);
        const kb = key(vb);
        const diff =
          typeof ka === 'number' && typeof kb === 'number'
            ? ka - kb
            : String(ka).localeCompare(String(kb));
        if (diff !== 0) return ascending ? diff : -diff;
      }
      return 0;
    });
    this.rows.splice(fromRow - 1, count, ...slice);
  }

  /** 測試用：讀出整張分頁有值的範圍 */
  dump(): CellValue[][] {
    const lastRow = this.getLastRow();
    const lastCol = this.getLastColumn();
    if (lastRow === 0) return [];
    return this.getRange(1, 1, lastRow, lastCol).getValues();
  }

  /** 測試用：表頭名稱 → 那一欄的資料（第 2 列起） */
  column(header: string): CellValue[] {
    const [headers = [], ...rows] = this.dump();
    const index = headers.indexOf(header);
    return index === -1 ? [] : rows.map((row) => row[index]!);
  }

  /** 測試用：直接寫入整列資料（模擬手動在 Sheet 上編輯），會照 Sheet 規則轉型 */
  appendRow(values: unknown[]): void {
    const row = this.getLastRow() + 1;
    this.getRange(row, 1, 1, values.length).setValues([values]);
  }
}

export class FakeRange {
  private readonly sheet: FakeSheet;
  private readonly row: number;
  private readonly col: number;
  private readonly numRows: number;
  private readonly numCols: number;

  constructor(sheet: FakeSheet, row: number, col: number, numRows: number, numCols: number) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  private forEachCell(fn: (cell: Cell, r: number, c: number) => void): void {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) {
        fn(this.sheet.cell(this.row + r, this.col + c), r, c);
      }
    }
  }

  getValues(): CellValue[][] {
    const values: CellValue[][] = Array.from({ length: this.numRows }, () => []);
    this.forEachCell((cell, r) => values[r]!.push(cell.value));
    return values;
  }

  setValues(values: unknown[][]): FakeRange {
    if (values.length !== this.numRows || values.some((row) => row.length !== this.numCols)) {
      throw new Error(
        `The number of rows or columns in the data does not match the range (${this.numRows}×${this.numCols})`,
      );
    }
    this.forEachCell((cell, r, c) => {
      cell.value = this.sheet.coerce(values[r]![c], cell.format);
    });
    return this;
  }

  setValue(value: unknown): FakeRange {
    const cell = this.sheet.cell(this.row, this.col);
    cell.value = this.sheet.coerce(value, cell.format);
    return this;
  }

  /** 只清值，格式留著 */
  clearContent(): FakeRange {
    this.forEachCell((cell) => {
      cell.value = '';
    });
    return this;
  }

  setNumberFormat(format: string): FakeRange {
    this.forEachCell((cell) => {
      cell.format = format;
    });
    return this;
  }

  getNumberFormat(): string {
    return this.sheet.cell(this.row, this.col).format;
  }

  sort(specs: { column: number; ascending: boolean }[]): FakeRange {
    this.sheet.sortRows(this.row, this.numRows, specs);
    return this;
  }
}

export class FakeSpreadsheet {
  private readonly sheets: FakeSheet[] = [];
  private readonly DateCtor: DateConstructor;

  constructor(DateCtor: DateConstructor) {
    this.DateCtor = DateCtor;
  }

  getSheetByName(name: string): FakeSheet | null {
    return this.sheets.find((sheet) => sheet.name === name) ?? null;
  }

  getSheets(): FakeSheet[] {
    return [...this.sheets];
  }

  insertSheet(name: string, rows?: number): FakeSheet {
    if (this.getSheetByName(name))
      throw new Error(`A sheet with the name "${name}" already exists.`);
    const sheet = new FakeSheet(name, this.DateCtor, rows);
    this.sheets.push(sheet);
    return sheet;
  }

  deleteSheet(sheet: FakeSheet): void {
    this.sheets.splice(this.sheets.indexOf(sheet), 1);
  }

  getSpreadsheetTimeZone(): string {
    return 'Asia/Taipei';
  }
}
