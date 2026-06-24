"use server";

import { getSheetsClient, SPREADSHEET_ID } from "@/lib/google-sheets";

// --------------------------------------------------------
// 型定義
// --------------------------------------------------------
export type SalesRow = {
  date: string;
  amount: number;
  storeName: string;
  itemName: string;
  quantity?: string;
  category: "cash" | "cashless" | "member";
  sheetRowIndex?: number; // CASHシート上の実際の行番号（1始まり、ヘッダー込み）
};

export type SalesSummary = {
  cash: number;
  cashless: number;
  member: number;
  details: SalesRow[];
  period: string;
};

// --------------------------------------------------------
// PARTNERシート M列から店舗名一覧を取得
// --------------------------------------------------------
export async function fetchStoreNames(): Promise<string[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "PARTNER!M2:M",
  });
  const rows = res.data.values ?? [];
  return rows
    .map((r) => (r[0] as string | undefined)?.trim() ?? "")
    .filter(Boolean);
}

// --------------------------------------------------------
// 売上集計（CASH / CASHLESS / MEMBER）
// 月度: "2026年5月度" -> year=2026, month=5
// --------------------------------------------------------
export async function fetchSalesSummary(
  storeName: string,
  period: string // "2026年5月度"
): Promise<SalesSummary> {
  const match = period.match(/(\d{4})年(\d{1,2})月度/);
  if (!match) throw new Error("期間フォーマットが不正です: " + period);
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);

  // サブスク（MEMBER）は選択期間の1ヶ月前を対象とする
  const memberDate = new Date(year, month - 2, 1); // month-2 = 1ヶ月前（0始まりのため）
  const memberYear = memberDate.getFullYear();
  const memberMonth = memberDate.getMonth() + 1;

  const sheets = getSheetsClient();

  // 3シートを並列取得
  const [cashRes, cashlessRes, memberRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "CASH!A2:D",
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "CASHLESS!A2:D",
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "MEMBER!A2:C",
    }),
  ]);

  const cashRows = cashRes.data.values ?? [];
  const cashlessRows = cashlessRes.data.values ?? [];
  const memberRows = memberRes.data.values ?? [];

  // 日付が対象月かどうか確認するヘルパー
  function isTargetMonth(dateStr: string): boolean {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  }

  // 部分一致で店名を確認するヘルパー
  function matchStore(cellValue: string | undefined): boolean {
    if (!cellValue) return false;
    return cellValue.includes(storeName);
  }

  // ¥記号・カンマ・スペースを除去して数値化する共通ヘルパー
  function parseAmount(raw: string | undefined): number {
    if (!raw) return 0;
    return parseFloat(raw.replace(/[¥,\s]/g, "")) || 0;
  }

  // ---- CASH: A=日付, B=店名, C=台数, D=現金売上 ----
  let cashTotal = 0;
  const cashDetails: SalesRow[] = [];
  for (let ri = 0; ri < cashRows.length; ri++) {
    const row = cashRows[ri];
    const dateStr = (row[0] as string | undefined) ?? "";
    const store = (row[1] as string | undefined) ?? "";
    const quantity = (row[2] as string | undefined) ?? "";
    const amountStr = (row[3] as string | undefined) ?? "0";
    if (!isTargetMonth(dateStr)) continue;
    if (!matchStore(store)) continue;
    const amount = parseAmount(amountStr);
    cashTotal += amount;
    cashDetails.push({
      date: dateStr,
      amount,
      storeName: store,
      itemName: "",
      quantity,
      category: "cash",
      sheetRowIndex: ri + 2, // ヘッダー行(1) + 0始まりインデックス → 実際の行番号
    });
  }

  // ---- CASHLESS: A=日付, B=売上, C=商品名, D=店舗名 ----
  let cashlessTotal = 0;
  const cashlessDetails: SalesRow[] = [];
  for (const row of cashlessRows) {
    const dateStr = (row[0] as string | undefined) ?? "";
    const amountStr = (row[1] as string | undefined) ?? "0";
    const itemName = (row[2] as string | undefined) ?? "";
    const store = (row[3] as string | undefined) ?? "";
    if (!isTargetMonth(dateStr)) continue;
    if (!matchStore(store)) continue;
    const amount = parseAmount(amountStr);
    cashlessTotal += amount;
    cashlessDetails.push({
      date: dateStr,
      amount,
      storeName: store,
      itemName,
      category: "cashless",
    });
  }

  // ---- MEMBER: A=日付, B=店名, C=売上（選択期間の1ヶ月前を表示） ----
  let memberTotal = 0;
  const memberDetails: SalesRow[] = [];
  for (const row of memberRows) {
    const dateStr = (row[0] as string | undefined) ?? "";
    const store = (row[1] as string | undefined) ?? "";
    const amountStr = (row[2] as string | undefined) ?? "0";
    // サブスクは1ヶ月前の期間でフィルタ
    const d2 = new Date(dateStr);
    const isMemberMonth =
      !isNaN(d2.getTime()) &&
      d2.getFullYear() === memberYear &&
      d2.getMonth() + 1 === memberMonth;
    if (!isMemberMonth) continue;
    if (!matchStore(store)) continue;
    const amount = parseAmount(amountStr);
    memberTotal += amount;
    // MEMBERは日付を「○○月度」形式で表示する
    const d = new Date(dateStr);
    const memberDateLabel = isNaN(d.getTime())
      ? dateStr
      : `${d.getFullYear()}年${d.getMonth() + 1}月度`;
    memberDetails.push({
      date: memberDateLabel,
      amount,
      storeName: store,
      itemName: "",
      category: "member",
    });
  }

  // 内訳を日付昇順でマージ
  const details: SalesRow[] = [
    ...cashDetails,
    ...cashlessDetails,
    ...memberDetails,
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // 足利緑町店はキャッシュレス売上を0にする
  const isAshikagaMidorimachi = storeName.includes("足利緑町");
  const finalCashless = isAshikagaMidorimachi ? 0 : cashlessTotal;
  const finalDetails = isAshikagaMidorimachi
    ? details.filter((r) => r.category !== "cashless")
    : details;

  return {
    cash: cashTotal,
    cashless: finalCashless,
    member: memberTotal,
    details: finalDetails,
    period,
  };
}

// --------------------------------------------------------
// CASHシートの1行を削除（行ごと削除してシフト）
// sheetRowIndex: 実際のシート行番号（1始まり）
// --------------------------------------------------------
export async function deleteCashRow(sheetRowIndex: number): Promise<void> {
  const sheets = getSheetsClient();

  // スプレッドシートのシートIDを取得
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets?.find((s) => s.properties?.title === "CASH");
  if (!sheet?.properties?.sheetId) throw new Error("CASHシートが見つかりません");
  const sheetId = sheet.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: sheetRowIndex - 1, // 0始まりに変換
              endIndex: sheetRowIndex,
            },
          },
        },
      ],
    },
  });
}

// --------------------------------------------------------
// CASHシートの1行を更新（日付・台数・金額を上書き）
// sheetRowIndex: 実際のシート行番号（1始まり）
// --------------------------------------------------------
export async function updateCashRow(
  sheetRowIndex: number,
  date: string,
  storeName: string,
  quantity: string,
  amount: number
): Promise<void> {
  const sheets = getSheetsClient();
  // A=日付, B=店名, C=台数, D=金額 → 全列更新
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `CASH!A${sheetRowIndex}:D${sheetRowIndex}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[date, storeName, quantity, amount]],
    },
  });
}

// --------------------------------------------------------
// CASHLESSシートへ行を追記（CSV マージアップロード用）
// 重複チェック: 既存行と A・B・C・D 全列が一致する行はスキップ
// rows: [[A, B, C, D], ...]  A=日付, B=売上, C=商品名, D=店舗名
// --------------------------------------------------------
export async function appendCashlessRows(
  rows: string[][]
): Promise<{ appended: number; skipped: number }> {
  if (rows.length === 0) return { appended: 0, skipped: 0 };

  const sheets = getSheetsClient();

  // 既存データを取得してフィンガープリントを作成
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "CASHLESS!A:D",
  });
  const existingSet = new Set<string>(
    (existing.data.values ?? []).map((r) =>
      [r[0] ?? "", r[1] ?? "", r[2] ?? "", r[3] ?? ""].join("\t")
    )
  );

  // 重複を除外
  const newRows = rows.filter(
    (r) => !existingSet.has([r[0] ?? "", r[1] ?? "", r[2] ?? "", r[3] ?? ""].join("\t"))
  );
  const skipped = rows.length - newRows.length;

  if (newRows.length === 0) return { appended: 0, skipped };

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "CASHLESS!A:D",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: newRows },
  });

  return { appended: newRows.length, skipped };
}
