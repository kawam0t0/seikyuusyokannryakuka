"use server";

import { getSheetsClient, SPREADSHEET_ID } from "@/lib/google-sheets";

// --------------------------------------------------------
// INPUT シート（請求書画面の入力内容の自動保存）
// A=店舗名, B=請求月度, C=入力内容(JSON), D=更新日時
// 店舗×請求月度ごとに1行
// --------------------------------------------------------
const SHEET = "INPUT";
const HEADER = ["店舗名", "請求月度", "入力内容(JSON)", "更新日時"];

async function ensureSheet() {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  if (meta.data.sheets?.some((s) => s.properties?.title === SHEET)) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: SHEET } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET}!A1:D1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADER] },
  });
}

async function readRows(): Promise<unknown[][]> {
  const sheets = getSheetsClient();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET}!A2:D`,
    });
    return (res.data.values ?? []) as unknown[][];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unable to parse range")) return [];
    throw e;
  }
}

const isTarget = (row: unknown[], storeName: string, period: string) =>
  String(row[0] ?? "").trim() === storeName.trim() && String(row[1] ?? "").trim() === period.trim();

/** 保存済みの入力内容を取得（無ければ null） */
export async function fetchDraft(storeName: string, period: string): Promise<unknown | null> {
  const rows = await readRows();
  const row = rows.find((r) => isTarget(r, storeName, period));
  if (!row) return null;
  try {
    return JSON.parse(String(row[2] ?? ""));
  } catch {
    return null;
  }
}

/** 入力内容を保存（既存行は上書き、無ければ追加） */
export async function saveDraft(storeName: string, period: string, draft: unknown): Promise<void> {
  if (!storeName || !period) return;
  await ensureSheet();
  const sheets = getSheetsClient();
  const rows = await readRows();
  const idx = rows.findIndex((r) => isTarget(r, storeName, period));
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const values = [[storeName, period, JSON.stringify(draft), now]];
  if (idx >= 0) {
    const rowNum = idx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET}!A${rowNum}:D${rowNum}`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET}!A:D`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });
  }
}
