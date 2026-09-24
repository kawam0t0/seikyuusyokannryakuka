"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { saveStoreMaster } from "@/app/master-actions";
import {
  DEFAULT_LIQUID_ITEMS,
  FREE_MAINTENANCE_NOTE,
  emptyStoreMaster,
  type StoreMaster,
  type StoreMasterMap,
} from "@/lib/store-master";

type Props = {
  open: boolean;
  onClose: () => void;
  storeNames: string[];
  masters: StoreMasterMap;
  onSaved: (master: StoreMaster) => void;
  /** 開いたときに最初に選択しておく店舗 */
  initialStore?: string;
};

type LiquidRow = { name: string; price: string };
type FormState = {
  royaltyRate: string;
  liquids: LiquidRow[];
  rmAmount: string;
  rmStart: string; // YYYY-MM-DD（input[type=date]用）
  rmEnd: string;
  rmMonths: number[];
  systemFee: string;
};

const toInputDate = (s: string) => s.replace(/\//g, "-");
const toSheetDate = (s: string) => s.replace(/-/g, "/");
const numStr = (v: number | null) => (v === null ? "" : String(v));
const strNum = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
};

function masterToForm(m: StoreMaster): FormState {
  // デフォルト液剤 + マスタに登録済みの液剤
  const names = [...DEFAULT_LIQUID_ITEMS];
  for (const k of Object.keys(m.liquidPrices)) if (!names.includes(k)) names.push(k);
  return {
    royaltyRate: numStr(m.royaltyRate),
    liquids: names.map((name) => ({ name, price: m.liquidPrices[name] !== undefined ? String(m.liquidPrices[name]) : "" })),
    rmAmount: numStr(m.regularMaintenance.amount),
    rmStart: toInputDate(m.regularMaintenance.start),
    rmEnd: toInputDate(m.regularMaintenance.end),
    rmMonths: [...m.regularMaintenance.months],
    systemFee: numStr(m.systemFee),
  };
}

function isConfigured(m: StoreMaster | undefined): boolean {
  if (!m) return false;
  return (
    m.royaltyRate !== null ||
    m.systemFee !== null ||
    m.regularMaintenance.amount !== null ||
    Object.keys(m.liquidPrices).length > 0
  );
}

export function StoreMasterDialog({ open, onClose, storeNames, masters, onSaved, initialStore }: Props) {
  const [store, setStore] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);

  // 開いたとき：初期店舗を選択
  useEffect(() => {
    if (!open) return;
    const first = initialStore && storeNames.includes(initialStore) ? initialStore : storeNames[0] ?? "";
    selectStore(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function selectStore(s: string) {
    if (dirty && !confirm("保存していない変更があります。破棄して切り替えますか？")) return;
    setStore(s);
    setForm(s ? masterToForm(masters[s] ?? emptyStoreMaster(s)) : null);
    setMsg("");
    setDirty(false);
  }

  function update(patch: Partial<FormState>) {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setDirty(true);
    setMsg("");
  }

  async function handleSave() {
    if (!form || !store) return;
    if (form.rmStart && form.rmEnd && form.rmStart > form.rmEnd) {
      setMsg("無償期間の開始日と終了日が逆になっています");
      return;
    }
    const liquidPrices: Record<string, number> = {};
    for (const r of form.liquids) {
      const n = strNum(r.price);
      if (r.name.trim() && n !== null) liquidPrices[r.name.trim()] = n;
    }
    const master: StoreMaster = {
      storeName: store,
      royaltyRate: strNum(form.royaltyRate),
      liquidPrices,
      regularMaintenance: {
        amount: strNum(form.rmAmount),
        start: toSheetDate(form.rmStart),
        end: toSheetDate(form.rmEnd),
        months: [...form.rmMonths].sort((a, b) => a - b),
      },
      systemFee: strNum(form.systemFee),
      updatedAt: "",
    };
    setSaving(true);
    setMsg("保存中...");
    try {
      const saved = await saveStoreMaster(master);
      onSaved(saved);
      setDirty(false);
      setMsg("保存しました");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    if (dirty && !confirm("保存していない変更があります。閉じますか？")) return;
    setDirty(false);
    onClose();
  }

  if (!open) return null;

  const inputCls =
    "rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary tabular-nums";
  const labelCls = "text-xs font-semibold text-muted-foreground";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={handleClose}>
      <div
        className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">店舗マスタ</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              ここで設定した金額が、メイン画面で店舗・期間を選んだときの初期値になります。空欄の項目はメイン画面で手動入力します。
            </p>
          </div>
          <button onClick={handleClose} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="閉じる">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* 店舗一覧 */}
          <div className="max-h-40 shrink-0 overflow-y-auto border-b border-border sm:max-h-none sm:w-60 sm:border-b-0 sm:border-r">
            {storeNames.length === 0 && <p className="p-4 text-xs text-muted-foreground">店舗がありません</p>}
            {storeNames.map((s) => {
              const configured = isConfigured(masters[s]);
              return (
                <button
                  key={s}
                  onClick={() => selectStore(s)}
                  className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition ${
                    s === store ? "bg-primary/10 font-semibold text-primary" : "text-foreground hover:bg-muted"
                  }`}
                >
                  <span className="truncate">{s}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      configured ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {configured ? "設定済" : "未設定"}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 編集フォーム */}
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {!form ? (
              <p className="text-sm text-muted-foreground">左の一覧から店舗を選択してください。</p>
            ) : (
              <div className="space-y-8">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-base font-bold text-foreground">{store}</h3>
                  {masters[store]?.updatedAt && (
                    <span className="text-xs text-muted-foreground">最終更新: {masters[store].updatedAt}</span>
                  )}
                </div>

                {/* ロイヤリティ */}
                <section className="space-y-2">
                  <p className={labelCls}>ロイヤリティ率</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={form.royaltyRate}
                      onChange={(e) => update({ royaltyRate: e.target.value })}
                      className={`${inputCls} w-28 text-right`}
                      placeholder="未設定"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </section>

                {/* 液剤単価 */}
                <section className="space-y-2">
                  <p className={labelCls}>液剤のデフォルト単価（税抜）</p>
                  <div className="overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted text-xs text-muted-foreground">
                          <th className="px-3 py-2 text-left font-semibold">品名</th>
                          <th className="px-3 py-2 text-right font-semibold">単価</th>
                          <th className="w-16 px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {form.liquids.map((r, i) => (
                          <tr key={i} className="border-b border-border last:border-b-0">
                            <td className="px-3 py-1.5">
                              <input
                                type="text"
                                value={r.name}
                                onChange={(e) =>
                                  update({ liquids: form.liquids.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })
                                }
                                className={`${inputCls} w-full`}
                                placeholder="品名（APIKAシートの品名と同じ表記）"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <input
                                type="number"
                                min={0}
                                value={r.price}
                                onChange={(e) =>
                                  update({ liquids: form.liquids.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) })
                                }
                                className={`${inputCls} w-32 text-right`}
                                placeholder="未設定"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <button
                                onClick={() => update({ liquids: form.liquids.filter((_, j) => j !== i) })}
                                className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-500 hover:bg-red-50"
                              >
                                削除
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button
                    onClick={() => update({ liquids: [...form.liquids, { name: "", price: "" }] })}
                    className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    + 液剤を追加
                  </button>
                  <p className="text-xs text-muted-foreground">単価が空欄の液剤は、APIKAシートの単価がそのまま使われます。</p>
                </section>

                {/* 定期メンテナンス */}
                <section className="space-y-3">
                  <p className={labelCls}>定期メンテナンス</p>
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">金額（税抜・1回あたり）</span>
                      <input
                        type="number"
                        min={0}
                        value={form.rmAmount}
                        onChange={(e) => update({ rmAmount: e.target.value })}
                        className={`${inputCls} w-36 text-right`}
                        placeholder="未設定"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">無償期間</span>
                      <div className="flex items-center gap-2">
                        <input type="date" value={form.rmStart} onChange={(e) => update({ rmStart: e.target.value })} className={inputCls} />
                        <span className="text-muted-foreground">〜</span>
                        <input type="date" value={form.rmEnd} onChange={(e) => update({ rmEnd: e.target.value })} className={inputCls} />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs text-muted-foreground">実施月（この月の請求書にだけ表示されます）</span>
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                        const on = form.rmMonths.includes(m);
                        return (
                          <button
                            key={m}
                            onClick={() =>
                              update({ rmMonths: on ? form.rmMonths.filter((x) => x !== m) : [...form.rmMonths, m] })
                            }
                            className={`w-11 rounded-md py-1 text-xs font-semibold transition ${
                              on ? "bg-primary text-primary-foreground" : "border border-border bg-muted text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {m}月
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    実施月の請求書に上の金額が自動で入ります。無償期間に含まれる月は0円になり、「{FREE_MAINTENANCE_NOTE}」と表示されます。金額が空欄の場合はメイン画面で手動入力します。
                  </p>
                </section>

                {/* システム利用料 */}
                <section className="space-y-2">
                  <p className={labelCls}>システム利用料（月額・税抜）</p>
                  <input
                    type="number"
                    min={0}
                    value={form.systemFee}
                    onChange={(e) => update({ systemFee: e.target.value })}
                    className={`${inputCls} w-36 text-right`}
                    placeholder="未設定"
                  />
                </section>
              </div>
            )}
          </div>
        </div>

        {/* フッター */}
        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-3">
          {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
          <button onClick={handleClose} className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted">
            閉じる
          </button>
          <button
            onClick={handleSave}
            disabled={!form || saving}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
