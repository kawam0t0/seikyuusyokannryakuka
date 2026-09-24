// --------------------------------------------------------
// 店舗マスタ：型定義と共通ヘルパー（クライアント/サーバー共用）
// --------------------------------------------------------

export type StoreMaster = {
  storeName: string;
  /** ロイヤリティ率（%）。null = 未設定（メイン画面で手動選択） */
  royaltyRate: number | null;
  /** 液剤ごとのデフォルト単価 key=品名 value=単価 */
  liquidPrices: Record<string, number>;
  /** 定期メンテナンス */
  regularMaintenance: {
    /** 金額。null = 未設定（メイン画面で手動入力） */
    amount: number | null;
    /** 無償期間 YYYY/MM/DD（空文字 = 指定なし）。この期間中は定期メンテナンス代金0円 */
    start: string;
    end: string;
    /** 実施月（1〜12） */
    months: number[];
  };
  /** システム利用料（月額）。null = 未設定（メイン画面で手動入力） */
  systemFee: number | null;
  updatedAt: string;
};

export type StoreMasterMap = Record<string, StoreMaster>;

/** 定期メンテナンスのデフォルト実施月 */
export const DEFAULT_MAINTENANCE_MONTHS = [3, 6, 9, 12];

/** マスタ画面に最初から並べる液剤 */
export const DEFAULT_LIQUID_ITEMS = [
  "スプコート",
  "スプワックス",
  "スプシャン",
  "スプタイヤ",
  "セラミック",
  "ピッカークロスミニ(ブルー)",
];

export function emptyStoreMaster(storeName: string): StoreMaster {
  return {
    storeName,
    royaltyRate: null,
    liquidPrices: {},
    regularMaintenance: { amount: null, start: "", end: "", months: [...DEFAULT_MAINTENANCE_MONTHS] },
    systemFee: null,
    updatedAt: "",
  };
}

/** 品名の表記ゆれ（空白・全角括弧・大文字小文字）を吸収して比較用キーにする */
export function normalizeItemName(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** マスタから液剤単価を引く（完全一致 → 表記ゆれ吸収の順） */
export function lookupLiquidPrice(master: StoreMaster | undefined, itemName: string): number | null {
  if (!master) return null;
  const direct = master.liquidPrices[itemName.trim()];
  if (direct !== undefined && direct !== null) return direct;
  const key = normalizeItemName(itemName);
  for (const [name, price] of Object.entries(master.liquidPrices)) {
    if (normalizeItemName(name) === key) return price;
  }
  return null;
}

/** "2026年9月度" → { year: 2026, month: 9 } */
export function parsePeriod(period: string): { year: number; month: number } | null {
  const m = period.match(/(\d{4})年(\d{1,2})月度/);
  if (!m) return null;
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
}

/** "2026/04/01" or "2026-04-01" → Date（不正なら null） */
function parseYmd(s: string): Date | null {
  const m = s.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

export const FREE_MAINTENANCE_NOTE = "無償期間のため、定期メンテナンス費用はいただきません。";

export type RegularMaintenanceStatus = {
  /** 選択中の月が実施月か（= 画面に表示するか） */
  isTargetMonth: boolean;
  /** 選択中の月が無償期間に含まれるか（期間未指定なら false） */
  isFree: boolean;
  /** マスタから自動で入れる金額（無償期間中は 0、未設定なら null） */
  defaultAmount: number | null;
  /** 無償期間の表示用ラベル */
  rangeLabel: string;
};

export function getRegularMaintenanceStatus(
  master: StoreMaster | undefined,
  period: string
): RegularMaintenanceStatus {
  const p = parsePeriod(period);
  const rm = master?.regularMaintenance;
  const months = rm && rm.months.length > 0 ? rm.months : DEFAULT_MAINTENANCE_MONTHS;
  const isTargetMonth = !!p && months.includes(p.month);

  const start = rm?.start ? parseYmd(rm.start) : null;
  const end = rm?.end ? parseYmd(rm.end) : null;
  // 無償期間：選択月が期間に1日でも重なれば無償
  let isFree = false;
  if (p && (start || end)) {
    const monthStart = new Date(p.year, p.month - 1, 1);
    const monthEnd = new Date(p.year, p.month, 0);
    isFree = !(start && monthEnd < start) && !(end && monthStart > end);
  }

  const rangeLabel = rm && (rm.start || rm.end) ? `${rm.start || ""}〜${rm.end || ""}` : "";
  const defaultAmount = isFree ? 0 : rm && rm.amount !== null ? rm.amount : null;

  return { isTargetMonth, isFree, defaultAmount, rangeLabel };
}
