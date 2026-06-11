import type { SalesRow } from "@/app/actions";

type Props = {
  rows: SalesRow[];
};

const CATEGORY_CONFIG = {
  cash: { label: "現金売上", color: "bg-green-500", textColor: "text-green-700", bgColor: "bg-green-50" },
  cashless: { label: "キャッシュレス売上", color: "bg-blue-500", textColor: "text-blue-700", bgColor: "bg-blue-50" },
  member: { label: "サブスク売上", color: "bg-purple-500", textColor: "text-purple-700", bgColor: "bg-purple-50" },
} as const;

function CategoryTable({ rows, category }: { rows: SalesRow[]; category: "cash" | "cashless" | "member" }) {
  const config = CATEGORY_CONFIG[category];
  const subtotal = rows.reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* カテゴリヘッダー */}
      <div className={`flex items-center justify-between px-4 py-3 ${config.bgColor}`}>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${config.color}`} />
          <span className={`text-xs font-bold uppercase tracking-widest ${config.textColor}`}>
            {config.label}
          </span>
        </div>
        <span className={`text-sm font-bold tabular-nums ${config.textColor}`}>
          小計: ¥{subtotal.toLocaleString("ja-JP")}
        </span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted">
            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              日付
            </th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              売上
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              店名
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              アイテム名
            </th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              台数
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground text-xs">
                該当するデータがありません
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={i}
                className={`border-b border-border transition-colors hover:bg-muted/50 ${
                  i % 2 === 0 ? "bg-card" : "bg-muted/20"
                }`}
              >
                <td className="px-4 py-2.5 text-foreground tabular-nums text-xs">
                  {row.date}
                </td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-medium text-xs ${row.amount < 0 ? "text-red-600" : "text-foreground"}`}>
                  {row.amount !== 0 ? `¥${row.amount.toLocaleString("ja-JP")}` : ""}
                </td>
                <td className="px-4 py-2.5 text-foreground text-xs">{row.storeName}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{row.itemName}</td>
                <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums text-xs">
                  {row.quantity ?? ""}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function DetailsTable({ rows }: Props) {
  const cashRows = rows.filter((r) => r.category === "cash");
  const cashlessRows = rows.filter((r) => r.category === "cashless");
  const memberRows = rows.filter((r) => r.category === "member");

  return (
    <div className="space-y-4">
      <CategoryTable rows={cashRows} category="cash" />
      <CategoryTable rows={cashlessRows} category="cashless" />
      <CategoryTable rows={memberRows} category="member" />
    </div>
  );
}
