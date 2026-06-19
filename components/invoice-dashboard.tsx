"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import {
  fetchApikaRows,
  fetchMaintenanceRows,
  fetchHirockRows,
  fetchPartnerInfo,
  type ApikaRow,
  type MaintenanceRow,
  type HirockRow,
  type PartnerInfo,
} from "@/app/invoice-actions";

type InvoiceData = {
  apika: ApikaRow[];
  maintenance: MaintenanceRow[];
  hirock: HirockRow[];
};

type Props = {
  storeNames: string[];
  // 売上ダッシュボードから引き継いだ値
  selectedStore: string;
  selectedPeriod: string;
  royaltyAmountExTax: number;
  cashExTax: number;
  cashlessExTax: number;
  memberExTax: number;
};

export function InvoiceDashboard({
  selectedStore,
  selectedPeriod,
  royaltyAmountExTax,
  cashExTax,
  cashlessExTax,
  memberExTax,
}: Props) {
  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [partnerInfo, setPartnerInfo] = useState<PartnerInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [isPending, startTransition] = useTransition();
  // 行ごとの金額入力 key=インデックス value=金額
  const [maintenancePrices, setMaintenancePrices] = useState<Record<number, number>>({});
  const [hirockRefreshKey, setHirockRefreshKey] = useState(0);

  const fmt = (v: number) => `¥${v.toLocaleString("ja-JP")}`;
  const fmtNum = (v: number) => v > 0 ? `¥${v.toLocaleString("ja-JP")}` : "—";

  const loadInvoice = useCallback((store: string, period: string) => {
    if (!store || !period) return;
    setErrorMsg("");
    startTransition(async () => {
      try {
        const [apika, maintenance, hirock, partner] = await Promise.all([
          fetchApikaRows(store, period),
          fetchMaintenanceRows(store, period),
          fetchHirockRows(store, period),
          fetchPartnerInfo(store),
        ]);
        setInvoiceData({ apika, maintenance, hirock });
        setPartnerInfo(partner);
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "データ取得に失敗しました");
      }
    });
  }, []);

  // 店名・期間が変わったら自動で再取得し、金額入力もリセット
  useEffect(() => {
    setMaintenancePrices({});
    if (selectedStore && selectedPeriod) {
      loadInvoice(selectedStore, selectedPeriod);
    } else {
      setInvoiceData(null);
    }
  }, [selectedStore, selectedPeriod, hirockRefreshKey, loadInvoice]);

  const apikaTotal = invoiceData?.apika.reduce((s, r) => s + r.total, 0) ?? 0;
  const hirockTotal = invoiceData?.hirock.reduce((s, r) => s + r.total, 0) ?? 0;
  // 行ごとの金額の合計
  const maintenanceAmount = Object.values(maintenancePrices).reduce((s, v) => s + v, 0);
  const grandTotal = apikaTotal + maintenanceAmount + hirockTotal + royaltyAmountExTax;

  function handleCsvDownload() {
    if (!invoiceData || !selectedStore || !selectedPeriod) return;
    const d = invoiceData;

    // ---- 日付ユーティリティ ----
    const today = new Date();
    // 先月末日
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    const fmtDate = (dt: Date) =>
      `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`;
    const billingDate = fmtDate(lastMonthEnd);
    // 今月末日
    const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const dueDate = fmtDate(thisMonthEnd);

    // ---- 全明細行を収集（カテゴリー見出し行 + 明細行） ----
    type DetailRow = { date: string; name: string; qty: number; unitPrice: number; amount: number; isHeader?: boolean; detail?: string };
    const details: DetailRow[] = [];

    // 液剤代セクション
    if (d.apika.length > 0) {
      details.push({ date: "", name: "【液剤代】", qty: 0, unitPrice: 0, amount: 0, isHeader: true });
      d.apika.forEach((r) => details.push({ date: r.date, name: r.itemName, qty: r.quantity, unitPrice: r.unitPrice, amount: r.total }));
    }

    // メンテナンスセクション
    const maintenanceItems = d.maintenance.filter((r, i) => (maintenancePrices[i] ?? 0) > 0 || r.itemName);
    if (maintenanceItems.length > 0) {
      details.push({ date: "", name: "【メンテナンス】", qty: 0, unitPrice: 0, amount: 0, isHeader: true });
      d.maintenance.forEach((r, i) => {
        const price = maintenancePrices[i] ?? 0;
        if (price > 0 || r.itemName) {
          details.push({ date: r.date, name: r.itemName, qty: r.quantity || 1, unitPrice: price, amount: price });
        }
      });
    }

    // 消耗品セクション
    if (d.hirock.length > 0) {
      details.push({ date: "", name: "【消耗品】", qty: 0, unitPrice: 0, amount: 0, isHeader: true });
      d.hirock.forEach((r) => details.push({ date: r.date, name: r.itemName, qty: r.quantity, unitPrice: r.unitPrice, amount: r.total }));
    }

    // ロイヤリティセクション
    if (royaltyAmountExTax > 0) {
      details.push({ date: "", name: "【ロイヤリティ】", qty: 0, unitPrice: 0, amount: 0, isHeader: true });
      details.push({ date: billingDate, name: "ロイヤリティ", qty: 1, unitPrice: royaltyAmountExTax, amount: royaltyAmountExTax, detail: "詳細は別紙参照ください" });
    }

    const rowCount = details.length;
    const subtotal = grandTotal;
    const tax = Math.floor(subtotal * 0.1);
    const total = subtotal + tax;

    const p = partnerInfo;

    // ---- CSV行を構築（列はA〜ALの38列） ----
    // 1行目: カラム名（A〜AL 全38列、空欄なし）
    const header = [
      "csv_type(変更不可)", // A
      "行形式",             // B
      "取引先名称",          // C
      "件名",               // D
      "請求日",              // E
      "お支払期限",          // F
      "請求書番号",          // G
      "売上計上日",          // H
      "メモ",               // I
      "タグ",               // J
      "小計",               // K
      "消費税",              // L
      "合計金額",            // M
      "取引先敬称",          // N
      "取引先郵便番号",       // O
      "取引先都道府県",       // P
      "取引先住所1",         // Q
      "取引先住所2",         // R
      "取引先部署",          // S
      "取引先担当者役職",     // T
      "取引先担当者氏名",     // U
      "自社担当者氏名",       // V
      "備考",               // W
      "振込先",              // X
      "入金ステータス",       // Y
      "メール送信ステータス", // Z
      "郵送ステータス",      // AA
      "ダウンロードステータス", // AB
      "納品日",              // AC
      "品名",               // AD
      "品目コード",          // AE
      "単価",               // AF
      "数量",               // AG
      "単位",               // AH
      "納品書番号",          // AI
      "詳細",               // AJ
      "金額",               // AK
      "品目消費税率",        // AL
    ];

    // 2行目: 取引先情報行
    const infoRow = new Array(38).fill("");
    infoRow[0]  = rowCount > 0 ? "40101" : "";  // A: csv_type (明細がある場合)
    infoRow[1]  = "請求書";                       // B: 行形式
    infoRow[2]  = p?.name ?? "";                  // C: 取引先名称
    infoRow[3]  = "請求についてのご連絡";           // D: 件名
    infoRow[4]  = billingDate;                    // E: 請求日（先月末）
    infoRow[5]  = dueDate;                        // F: お支払期限（今月末）
    infoRow[10] = String(subtotal);               // K: 小計
    infoRow[11] = String(tax);                    // L: 消費税
    infoRow[12] = String(total);                  // M: 合計金額
    infoRow[13] = "御中";                          // N: 取引先敬称
    infoRow[14] = p?.zip   ?? "";                 // O: 郵便番号
    infoRow[15] = p?.pref  ?? "";                 // P: 都道府県
    infoRow[16] = p?.addr1 ?? "";                 // Q: 住所1
    infoRow[17] = p?.addr2 ?? "";                 // R: 住所2
    infoRow[18] = p?.dept  ?? "";                 // S: 部署
    infoRow[19] = p?.title ?? "";                 // T: 担当者役職
    infoRow[20] = p?.contact ?? "";               // U: 担当者氏名
    infoRow[21] = "岡村昌輝";                      // V: 自社担当者氏名
    infoRow[22] = "誠に恐れ入りますが、振り込み手数料はご負担いただきますようお願いいたします。"; // W: 備考
    infoRow[23] = "しののめ信用金庫(金融機関コード：1211)\n片貝支店(店番：055)\n普通口座　口座番号 1136005\n名義　ｶ)ｽﾌﾟﾗｯｼｭﾌﾞﾗｻﾞｰｽﾞ"; // X: 振込先

    // 3行目以降: 明細行（カテゴリー見出し行は品名のみ、明細行は各値を設定）
    const detailRows = details.map((det) => {
      const row = new Array(38).fill("");
      row[0]  = "40101";  // A: csv_type
      row[1]  = "品目";    // B: 行形式
      row[29] = det.name; // AD: 品名（見出し行も含む）
      row[37] = "10%";    // AL: 品目消費税率（3行目以降全行に設定）
      if (!det.isHeader) {
        row[28] = det.date;              // AC: 納品日
        row[31] = String(det.unitPrice); // AF: 単価
        row[32] = String(det.qty);       // AG: 数量
        row[35] = det.detail ?? "";      // AJ: 詳細
        row[36] = String(det.amount);    // AK: 金額
      }
      return row;
    });

    // ---- CSV文字列を生成 ----
    const escape = (v: string) => {
      if (v.includes(",") || v.includes('"') || v.includes("\n")) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    };
    const toLine = (row: string[]) => row.map(escape).join(",");

    const csvContent = [
      toLine(header),
      toLine(infoRow),
      ...detailRows.map(toLine),
    ].join("\r\n");

    // ---- BOM付きUTF-8でダウンロード ----
    const bom = "\uFEFF";
    const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `請求書_${selectedStore}_${selectedPeriod}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    if (!invoiceData || !selectedStore || !selectedPeriod) return;
    const d = invoiceData;

    const apikaRows = d.apika.map((r) => `
      <tr>
        <td>${r.date}</td>
        <td>${r.itemName}</td>
        <td style="text-align:right">${r.quantity}</td>
        <td style="text-align:right">${fmt(r.unitPrice)}</td>
        <td style="text-align:right">${fmt(r.total)}</td>
      </tr>`).join("");

    const hirockRows = d.hirock.map((r) => `
      <tr>
        <td>${r.date}</td>
        <td>${r.itemName}</td>
        <td style="text-align:right">${r.quantity}</td>
        <td style="text-align:right">${fmt(r.unitPrice)}</td>
        <td style="text-align:right">${fmt(r.total)}</td>
      </tr>`).join("");

    const maintenanceRows = d.maintenance.map((r, i) => `
      <tr>
        <td>${r.date}</td>
        <td>${r.itemName}</td>
        <td style="text-align:right">${r.quantity}</td>
        <td>${r.note}</td>
        <td style="text-align:right">${maintenancePrices[i] ? fmt(maintenancePrices[i]) : "—"}</td>
      </tr>`).join("") + (maintenanceAmount > 0 ? `
      <tr style="font-weight:700;border-top:2px solid #cbd5e1;">
        <td colspan="4">合計</td>
        <td style="text-align:right;">${fmt(maintenanceAmount)}</td>
      </tr>` : "");

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8"/>
<title>請求書 - ${selectedStore} ${selectedPeriod}</title>
<style>
  @page { size: A4 portrait; margin: 18mm 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif; font-size: 10px; color: #111; background: #fff; }
  @media screen { body { max-width: 800px; margin: 0 auto; padding: 30px; } }
  .print-btn { background:#1d4ed8; color:#fff; border:none; padding:10px 24px; border-radius:6px; font-size:13px; cursor:pointer; margin-bottom:20px; }
  @media print { .print-btn { display:none; } }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; padding-bottom:14px; border-bottom:2px solid #0f172a; }
  .header-left h1 { font-size:20px; font-weight:900; color:#0f172a; letter-spacing:0.05em; }
  .header-left p { font-size:10px; color:#64748b; margin-top:3px; }
  .header-right { text-align:right; font-size:10px; color:#475569; line-height:1.7; }
  .meta { display:flex; gap:20px; margin-bottom:18px; }
  .meta-box { flex:1; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px; }
  .meta-box label { font-size:9px; color:#64748b; text-transform:uppercase; letter-spacing:.05em; display:block; margin-bottom:3px; }
  .meta-box span { font-size:13px; font-weight:700; color:#0f172a; }
  .section { margin-bottom:18px; }
  .section-title { font-size:11px; font-weight:700; color:#0f172a; padding:6px 10px; background:#f1f5f9; border-left:3px solid #1d4ed8; margin-bottom:6px; }
  table { width:100%; border-collapse:collapse; font-size:9.5px; }
  th { background:#0f172a; color:#fff; padding:5px 8px; text-align:left; font-weight:600; }
  th.num { text-align:right; }
  td { padding:4px 8px; border-bottom:1px solid #e2e8f0; vertical-align:top; }
  td.num { text-align:right; }
  tr:nth-child(even) td { background:#f8fafc; }
  .subtotal { background:#f1f5f9; font-weight:700; }
  .subtotal td { border-top:2px solid #cbd5e1; color:#0f172a; }
  .summary { margin-top:20px; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; }
  .summary-row { display:flex; justify-content:space-between; align-items:center; padding:10px 16px; border-bottom:1px solid #e2e8f0; font-size:10px; }
  .summary-row:last-child { border-bottom:none; background:#0f172a; color:#fff; }
  .summary-row .label { color:#475569; }
  .summary-row:last-child .label { color:#94a3b8; }
  .summary-row .amount { font-weight:700; font-size:12px; }
  .no-data { padding:12px; text-align:center; color:#94a3b8; font-size:9.5px; }
  .footer { margin-top:24px; font-size:9px; color:#94a3b8; text-align:center; }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">印刷 / PDF保存</button>
<div class="header">
  <div class="header-left">
    <h1>THE COCKPIT</h1>
    <p>請求書</p>
  </div>
  <div class="header-right">
    <strong style="font-size:14px;">請 求 書</strong><br/>
    発行日: ${new Date().toLocaleDateString("ja-JP")}
  </div>
</div>
<div class="meta">
  <div class="meta-box"><label>請求先</label><span>${selectedStore} 御中</span></div>
  <div class="meta-box"><label>対象期間</label><span>${selectedPeriod}</span></div>
</div>
<div class="section">
  <div class="section-title">液剤代（APIKA）</div>
  ${d.apika.length === 0 ? '<p class="no-data">該当データなし</p>' : `
  <table>
    <thead><tr><th>日付</th><th>品名</th><th class="num">数量</th><th class="num">単価</th><th class="num">合計</th></tr></thead>
    <tbody>${apikaRows}</tbody>
    <tfoot><tr class="subtotal"><td colspan="4">小計</td><td class="num">${fmt(apikaTotal)}</td></tr></tfoot>
  </table>`}
</div>
<div class="section">
  <div class="section-title">メンテナンス</div>
  ${d.maintenance.length === 0 && maintenanceAmount === 0 ? '<p class="no-data">該当データなし</p>' : `
  <table>
    <thead><tr><th>日付</th><th>品名</th><th class="num">�����量</th><th>備考</th><th class="num">金額</th></tr></thead>
    <tbody>${maintenanceRows}</tbody>
  </table>`}
</div>
<div class="section">
  <div class="section-title">消耗品（HIROCK）</div>
  ${d.hirock.length === 0 ? '<p class="no-data">該当データなし</p>' : `
  <table>
    <thead><tr><th>日付</th><th>品目</th><th class="num">数量</th><th class="num">単価</th><th class="num">合計</th></tr></thead>
    <tbody>${hirockRows}</tbody>
    <tfoot><tr class="subtotal"><td colspan="4">小計</td><td class="num">${fmt(hirockTotal)}</td></tr></tfoot>
  </table>`}
</div>
<div class="section">
  <div class="section-title">ロイヤリティ（税抜）</div>
  <table>
    <thead><tr><th>項目</th><th>備考</th><th class="num">金額</th></tr></thead>
    <tbody>
      <tr>
        <td>ロイヤリティ</td>
        <td style="font-size:8.5px;color:#64748b;">
          現金売上(税抜) ${fmt(cashExTax)} ／
          キャ���シュレス(税抜) ${fmt(cashlessExTax)} ／
          サブスク(税抜) ${fmt(memberExTax)}
        </td>
        <td class="num">${fmt(royaltyAmountExTax)}</td>
      </tr>
    </tbody>
  </table>
</div>
<div class="summary">
  <div class="summary-row"><span class="label">液剤代 小計</span><span class="amount">${fmt(apikaTotal)}</span></div>
  <div class="summary-row"><span class="label">メンテナンス</span><span class="amount">${fmt(maintenanceAmount)}</span></div>
  <div class="summary-row"><span class="label">消耗品 小計</span><span class="amount">${fmt(hirockTotal)}</span></div>
  <div class="summary-row"><span class="label">ロイヤリティ（税抜）</span><span class="amount">${fmt(royaltyAmountExTax)}</span></div>
  <div class="summary-row"><span class="label">合計（税抜）</span><span class="amount" style="font-size:16px;">${fmt(grandTotal)}</span></div>
</div>
<div class="footer">Generated: ${new Date().toLocaleString("ja-JP")}</div>
</body>
</html>`;

    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    win.document.write(html);
    win.document.close();
  }

  // 店名・��間が未選択の場合
  if (!selectedStore || !selectedPeriod) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        上の売上ダッシュボードで店名と期間を選択すると、請求書が表示されます。
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ヘッダー行 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">{selectedStore} 御中</p>
          <p className="text-xs text-muted-foreground mt-0.5">{selectedPeriod}</p>
        </div>
        {invoiceData && (
          <div className="flex gap-2">
            <button
              onClick={handleCsvDownload}
              className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              CSVダウンロード
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-2 text-sm font-semibold text-foreground hover:bg-muted transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              印刷 / PDF保存
            </button>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMsg}</div>
      )}

      {isPending && (
        <div className="flex items-center justify-center gap-3 rounded-lg border border-border bg-card/50 py-10 text-sm text-muted-foreground">
          <span className="inline-block w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          データを取得中...
        </div>
      )}

      {!isPending && (
        <div className="space-y-6">
          {/* 液剤代 */}
          <InvoiceSection title="液剤代（APIKA）" color="bg-green-500" total={apikaTotal} isEmpty={!invoiceData || invoiceData.apika.length === 0}>
            {invoiceData && invoiceData.apika.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">日付</th>
                    <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">品名</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-semibold">数量</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-semibold">単価</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-semibold">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceData.apika.map((r, i) => (
                    <tr key={i} className={`border-b border-border ${i % 2 === 0 ? "bg-card" : "bg-muted/20"}`}>
                      <td className="px-4 py-2.5 text-foreground tabular-nums">{r.date}</td>
                      <td className="px-4 py-2.5 text-foreground">{r.itemName}</td>
                      <td className="px-4 py-2.5 text-right text-foreground tabular-nums">{r.quantity}</td>
                      <td className="px-4 py-2.5 text-right text-foreground tabular-nums">{fmtNum(r.unitPrice)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-foreground tabular-nums">{fmtNum(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </InvoiceSection>

          {/* メンテナンス */}
          <InvoiceSection title="メンテナンス" color="bg-blue-500" total={maintenanceAmount} isEmpty={!invoiceData || invoiceData.maintenance.length === 0}>
            {invoiceData && invoiceData.maintenance.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">日付</th>
                    <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">品名</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-semibold">数量</th>
                    <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">備考</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-semibold">金額（入力）</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceData.maintenance.map((r, i) => (
                    <tr key={i} className={`border-b border-border ${i % 2 === 0 ? "bg-card" : "bg-muted/20"}`}>
                      <td className="px-4 py-2.5 text-foreground tabular-nums">{r.date}</td>
                      <td className="px-4 py-2.5 text-foreground">{r.itemName}</td>
                      <td className="px-4 py-2.5 text-right text-foreground tabular-nums">{r.quantity}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.note}</td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          value={maintenancePrices[i] ?? 0}
                          onChange={(e) =>
                            setMaintenancePrices((prev) => ({
                              ...prev,
                              [i]: Math.max(0, parseInt(e.target.value) || 0),
                            }))
                          }
                          className="w-28 rounded border border-border bg-card px-2 py-1 text-right text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 tabular-nums"
                          placeholder="0"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/40">
                    <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-foreground">合計</td>
                    <td className="px-4 py-2.5 text-right text-sm font-bold text-foreground tabular-nums">
                      {fmt(maintenanceAmount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </InvoiceSection>

          {/* 消耗品 HIROCK */}
          <InvoiceSection title="消耗品（HIROCK）" color="bg-orange-500" total={hirockTotal} isEmpty={!invoiceData || invoiceData.hirock.length === 0}>
            {invoiceData && invoiceData.hirock.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">日付</th>
                    <th className="px-4 py-2.5 text-left text-muted-foreground font-semibold">品目</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-semibold">数量</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-semibold">単価</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-semibold">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceData.hirock.map((r, i) => (
                    <tr key={i} className={`border-b border-border ${i % 2 === 0 ? "bg-card" : "bg-muted/20"}`}>
                      <td className="px-4 py-2.5 text-foreground tabular-nums">{r.date}</td>
                      <td className="px-4 py-2.5 text-foreground">{r.itemName}</td>
                      <td className="px-4 py-2.5 text-right text-foreground tabular-nums">{r.quantity}</td>
                      <td className="px-4 py-2.5 text-right text-foreground tabular-nums">{fmtNum(r.unitPrice)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-foreground tabular-nums">{fmtNum(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </InvoiceSection>

          {/* ロイヤリティ */}
          <InvoiceSection title="ロイヤリティ（税抜）" color="bg-purple-500" total={royaltyAmountExTax} isEmpty={royaltyAmountExTax === 0}>
            {royaltyAmountExTax > 0 && (
              <div className="p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-foreground">ロイヤリティ金額（税抜）</span>
                  <span className="font-bold text-primary text-base tabular-nums">{fmt(royaltyAmountExTax)}</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "現金売上（税抜）", val: cashExTax },
                    { label: "キャッシュレス（税抜）", val: cashlessExTax },
                    { label: "サブスク（税抜）", val: memberExTax },
                  ].map(({ label, val }) => (
                    <div key={label} className="rounded-lg bg-muted px-3 py-2 text-xs">
                      <p className="text-muted-foreground">{label}</p>
                      <p className="font-semibold text-foreground mt-1 tabular-nums">{fmt(val)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </InvoiceSection>

          {/* 合計 */}
          <div className="rounded-lg border-2 border-foreground bg-card p-6 flex justify-between items-center">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">請求合計（税抜）</p>
              <p className="text-xs text-muted-foreground mt-1">液剤代 + メンテナンス + 消耗品 + ロイヤリティ</p>
            </div>
            <p className="text-4xl font-bold text-foreground tabular-nums">{fmt(grandTotal)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function InvoiceSection({
  title, color, total, isEmpty, children,
}: {
  title: string;
  color: string;
  total?: number;
  isEmpty: boolean;
  children?: React.ReactNode;
}) {
  const fmt = (v: number) => `¥${v.toLocaleString("ja-JP")}`;
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {total !== undefined && (
          <span className="text-sm font-bold text-foreground tabular-nums">
            小計: {fmt(total)}
          </span>
        )}
      </div>
      {isEmpty && !children ? (
        <p className="px-5 py-6 text-sm text-center text-muted-foreground">該当データなし</p>
      ) : (
        children
      )}
    </div>
  );
}
