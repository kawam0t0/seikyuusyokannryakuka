"use client";

import { useState, useMemo, useCallback, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { fetchSalesSummary, type SalesSummary } from "@/app/actions";
import { CsvUploader } from "@/components/csv-uploader";
import { DetailsTable } from "@/components/details-table";
import { PdfExport } from "@/components/pdf-export";
import { HirockPdfImporter } from "@/components/hirock-pdf-importer";

// 2026年5月度 〜 2030年5月度 の全月を生成
function generatePeriods(): string[] {
  const periods: string[] = [];
  for (let year = 2026; year <= 2030; year++) {
    const startMonth = year === 2026 ? 5 : 1;
    const endMonth = year === 2030 ? 5 : 12;
    for (let month = startMonth; month <= endMonth; month++) {
      periods.push(`${year}年${month}月度`);
    }
  }
  return periods;
}

const PERIODS = generatePeriods();

type Props = {
  storeNames: string[];
  onStateChange?: (state: { selectedStore: string; selectedPeriod: string; royaltyAmountExTax: number; cashExTax: number; cashlessExTax: number; memberExTax: number }) => void;
};

export function CockpitDashboard({ storeNames, onStateChange }: Props) {
  const hasStores = storeNames.length > 0;

  const [selectedStore, setSelectedStore] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [royaltyRate, setRoyaltyRate] = useState(3);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  // 現金売上の手動編集用: key=インデックス, value=上書き金額
  const [cashOverrides, setCashOverrides] = useState<Record<number, number>>({});

  // 現金明細行（cashOverridesで上書き済み）削除済みインデックスを除外
  const [deletedCashIndices, setDeletedCashIndices] = useState<Set<number>>(new Set());

  const cashRows = useMemo(() => {
    if (!summary) return [];
    return summary.details
      .filter((r) => r.category === "cash")
      .map((r, i) => ({
        ...r,
        originalIndex: i,
        editedAmount: cashOverrides[i] !== undefined ? cashOverrides[i] : r.amount,
        deleted: deletedCashIndices.has(i),
      }))
      .filter((r) => !r.deleted);
  }, [summary, cashOverrides, deletedCashIndices]);

  // 抜けている日付・重複日付のアラート計算
  const cashAlerts = useMemo(() => {
    if (!summary || cashRows.length === 0) return { missing: [] as string[], duplicates: [] as string[] };
    const match = summary.period?.match(/(\d{4})年(\d{1,2})月度/) ?? null;
    if (!match) return { missing: [], duplicates: [] };
    const year = parseInt(match[1]);
    const month = parseInt(match[2]);
    const daysInMonth = new Date(year, month, 0).getDate();
    const dateCounts: Record<string, number> = {};
    cashRows.forEach((r) => {
      const d = r.date ? r.date.replace(/\//g, "-") : "";
      if (d) dateCounts[d] = (dateCounts[d] ?? 0) + 1;
    });
    const existingDates = new Set(Object.keys(dateCounts));
    const missing: string[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (!existingDates.has(dateStr)) missing.push(dateStr);
    }
    const duplicates = Object.entries(dateCounts).filter(([, cnt]) => cnt > 1).map(([d]) => d);
    return { missing, duplicates };
  }, [cashRows, summary]);

  // 手動編集後の現金合計
  const adjustedCash = useMemo(
    () => cashRows.reduce((s, r) => s + r.editedAmount, 0),
    [cashRows]
  );

  const total = useMemo(
    () => (summary ? adjustedCash + summary.cashless + summary.member : 0),
    [summary, adjustedCash]
  );
  const royaltyAmount = useMemo(
    () => Math.floor(total * (royaltyRate / 100)),
    [total, royaltyRate]
  );
  const totalExTax = useMemo(() => Math.floor(total / 1.1), [total]);
  const cashExTax = useMemo(() => Math.floor(adjustedCash / 1.1), [adjustedCash]);
  const cashlessExTax = useMemo(() => Math.floor(summary ? summary.cashless / 1.1 : 0), [summary]);
  const memberExTax = useMemo(() => Math.floor(summary ? summary.member / 1.1 : 0), [summary]);
  const royaltyAmountExTax = useMemo(
    () => Math.floor(totalExTax * (royaltyRate / 100)),
    [totalExTax, royaltyRate]
  );

  const loadSummary = useCallback(
    (store: string, period: string) => {
      if (!store || !period) return;
      setErrorMsg("");
      startTransition(async () => {
        try {
          const result = await fetchSalesSummary(store, period);
          setSummary(result);
          setCashOverrides({});
          setDeletedCashIndices(new Set());
          // 状態を AppShell に通知
          if (onStateChange) {
            onStateChange({
              selectedStore: store,
              selectedPeriod: period,
              royaltyAmountExTax: Math.floor((Math.floor((result.cash + result.cashless + result.member) / 1.1)) * (royaltyRate / 100)),
              cashExTax: Math.floor(result.cash / 1.1),
              cashlessExTax: Math.floor(result.cashless / 1.1),
              memberExTax: Math.floor(result.member / 1.1),
            });
          }
        } catch (e) {
          setSummary(null);
          setErrorMsg(
            e instanceof Error ? e.message : "データ取得に失敗しました。"
          );
        }
      });
    },
    [onStateChange, royaltyRate]
  );

  function handleStoreChange(store: string) {
    setSelectedStore(store);
    loadSummary(store, selectedPeriod);
  }

  function handlePeriodChange(period: string) {
    setSelectedPeriod(period);
    loadSummary(selectedStore, period);
  }

  const pct = (val: number) =>
    total > 0 ? ((val / total) * 100).toFixed(1) : "0.0";

  const fmt = (val: number) => `¥${val.toLocaleString("ja-JP")}`;

  return (
    <div className="space-y-8">

        {/* セレクター */}
        <div className="flex flex-col gap-6 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap gap-4">
            {/* 店名 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">
                店名
              </label>
              <div className="relative">
                <select
                  value={selectedStore}
                  onChange={(e) => handleStoreChange(e.target.value)}
                  disabled={!hasStores || isPending}
                  className="appearance-none rounded-lg border border-border bg-card px-4 py-2 pr-9 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 transition cursor-pointer"
                >
                  <option value="">店名を選択</option>
                  {hasStores ? (
                    storeNames.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))
                  ) : (
                    <option value="" disabled>（設定が必要です）</option>
                  )}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              </div>
            </div>

            {/* 期間 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">
                期間
              </label>
              <div className="relative">
                <select
                  value={selectedPeriod}
                  onChange={(e) => handlePeriodChange(e.target.value)}
                  disabled={isPending}
                  className="appearance-none rounded-lg border border-border bg-card px-4 py-2 pr-9 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 transition cursor-pointer"
                >
                  <option value="">期間を選択</option>
                  {PERIODS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              </div>
            </div>
          </div>
        </div>

        {/* 環境変数未設定の警告 */}
        {!hasStores && (
          <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            <span className="font-semibold">設定が必要です：</span>{" "}
            <code className="text-yellow-700">.env.local</code> に{" "}
            <code className="text-yellow-700">GOOGLE_SERVICE_ACCOUNT_JSON</code> を設定してください。
          </div>
        )}

        {/* エラー表示 */}
        {errorMsg && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        {/* CSV アップローダー */}
        <CsvUploader />

        {/* 消耗品PDF取込み（HIROCKシート） */}
        <div className="rounded-lg border border-border bg-card p-6">
          <HirockPdfImporter
            storeName={selectedStore}
            period={selectedPeriod}
          />
        </div>

        {/* ローディングオーバーレイ */}
        {isPending && (
          <div className="flex items-center justify-center gap-3 rounded-lg border border-border bg-card/50 py-10 text-sm text-muted-foreground">
            <span className="inline-block w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            データを取得中...
          </div>
        )}

        {!isPending && (
          <div className="space-y-6">
            {/* 売上カード 3列 */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* ���金売上 */}
              <div className="rounded-lg border border-border bg-card p-6 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                  <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    現金売上
                  </span>
                </div>
                <p className="text-3xl font-bold text-foreground">
                  {summary ? fmt(adjustedCash) : "¥—"}
                </p>
                {summary && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      全体の {pct(adjustedCash)}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      税抜: {fmt(cashExTax)}
                    </p>
                  </>
                )}
              </div>

              {/* キャッシュレス売上 */}
              <div className="rounded-lg border border-border bg-card p-6 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    キャッシュレス売上
                  </span>
                </div>
                <p className="text-3xl font-bold text-foreground">
                  {summary ? fmt(summary.cashless) : "¥—"}
                </p>
                {summary && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      全体の {pct(summary.cashless)}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      税抜: {fmt(cashlessExTax)}
                    </p>
                  </>
                )}
              </div>

              {/* サブスク売上 */}
              <div className="rounded-lg border border-border bg-card p-6 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                  <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    サブスク売上
                  </span>
                  <span className="text-xs text-muted-foreground">（前月分）</span>
                </div>
                <p className="text-3xl font-bold text-foreground">
                  {summary ? fmt(summary.member) : "¥—"}
                </p>
                {summary && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      全体の {pct(summary.member)}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      税抜: {fmt(memberExTax)}
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* 現金売上 明細一覧（手動編集可） */}
            {summary && cashRows.length > 0 && (
              <div className="space-y-2">
                {/* アラート：抜けている日付 */}
                {cashAlerts.missing.length > 0 && (
                  <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-xs text-yellow-800">
                    <span className="font-semibold">データが抜けている日付：</span>{" "}
                    {cashAlerts.missing.join("、")}
                  </div>
                )}
                {/* アラート：重複している日付 */}
                {cashAlerts.duplicates.length > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                    <span className="font-semibold">同じ日のデータが複数あります：</span>{" "}
                    {cashAlerts.duplicates.join("、")}（不要な行を削除してください）
                  </div>
                )}
                <div className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                      <span className="text-sm font-semibold text-foreground">現金売上 明細</span>
                    </div>
                    <span className="text-xs text-muted-foreground">金額は手動で修正できます</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted">
                        <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">日付</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">店舗名</th>
                        <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">台数</th>
                        <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">金額（編集可）</th>
                        <th className="px-4 py-2.5 text-center font-semibold text-muted-foreground">削除</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashRows.map((r, i) => {
                        const isDup = cashAlerts.duplicates.includes(r.date?.replace(/\//g, "-") ?? "");
                        return (
                          <tr key={r.originalIndex} className={`border-b border-border ${isDup ? "bg-red-50" : i % 2 === 0 ? "bg-card" : "bg-muted/20"}`}>
                            <td className={`px-4 py-2.5 tabular-nums ${isDup ? "text-red-700 font-semibold" : "text-foreground"}`}>{r.date}</td>
                            <td className="px-4 py-2.5 text-foreground">{r.storeName}</td>
                            <td className="px-4 py-2.5 text-right text-foreground tabular-nums">{r.quantity ?? "—"}</td>
                            <td className="px-4 py-2 text-right">
                              <input
                                type="number"
                                min={0}
                                value={r.editedAmount}
                                onChange={(e) => {
                                  const val = Math.max(0, parseInt(e.target.value) || 0);
                                  setCashOverrides((prev) => ({ ...prev, [r.originalIndex]: val }));
                                  if (summary && onStateChange) {
                                    const newCash = cashRows.reduce((s, row, j) => s + (j === i ? val : row.editedAmount), 0);
                                    const newTotal = newCash + summary.cashless + summary.member;
                                    const newTotalExTax = Math.floor(newTotal / 1.1);
                                    onStateChange({
                                      selectedStore,
                                      selectedPeriod,
                                      royaltyAmountExTax: Math.floor(newTotalExTax * (royaltyRate / 100)),
                                      cashExTax: Math.floor(newCash / 1.1),
                                      cashlessExTax: Math.floor(summary.cashless / 1.1),
                                      memberExTax: Math.floor(summary.member / 1.1),
                                    });
                                  }
                                }}
                                className="w-32 rounded border border-border bg-card px-2 py-1 text-right text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 tabular-nums"
                              />
                            </td>
                            <td className="px-4 py-2 text-center">
                              <button
                                onClick={() => setDeletedCashIndices((prev) => new Set([...prev, r.originalIndex]))}
                                className="rounded px-2 py-1 text-xs text-red-500 border border-red-200 hover:bg-red-50 transition"
                              >
                                削除
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/40">
                        <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-foreground">合計</td>
                        <td className="px-4 py-2.5 text-right text-sm font-bold text-green-600 tabular-nums">
                          ¥{adjustedCash.toLocaleString("ja-JP")}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* 総売上 + ロイヤリティ */}
            <div className="rounded-lg border border-border bg-card p-8 space-y-8">
              {/* 総売上 */}
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  総売上
                </p>
                <p className="text-5xl font-bold text-foreground">
                  {summary ? fmt(total) : "¥—"}
                </p>
                {summary && (
                  <p className="text-sm text-muted-foreground">
                    税抜: {fmt(totalExTax)}
                  </p>
                )}
              </div>

              <div className="h-px bg-border" />

              {/* ロイヤリティ率 */}
              <div className="space-y-4">
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  ロイヤリティ率を選択
                </p>
                <div className="flex flex-wrap gap-3">
                  {[0, 1, 2, 3, 4, 5].map((rate) => (
                    <button
                      key={rate}
                      onClick={() => {
                        setRoyaltyRate(rate);
                        if (summary && onStateChange) {
                          const exTax = Math.floor((summary.cash + summary.cashless + summary.member) / 1.1);
                          onStateChange({
                            selectedStore,
                            selectedPeriod,
                            royaltyAmountExTax: Math.floor(exTax * (rate / 100)),
                            cashExTax: Math.floor(summary.cash / 1.1),
                            cashlessExTax: Math.floor(summary.cashless / 1.1),
                            memberExTax: Math.floor(summary.member / 1.1),
                          });
                        }
                      }}
                      className={`w-14 rounded-lg py-2.5 text-sm font-semibold transition-all ${
                        royaltyRate === rate
                          ? "bg-primary text-primary-foreground ring-2 ring-primary/50 ring-offset-2 ring-offset-background"
                          : "border border-border bg-muted text-muted-foreground hover:text-foreground hover:border-primary/50"
                      }`}
                    >
                      {rate}%
                    </button>
                  ))}
                </div>
              </div>

              {/* ロイヤリティ金額 */}
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  ロイヤリティ金額（{royaltyRate}%）
                </p>
                <p className="text-4xl font-bold text-primary">
                  {summary ? fmt(royaltyAmount) : "¥—"}
                </p>
                {summary && (
                  <p className="text-sm text-muted-foreground">
                    税抜: {fmt(royaltyAmountExTax)}
                  </p>
                )}
              </div>

              {/* PDF ダウンロード */}
              {summary && (
                <div className="flex justify-end">
                  <PdfExport
                    storeName={selectedStore}
                    period={selectedPeriod}
                    cash={summary.cash}
                    cashExTax={cashExTax}
                    cashless={summary.cashless}
                    cashlessExTax={cashlessExTax}
                    member={summary.member}
                    memberExTax={memberExTax}
                    totalExTax={totalExTax}
                    royaltyRate={royaltyRate}
                    royaltyAmount={royaltyAmount}
                    royaltyAmountExTax={royaltyAmountExTax}
                    details={summary.details}
                  />
                </div>
              )}
            </div>

            {/* 内訳テーブル */}
            {summary && (
              <div className="space-y-3">
                <button
                  onClick={() => setIsDetailsOpen(!isDetailsOpen)}
                  className="flex items-center gap-2 rounded-lg border border-border bg-muted hover:bg-muted/80 px-4 py-3 text-sm font-medium text-muted-foreground transition-colors"
                >
                  <svg
                    className={`w-4 h-4 transition-transform ${isDetailsOpen ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  売上内訳を表示
                </button>
                {isDetailsOpen && (
                  <div className="animate-in fade-in-50 slide-in-from-top-2 duration-200">
                    <DetailsTable rows={summary.details} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
    </div>
  );
}
