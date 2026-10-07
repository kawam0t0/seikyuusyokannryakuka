"use server";

import { getSheetsClient, SPREADSHEET_ID } from "@/lib/google-sheets";

// --------------------------------------------------------
// OTHER シート（その他請求項目）
// A=店舗名, B=請求月度(例: 2026年10月度), C=日付, D=項目名, E=数量, F=単価, G=金額, H=備考, I=更新日時
// 店舗×請求月度ごとに、画面で保存した内容で丸ごと置き換える
// --------------------------------------------------------
const SHEET = "OTHER";
const HEADER = ["店舗名", "請求月度", "日付", "項目名", "数量", "単価", "金額", "備考", "更新日時"];

export type OtherItem = {
  date: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  note: string;
};

function toNum(v: unknown): number {
  const n = parseFloat(String(v ?? "").replace(/[¥,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

async function ensureSheet() {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === SHEET);
  if (exists) return;
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
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    return (res.data.values ?? []) as unknown[][];
  } catch (e) {
    // シート未作成の場合は空扱い
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unable to parse range")) return [];
    throw e;
  }
}

const isTarget = (row: unknown[], storeName: string, period: string) =>
  String(row[0] ?? "").trim() === storeName.trim() && String(row[1] ?? "").trim() === period.trim();

// --------------------------------------------------------
// 店舗×請求月度のその他請求項目を取得
// --------------------------------------------------------
export async function fetchOtherItems(storeName: string, period: string): Promise<OtherItem[]> {
  const rows = await readRows();
  return rows
    .filter((r) => isTarget(r, storeName, period))
    .map((r) => ({
      date: String(r[2] ?? "").trim(),
      itemName: String(r[3] ?? "").trim(),
      quantity: toNum(r[4]),
      unitPrice: toNum(r[5]),
      note: String(r[7] ?? "").trim(),
    }));
}

// --------------------------------------------------------
// 店舗×請求月度のその他請求項目を保存（既存分は置き換え）
// items が空なら、その店舗×月度の行を削除する
// --------------------------------------------------------
export async function saveOtherItems(storeName: string, period: string, items: OtherItem[]): Promise<number> {
  if (!storeName || !period) throw new Error("店舗と期間を選択してください");
  await ensureSheet();
  const sheets = getSheetsClient();
  const rows = await readRows();
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  const kept = rows.filter((r) => !isTarget(r, storeName, period));
  const added = items
    .filter((i) => i.itemName.trim())
    .map((i) => [
      storeName,
      period,
      i.date,
      i.itemName.trim(),
      i.quantity,
      i.unitPrice,
      i.quantity * i.unitPrice,
      i.note,
      now,
    ]);
  const next = [...kept, ...added];

  // データ部分を一度クリアしてから書き戻す
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET}!A2:I`,
  });
  if (next.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET}!A2:I${next.length + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: next as (string | number)[][] },
    });
  }
  return added.length;
}
