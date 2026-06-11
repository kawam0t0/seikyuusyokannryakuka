"use client";

import { useState } from "react";
import type { SalesRow } from "@/app/actions";

type Props = {
  storeName: string;
  period: string;
  cash: number;
  cashExTax: number;
  cashless: number;
  cashlessExTax: number;
  member: number;
  memberExTax: number;
  totalExTax: number;
  royaltyRate: number;
  royaltyAmount: number;
  royaltyAmountExTax: number;
  details: SalesRow[];
};

const CATEGORY_LABEL: Record<string, string> = {
  cash: "現金売上",
  cashless: "キャッシュレス売上",
  member: "サブスク売上",
};

const CATEGORY_COLOR: Record<string, { header: string; dot: string; text: string }> = {
  cash:     { header: "#f0fdf4", dot: "#22c55e", text: "#15803d" },
  cashless: { header: "#eff6ff", dot: "#3b82f6", text: "#1d4ed8" },
  member:   { header: "#faf5ff", dot: "#a855f7", text: "#7e22ce" },
};

export function PdfExport({
  storeName,
  period,
  cash,
  cashExTax,
  cashless,
  cashlessExTax,
  member,
  memberExTax,
  totalExTax,
  royaltyRate,
  royaltyAmount,
  royaltyAmountExTax,
  details,
}: Props) {
  const [loading, setLoading] = useState(false);

  const total = cash + cashless + member;
  const fmt = (v: number) => `\u00a5${v.toLocaleString("ja-JP")}`;

  const grouped: Record<string, SalesRow[]> = {
    cash:     details.filter((r) => r.category === "cash"),
    cashless: details.filter((r) => r.category === "cashless"),
    member:   details.filter((r) => r.category === "member"),
  };

  function buildTableHtml(category: string, rows: SalesRow[]): string {
    const subtotal = rows.reduce((s, r) => s + r.amount, 0);
    const c = CATEGORY_COLOR[category];
    const rowsHtml = rows.length === 0
      ? `<tr><td colspan="5" style="padding:12px;text-align:center;color:#94a3b8;font-size:11px;">該当するデータがありません</td></tr>`
      : rows.map((r, i) => `
          <tr style="background:${i % 2 === 0 ? "#ffffff" : "#f8fafc"};">
            <td style="padding:5px 10px;color:#334155;white-space:nowrap;">${r.date}</td>
            <td style="padding:5px 10px;text-align:right;font-weight:600;color:${r.amount < 0 ? "#dc2626" : "#0f172a"};white-space:nowrap;">${r.amount !== 0 ? fmt(r.amount) : ""}</td>
            <td style="padding:5px 10px;color:#334155;">${r.storeName}</td>
            <td style="padding:5px 10px;color:#64748b;">${r.itemName ?? ""}</td>
            <td style="padding:5px 10px;text-align:right;color:#64748b;">${r.quantity ?? ""}</td>
          </tr>`).join("");

    return `
      <div style="margin-bottom:20px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;page-break-inside:avoid;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px;background:${c.header};">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="width:9px;height:9px;border-radius:50%;background:${c.dot};display:inline-block;"></span>
            <span style="font-size:11px;font-weight:700;color:${c.text};">${CATEGORY_LABEL[category]}</span>
          </div>
          <span style="font-size:11px;font-weight:700;color:${c.text};">小計: ${fmt(subtotal)}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">
              <th style="padding:6px 10px;text-align:left;font-size:10px;color:#64748b;font-weight:600;">日付</th>
              <th style="padding:6px 10px;text-align:right;font-size:10px;color:#64748b;font-weight:600;">売上</th>
              <th style="padding:6px 10px;text-align:left;font-size:10px;color:#64748b;font-weight:600;">店名</th>
              <th style="padding:6px 10px;text-align:left;font-size:10px;color:#64748b;font-weight:600;">アイテム名</th>
              <th style="padding:6px 10px;text-align:right;font-size:10px;color:#64748b;font-weight:600;">台数</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
  }

  function handleExport() {
    setLoading(true);
    try {
      const today = new Date().toLocaleDateString("ja-JP");
      const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>THE COCKPIT - ${storeName} ${period}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', Meiryo, sans-serif;
      font-size: 12px;
      color: #0f172a;
      background: #ffffff;
      padding: 24px 32px;
    }
    @page {
      size: A3 portrait;
      margin: 16mm 14mm;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
    }
    .btn-print {
      display: inline-block;
      margin-bottom: 20px;
      padding: 8px 20px;
      background: #1d4ed8;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
    }
    .btn-print:hover { background: #1e40af; }
  </style>
</head>
<body>
  <button class="btn-print no-print" onclick="window.print()">印刷 / PDF保存</button>

  <!-- ヘッダー -->
  <div style="background:#0f172a;padding:16px 24px;border-radius:8px;margin-bottom:18px;">
    <div style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:2px;">THE COCKPIT</div>
    <div style="font-size:10px;color:#94a3b8;margin-top:3px;">売上ダッシュボード レポート</div>
  </div>

  <!-- 店舗・期間 -->
  <div style="display:flex;gap:12px;margin-bottom:16px;">
    <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px;">
      <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">店舗名</div>
      <div style="font-size:16px;font-weight:700;">${storeName}</div>
    </div>
    <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px;">
      <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">対象期間</div>
      <div style="font-size:16px;font-weight:700;">${period}</div>
    </div>
  </div>

  <!-- 売上サマリー -->
  <div style="font-size:13px;font-weight:700;margin-bottom:8px;">売上サマリー</div>
  <div style="display:flex;gap:10px;margin-bottom:16px;">
    <div style="flex:1;background:#f8fafc;border-radius:6px;padding:12px 14px;border-left:3px solid #22c55e;">
      <div style="font-size:9px;color:#64748b;margin-bottom:4px;">現金売上</div>
      <div style="font-size:14px;font-weight:700;color:#15803d;">${fmt(cash)}</div>
      <div style="font-size:10px;color:#64748b;margin-top:3px;">税抜: ${fmt(cashExTax)}</div>
    </div>
    <div style="flex:1;background:#f8fafc;border-radius:6px;padding:12px 14px;border-left:3px solid #3b82f6;">
      <div style="font-size:9px;color:#64748b;margin-bottom:4px;">キャッシュレス売上</div>
      <div style="font-size:14px;font-weight:700;color:#1d4ed8;">${fmt(cashless)}</div>
      <div style="font-size:10px;color:#64748b;margin-top:3px;">税抜: ${fmt(cashlessExTax)}</div>
    </div>
    <div style="flex:1;background:#f8fafc;border-radius:6px;padding:12px 14px;border-left:3px solid #a855f7;">
      <div style="font-size:9px;color:#64748b;margin-bottom:4px;">サブスク売上</div>
      <div style="font-size:14px;font-weight:700;color:#7e22ce;">${fmt(member)}</div>
      <div style="font-size:10px;color:#64748b;margin-top:3px;">税抜: ${fmt(memberExTax)}</div>
    </div>
    <div style="flex:1;background:#f8fafc;border-radius:6px;padding:12px 14px;border-left:3px solid #0f172a;">
      <div style="font-size:9px;color:#64748b;margin-bottom:4px;">総売上</div>
      <div style="font-size:14px;font-weight:700;color:#0f172a;">${fmt(cash + cashless + member)}</div>
      <div style="font-size:10px;color:#64748b;margin-top:3px;">税抜: ${fmt(totalExTax)}</div>
    </div>
  </div>

  <!-- ロイヤリティ -->
  <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:14px 18px;margin-bottom:22px;">
    <div style="font-size:10px;color:#64748b;margin-bottom:4px;">ロイヤリティ率: ${royaltyRate}%</div>
    <div style="font-size:20px;font-weight:900;color:#1d4ed8;">ロイヤリティ金額: ${fmt(royaltyAmount)}</div>
    <div style="font-size:11px;color:#3b82f6;margin-top:4px;">税抜: ${fmt(royaltyAmountExTax)}</div>
  </div>

  <!-- 内訳 -->
  <div style="font-size:13px;font-weight:700;margin-bottom:10px;">売上内訳</div>
  ${buildTableHtml("cash", grouped.cash)}
  ${buildTableHtml("cashless", grouped.cashless)}
  ${buildTableHtml("member", grouped.member)}

  <!-- フッター -->
  <div style="margin-top:18px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8;display:flex;justify-content:space-between;">
    <span>THE COCKPIT — 売上ダッシュボード</span>
    <span>作成日: ${today}</span>
  </div>
</body>
</html>`;

      const win = window.open("", "_blank");
      if (!win) {
        alert("ポップアップがブロックされています。ブラウザの設定でポップアップを許可してください。");
        return;
      }
      win.document.write(html);
      win.document.close();
    } catch (e) {
      console.error("[v0] PDF export error:", e);
      alert("PDF の生成に失敗しました: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={loading}
      className="flex items-center gap-2 rounded-lg border border-border bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      PDF ダウンロード
    </button>
  );
}
