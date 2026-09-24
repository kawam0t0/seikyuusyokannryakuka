"use server";

import { getSheetsClient, SPREADSHEET_ID } from "@/lib/google-sheets";
import {
  DEFAULT_MAINTENANCE_MONTHS,
  type StoreMaster,
  type StoreMasterMap,
} from "@/lib/store-master";

// --------------------------------------------------------
// STORE_MASTER シート
// A=店舗名, B=ロイヤリティ率(%), C=液剤単価(JSON), D=定期メンテ金額,
// E=定期メンテ無償期間開始日, F=定期メンテ無償期間終了日, G=定期メンテ実施月(カンマ区切り),
// H=システム利用料, I=更新日時
// 空欄 = 未設定（メイン画面で手動入力）
// --------------------------------------------------------
const SHEET = "STORE_MASTER";
const HEADER = [
  "店舗名",
  "ロイヤリティ率(%)",
  "液剤単価(JSON)",
  "定期メンテ金額",
  "定期メンテ無償期間開始日",
  "定期メンテ無償期間終了日",
  "定期メンテ実施月",
  "システム利用料",
  "更新日時",
];

function toNumOrNull(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[¥,%\s]/g, "");
  if (s === "") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseMonths(v: unknown): number[] {
  const s = String(v ?? "").trim();
  if (!s) return [...DEFAULT_MAINTENANCE_MONTHS];
  const months = s
    .split(/[,、\s/]+/)
    .map((x) => parseInt(x, 10))
    .filter((n) => n >= 1 && n <= 12);
  return months.length > 0 ? Array.from(new Set(months)).sort((a, b) => a - b) : [...DEFAULT_MAINTENANCE_MONTHS];
}

function parseLiquidPrices(v: unknown): Record<string, number> {
  const s = String(v ?? "").trim();
  if (!s) return {};
  try {
    const obj = JSON.parse(s) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, val] of Object.entries(obj)) {
      const n = toNumOrNull(val);
      if (k.trim() && n !== null) out[k.trim()] = n;
    }
    return out;
  } catch {
    return {};
  }
}

function rowToMaster(row: unknown[]): StoreMaster | null {
  const storeName = String(row[0] ?? "").trim();
  if (!storeName) return null;
  return {
    storeName,
    royaltyRate: toNumOrNull(row[1]),
    liquidPrices: parseLiquidPrices(row[2]),
    regularMaintenance: {
      amount: toNumOrNull(row[3]),
      start: String(row[4] ?? "").trim(),
      end: String(row[5] ?? "").trim(),
      months: parseMonths(row[6]),
    },
    systemFee: toNumOrNull(row[7]),
    updatedAt: String(row[8] ?? ""),
  };
}

function masterToRow(m: StoreMaster): (string | number)[] {
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  return [
    m.storeName,
    m.royaltyRate ?? "",
    Object.keys(m.liquidPrices).length > 0 ? JSON.stringify(m.liquidPrices) : "",
    m.regularMaintenance.amount ?? "",
    m.regularMaintenance.start,
    m.regularMaintenance.end,
    m.regularMaintenance.months.join(","),
    m.systemFee ?? "",
    now,
  ];
}

/** STORE_MASTER シートが無ければ作成してヘッダーを書き込む */
async function ensureSheet() {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === SHEET);
  if (exists) {
    // ヘッダー名を最新に揃える（旧「定期メンテ開始日」等から更新）
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET}!A1:I1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADER] },
    });
    return;
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: SHEET } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET}!A1:I1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADER] },
  });
}

async function readRows(): Promise<unknown[][]> {
  const sheets = getSheetsClient();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET}!A2:I`,
    });
    return (res.data.values ?? []) as unknown[][];
  } catch (e) {
    // シート未作成の場合は空扱い
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unable to parse range")) return [];
    throw e;
  }
}

// --------------------------------------------------------
// 全店舗のマスタを取得
// --------------------------------------------------------
export async function fetchStoreMasters(): Promise<StoreMasterMap> {
  const rows = await readRows();
  const map: StoreMasterMap = {};
  for (const row of rows) {
    const m = rowToMaster(row);
    if (m) map[m.storeName] = m;
  }
  return map;
}

// --------------------------------------------------------
// 1店舗分のマスタを保存（既存行があれば上書き、無ければ追加）
// --------------------------------------------------------
export async function saveStoreMaster(master: StoreMaster): Promise<StoreMaster> {
  if (!master.storeName.trim()) throw new Error("店舗名が空です");
  await ensureSheet();
  const sheets = getSheetsClient();
  const rows = await readRows();
  const idx = rows.findIndex((r) => String(r[0] ?? "").trim() === master.storeName.trim());
  const values = [masterToRow(master)];

  if (idx >= 0) {
    const rowNum = idx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET}!A${rowNum}:I${rowNum}`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET}!A:I`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });
  }
  return rowToMaster(values[0])!;
}
