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
// HIROCKシートへ行を追記
// A=日付, B=店舗名, C=品目, D=数量, E=単価, F=合計
// --------------------------------------------------------
export async function appendHirockRows(
  rows: HirockRow[]
): Promise<{ appended: number }> {
  if (rows.length === 0) return { appended: 0 };

  const sheets = getSheetsClient();
  const values = rows.map((r) => [
    r.date,
    r.storeName,
    r.itemName,
    r.quantity,
    r.unitPrice,
    r.total,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "HIROCK!A:F",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });

  return { appended: rows.length };
}

// --------------------------------------------------------
// HIROCKシート読み込み（消耗品）
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
    range: "HIROCK!A2:F",
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
      return (
        d.getFullYear() === year &&
        d.getMonth() + 1 === month &&
        store.includes(storeName)
      );
    })
    .map((row) => {
      const qty = parseNum(row[3]);
      const unit = parseNum(row[4]);
      const tot = parseNum(row[5]) || qty * unit;
      return {
        date: (row[0] as string) ?? "",
        storeName: (row[1] as string) ?? "",
        itemName: (row[2] as string) ?? "",
        quantity: qty,
        unitPrice: unit,
        total: tot,
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
