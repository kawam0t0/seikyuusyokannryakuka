"use server";

import { getSheetsClient, SPREADSHEET_ID } from "@/lib/google-sheets";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";

// --------------------------------------------------------
// 型定義
// --------------------------------------------------------
export type ApikaRow = {
  date: string;
  storeName: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type MaintenanceRow = {
  date: string;
  storeName: string;
  itemName: string;
  quantity: number;
  note: string;
};

export type HirockRow = {
  date: string;
  storeName: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

// --------------------------------------------------------
// APKAシート読み込み（液剤代）
// A=日付, B=店名, C=品名, D=数量, E=単価
// --------------------------------------------------------
export async function fetchApikaRows(
  storeName: string,
  period: string
): Promise<ApikaRow[]> {
  const match = period.match(/(\d{4})年(\d{1,2})月度/);
  if (!match) return [];
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "APIKA!A2:E",
  });
  const rows = res.data.values ?? [];

  function parseNum(v: unknown): number {
    if (!v) return 0;
    return parseFloat(String(v).replace(/[¥,\s]/g, "")) || 0;
  }

  return rows
    .filter((row) => {
      const dateStr = (row[0] as string | undefined) ?? "";
      const store = (row[1] as string | undefined) ?? "";
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;
      const matchMonth =
        d.getFullYear() === year && d.getMonth() + 1 === month;
      const matchStore = store.includes(storeName);
      return matchMonth && matchStore;
    })
    .map((row) => {
      const qty = parseNum(row[3]);
      const unit = parseNum(row[4]);
      return {
        date: (row[0] as string) ?? "",
        storeName: (row[1] as string) ?? "",
        itemName: (row[2] as string) ?? "",
        quantity: qty,
        unitPrice: unit,
        total: qty * unit,
      };
    });
}

// --------------------------------------------------------
// MAINTENANCEシート読み込み（メンテナンス）
// A=日付, B=店名, C=品名, D=数量, E=備考
// --------------------------------------------------------
export async function fetchMaintenanceRows(
  storeName: string,
  period: string
): Promise<MaintenanceRow[]> {
  const match = period.match(/(\d{4})年(\d{1,2})月度/);
  if (!match) return [];
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "MAINTENANCE!A2:E",
  });
  const rows = res.data.values ?? [];

  return rows
    .filter((row) => {
      const dateStr = (row[0] as string | undefined) ?? "";
      const store = (row[1] as string | undefined) ?? "";
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;
      return (
        d.getFullYear() === year &&
        d.getMonth() + 1 === month &&
        store.includes(storeName)
      );
    })
    .map((row) => ({
      date: (row[0] as string) ?? "",
      storeName: (row[1] as string) ?? "",
      itemName: (row[2] as string) ?? "",
      quantity: parseFloat(String(row[3] ?? "0").replace(/[,\s]/g, "")) || 0,
      note: (row[4] as string) ?? "",
    }));
}

// --------------------------------------------------------
// HIROCKシート 列マッピング（2026-08 カラム変更後）
// A=発注番号, B=発注日, C=発注時刻, D=店舗名, E=ステータス, F=出荷日,
// G=商品名, H=サイズ, I=カラー, J=ロット, K=数量, L=単価, M=金額,
// N=カテゴリー, O=発注先, P=請求書送付済み, Q=備考, R=移行元
// --------------------------------------------------------
const HIROCK_COL = {
  orderNo: 0,   // A
  orderDate: 1, // B
  orderTime: 2, // C
  store: 3,     // D
  status: 4,    // E
  shipDate: 5,  // F
  itemName: 6,  // G
  size: 7,      // H
  color: 8,     // I
  lot: 9,       // J
  quantity: 10, // K
  unitPrice: 11,// L
  amount: 12,   // M
  category: 13, // N
  supplier: 14, // O
  invoiced: 15, // P
  note: 16,     // Q
  source: 17,   // R
} as const;

const HIROCK_SUPPLIER = "ハイロックデザインオフィス";

// --------------------------------------------------------
// HIROCKシートへ行を追記（PDF取込み・手動追加用）
// 新カラム構成に合わせて18列で書き込む
// --------------------------------------------------------
export async function appendHirockRows(
  rows: HirockRow[]
): Promise<{ appended: number }> {
  if (rows.length === 0) return { appended: 0 };

  const sheets = getSheetsClient();
  const values = rows.map((r) => {
    const row = new Array(18).fill("");
    row[HIROCK_COL.orderDate] = r.date;
    row[HIROCK_COL.store] = r.storeName;
    row[HIROCK_COL.status] = "出荷済み";
    row[HIROCK_COL.itemName] = r.itemName;
    row[HIROCK_COL.quantity] = r.quantity;
    row[HIROCK_COL.unitPrice] = r.unitPrice;
    row[HIROCK_COL.amount] = r.total || r.quantity * r.unitPrice;
    row[HIROCK_COL.supplier] = HIROCK_SUPPLIER;
    row[HIROCK_COL.source] = "PDF取込";
    return row;
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "HIROCK!A:R",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });

  return { appended: rows.length };
}

// --------------------------------------------------------
// HIROCKシート読み込み（消耗品）
// ・対象月の判定は B列(発注日)
// ・ステータス(E列)は絞り込まず全件対象
// ・品目名は 商品名 + サイズ/カラー、ロットがあればロット数を付記
// ・金額はM列をそのまま採用（空欄なら 数量×単価 で算出）
// --------------------------------------------------------
export async function fetchHirockRows(
  storeName: string,
  period: string
): Promise<HirockRow[]> {
  const match = period.match(/(\d{4})年(\d{1,2})月度/);
  if (!match) return [];
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "HIROCK!A2:R",
  });
  const rows = res.data.values ?? [];

  function cell(row: unknown[], idx: number): string {
    return String(row[idx] ?? "").trim();
  }

  function parseNum(v: unknown): number {
    if (!v) return 0;
    return parseFloat(String(v).replace(/[¥,\s]/g, "")) || 0;
  }

  // スラッシュ区切り日付（2026/06/15）をハイフン区切りに正規化してパース
  function parseDate(dateStr: string): Date {
    return new Date(dateStr.replace(/\//g, "-"));
  }

  // 商品名にサイズ・カラー・ロットを付記
  function buildItemName(row: unknown[]): string {
    const base = cell(row, HIROCK_COL.itemName);
    const variant = [cell(row, HIROCK_COL.size), cell(row, HIROCK_COL.color)]
      .filter((v) => v !== "")
      .join(" / ");
    const lotRaw = cell(row, HIROCK_COL.lot);
    // ロットがスプレッドシート側で日付に化けている場合は無視する
    const lot = /^\d+$/.test(lotRaw) ? lotRaw : "";
    const suffix = [variant, lot ? `ロット${lot}` : ""]
      .filter((v) => v !== "")
      .join(" / ");
    return suffix ? `${base}（${suffix}）` : base;
  }

  return rows
    .filter((row) => {
      const dateStr = cell(row, HIROCK_COL.orderDate);
      const store = cell(row, HIROCK_COL.store);
      const d = parseDate(dateStr);
      if (isNaN(d.getTime())) return false;
      return (
        d.getFullYear() === year &&
        d.getMonth() + 1 === month &&
        store.includes(storeName)
      );
    })
    .map((row) => {
      const qty = parseNum(row[HIROCK_COL.quantity]);
      const unitPrice = parseNum(row[HIROCK_COL.unitPrice]);
      const amount = parseNum(row[HIROCK_COL.amount]);
      return {
        date: cell(row, HIROCK_COL.orderDate),
        storeName: cell(row, HIROCK_COL.store),
        itemName: buildItemName(row),
        quantity: qty,
        unitPrice,
        total: amount || qty * unitPrice,
      };
    });
}

// --------------------------------------------------------
// PARTNERシート読み込み
// M列を検索値（店名の一部一致）として、取引先情報を返す
// A=取引先名称, C=郵便番号, D=都道府県, E=住所1, F=住所2, G=部署, H=担当者役職, I=担当者氏名, M=検索キー
// --------------------------------------------------------
export type PartnerInfo = {
  name: string;       // A列
  zip: string;        // C列
  pref: string;       // D列
  addr1: string;      // E列
  addr2: string;      // F列
  dept: string;       // G列
  title: string;      // H列
  contact: string;    // I列
};

export async function fetchPartnerInfo(storeName: string): Promise<PartnerInfo | null> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "PARTNER!A2:M",
  });
  const rows = res.data.values ?? [];
  const row = rows.find((r) => {
    const key = String(r[12] ?? "");
    return key !== "" && storeName.includes(key);
  });
  if (!row) return null;
  return {
    name:    String(row[0]  ?? ""),
    zip:     String(row[2]  ?? ""),
    pref:    String(row[3]  ?? ""),
    addr1:   String(row[4]  ?? ""),
    addr2:   String(row[5]  ?? ""),
    dept:    String(row[6]  ?? ""),
    title:   String(row[7]  ?? ""),
    contact: String(row[8]  ?? ""),
  };
}

// --------------------------------------------------------
// SUPPORTシート（現場応援）
// A=日付, B=店舗名, C=項目名, D=時間, E=単価, F=合計
// --------------------------------------------------------
export type SupportRow = {
  date: string;
  storeName: string;
  itemName: string;
  hours: number;
  unitPrice: number;
  total: number;
};

export async function fetchSupportRows(
  storeName: string,
  period: string
): Promise<SupportRow[]> {
  const match = period.match(/(\d{4})年(\d{1,2})月度/);
  if (!match) return [];
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);

  const sheets = getSheetsClient();
  let rows: unknown[][] = [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "SUPPORT!A2:F",
    });
    rows = res.data.values ?? [];
  } catch {
    // SUPPORTシートが存在しない場合は空で返す
    return [];
  }

  function parseNum(v: unknown): number {
    if (!v) return 0;
    return parseFloat(String(v).replace(/[¥,\s]/g, "")) || 0;
  }

  return rows
    .filter((row) => {
      const dateStr = (row[0] as string | undefined) ?? "";
      const store = (row[1] as string | undefined) ?? "";
      const d = new Date(dateStr.replace(/\//g, "-"));
      if (isNaN(d.getTime())) return false;
      return (
        d.getFullYear() === year &&
        d.getMonth() + 1 === month &&
        store.includes(storeName)
      );
    })
    .map((row) => {
      const hours = parseNum(row[3]);
      const unit = parseNum(row[4]);
      const tot = parseNum(row[5]) || hours * unit;
      return {
        date: (row[0] as string) ?? "",
        storeName: (row[1] as string) ?? "",
        itemName: (row[2] as string) ?? "現場応援",
        hours,
        unitPrice: unit,
        total: tot,
      };
    });
}

export async function appendSupportRows(
  rows: SupportRow[]
): Promise<{ appended: number }> {
  if (rows.length === 0) return { appended: 0 };

  const sheets = getSheetsClient();
  const values = rows.map((r) => [
    r.date,
    r.storeName,
    r.itemName,
    r.hours,
    r.unitPrice,
    r.total,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "SUPPORT!A:F",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });

  return { appended: rows.length };
}

// --------------------------------------------------------
// SUPPORTシート：店舗×請求月度の行を画面の内容で置き換え（自動保存用）
// 対象月・対象店舗の既存行を削除してから、rows を追記する
// --------------------------------------------------------
export async function replaceSupportRows(
  storeName: string,
  period: string,
  rows: SupportRow[]
): Promise<void> {
  const match = period.match(/(\d{4})年(\d{1,2})月度/);
  if (!match || !storeName) return;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);

  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets?.find((s) => s.properties?.title === "SUPPORT");
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) throw new Error("SUPPORTシートが見つかりません");

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "SUPPORT!A2:F",
  });
  const existing = res.data.values ?? [];

  // fetchSupportRows と同じ条件で対象行を特定（シート上の0始まり行番号）
  const targetIdx: number[] = [];
  existing.forEach((row, i) => {
    const dateStr = String(row[0] ?? "");
    const store = String(row[1] ?? "");
    const d = new Date(dateStr.replace(/\//g, "-"));
    if (isNaN(d.getTime())) return;
    if (d.getFullYear() === year && d.getMonth() + 1 === month && store.includes(storeName)) {
      targetIdx.push(i + 1); // ヘッダー行ぶんずらす
    }
  });

  // 下の行から削除（行番号がずれないように）
  if (targetIdx.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: targetIdx
          .sort((a, b) => b - a)
          .map((idx) => ({
            deleteDimension: {
              range: { sheetId, dimension: "ROWS", startIndex: idx, endIndex: idx + 1 },
            },
          })),
      },
    });
  }

  if (rows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "SUPPORT!A:F",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: rows.map((r) => [r.date, r.storeName, r.itemName, r.hours, r.unitPrice, r.total]),
      },
    });
  }
}

// --------------------------------------------------------
// Gemini を使って PDF バイナリを直接解析・構造化
// pdf-parse は使わず Gemini のマルチモーダル機能を使用
// --------------------------------------------------------
const HirockRowSchema = z.object({
  rows: z.array(
    z.object({
      date: z.string().describe("日付 (YYYY-MM-DD形式。不明な場合は空文字)"),
      storeName: z.string().describe("店舗名 (不明な場合は空文字)"),
      itemName: z.string().describe("品目・商品名"),
      quantity: z.number().describe("数量 (不明な場合は1)"),
      unitPrice: z.number().describe("単価 (円、不明な場合は0)"),
      total: z.number().describe("合計金額 (円、不明な場合は数量×単価)"),
    })
  ),
});

export async function parsePdfWithGemini(
  pdfBase64: string,
  hint: { storeName?: string; period?: string }
): Promise<HirockRow[]> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY が設定されていません。");

  const google = createGoogleGenerativeAI({ apiKey });

  const prompt = `
このPDFは請求書または納品書です。
商品・品目ごとの明細データをすべて抽出して構造化してください。

ヒント情報:
- 店舗名: ${hint.storeName ?? "不明"}
- 対象��間: ${hint.period ?? "不明"}

ルール:
- 日付はYYYY-MM-DD形式。文書全体の日付や納品日を使用。
- 店舗名が文書内に明示されていない場合はヒントの店舗名を使用。
- 数量・単価・合計が読み取れない場合は0。
- 1行1品目で出力。
- 合計行・小計行・消費税行・ヘッダー行は含めない（品目明細のみ）。
`.trim();

  const result = await generateObject({
    model: google("gemini-2.0-flash"),
    schema: HirockRowSchema,
    messages: [
      {
        role: "user",
        content: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {
            type: "file",
            data: pdfBase64,
            mediaType: "application/pdf",
          } as any,
          {
            type: "text",
            text: prompt,
          },
        ],
      },
    ],
  });

  return result.object.rows;
}