"use client";

import { useRef, useState } from "react";
import { appendHirockRows, type HirockRow } from "@/app/invoice-actions";

type Props = {
  storeName: string;
  period: string;
  onImported?: () => void;
};

type Status = "idle" | "parsing" | "preview" | "saving" | "done" | "error";

export function HirockPdfImporter({ storeName, period, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState<HirockRow[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const fmt = (v: number) => v > 0 ? `¥${v.toLocaleString("ja-JP")}` : "";

  async function processFiles(files: File[]) {
    const pdfs = files.filter((f) => f.type === "application/pdf");
    if (pdfs.length === 0) return;

    setStatus("parsing");
    const allRows: HirockRow[] = [];
    const errors: string[] = [];

    for (let i = 0; i < pdfs.length; i++) {
      const file = pdfs[i];
      setMessage(`Gemini AI が解析中... (${i + 1} / ${pdfs.length}) ${file.name}`);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("storeName", storeName);
        formData.append("period", period);

        const res = await fetch("/api/parse-pdf", { method: "POST", body: formData });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? `サーバーエラー (${res.status})`);
        }
        const json = await res.json();
        const structured: HirockRow[] = json.rows ?? [];
        allRows.push(...structured);
      } catch (e) {
        errors.push(`${file.name}: ${e instanceof Error ? e.message : "解析失敗"}`);
      }
    }

    if (allRows.length === 0) {
      setStatus("error");
      setMessage(errors.length > 0 ? errors.join(" / ") : "データを抽出できませんでした。");
      return;
    }

    setRows(allRows);
    setStatus("preview");
    const summary = `${pdfs.length}件のPDFから${allRows.length}件のデータを検出しました。内容を確認して保存してください。`;
    setMessage(errors.length > 0 ? `${summary}（失敗: ${errors.join(" / ")}）` : summary);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    processFiles(files);
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) processFiles(files);
  }

  function handleCellChange(i: number, key: keyof HirockRow, value: string) {
    setRows((prev) =>
      prev.map((row, idx) => {
        if (idx !== i) return row;
        const updated = {
          ...row,
          [key]: key === "date" || key === "storeName" || key === "itemName"
            ? value
            : parseFloat(value) || 0,
        };
        if (key === "quantity" || key === "unitPrice") {
          updated.total = updated.quantity * updated.unitPrice;
        }
        return updated;
      })
    );
  }

  function handleAddRow() {
    setRows((prev) => [
      ...prev,
      { date: "", storeName: storeName, itemName: "", quantity: 1, unitPrice: 0, total: 0 },
    ]);
  }

  function handleDeleteRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    setStatus("saving");
    setMessage("HIROCKシートに保存中...");
    try {
      const result = await appendHirockRows(rows);
      setStatus("done");
      setMessage(`${result.appended}件をHIROCKシートに保存しました。`);
      onImported?.();
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "保存に失敗しました");
    }
  }

  function reset() {
    setStatus("idle");
    setMessage("");
    setRows([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  const isLoading = status === "parsing" || status === "saving";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">消耗品PDF取込み（HIROCKシート）</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            PDFをアップロードするとGemini AIが直接解析し、テーブルで確認後にシートへ保存します
          </p>
        </div>
        {status !== "idle" && (
          <button onClick={reset} className="text-xs text-muted-foreground hover:text-foreground transition">
            リセット
          </button>
        )}
      </div>

      {/* ドロップゾーン */}
      {(status === "idle" || status === "error") && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !isLoading && inputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-8 cursor-pointer transition-colors ${
            dragOver ? "border-primary bg-accent" : "border-border hover:border-primary/50 bg-muted/40"
          }`}
        >
          <input ref={inputRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleInput} />
          <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <p className="text-sm text-muted-foreground">クリックまたはドラッグ＆ドロップでPDFを選択</p>
          <p className="text-xs text-muted-foreground">複数ファイル同時選択可</p>
        </div>
      )}

      {/* ステータスメッセージ */}
      {message && (
        <div className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm ${
          status === "done" ? "bg-green-50 border border-green-200 text-green-700"
          : status === "error" ? "bg-red-50 border border-red-200 text-red-700"
          : "bg-muted border border-border text-muted-foreground"
        }`}>
          {isLoading && (
            <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
          )}
          {message}
        </div>
      )}

      {/* プレビューテーブル */}
      {(status === "preview" || status === "saving" || status === "done") && rows.length > 0 && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted">
                  {["日付", "店舗名", "品目", "数量", "単価", "合計", ""].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className={`border-b border-border ${i % 2 === 0 ? "bg-card" : "bg-muted/20"}`}>
                    <td className="px-2 py-1">
                      <input type="text" value={row.date}
                        onChange={(e) => handleCellChange(i, "date", e.target.value)}
                        className="w-28 bg-transparent border-b border-border focus:border-primary outline-none text-foreground" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="text" value={row.storeName}
                        onChange={(e) => handleCellChange(i, "storeName", e.target.value)}
                        className="w-36 bg-transparent border-b border-border focus:border-primary outline-none text-foreground" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="text" value={row.itemName}
                        onChange={(e) => handleCellChange(i, "itemName", e.target.value)}
                        className="w-48 bg-transparent border-b border-border focus:border-primary outline-none text-foreground" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" value={row.quantity}
                        onChange={(e) => handleCellChange(i, "quantity", e.target.value)}
                        className="w-14 bg-transparent border-b border-border focus:border-primary outline-none text-right text-foreground" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" value={row.unitPrice}
                        onChange={(e) => handleCellChange(i, "unitPrice", e.target.value)}
                        className="w-20 bg-transparent border-b border-border focus:border-primary outline-none text-right text-foreground" />
                    </td>
                    <td className="px-3 py-1 text-right font-medium text-foreground tabular-nums">{fmt(row.total)}</td>
                    <td className="px-2 py-1">
                      <button onClick={() => handleDeleteRow(i)} className="text-muted-foreground hover:text-red-500 transition text-xs">削除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted font-semibold">
                  <td colSpan={5} className="px-3 py-2 text-xs text-muted-foreground">合計</td>
                  <td className="px-3 py-2 text-right text-foreground tabular-nums text-xs">
                    {fmt(rows.reduce((s, r) => s + r.total, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex items-center gap-3 justify-between">
            <button onClick={handleAddRow} className="text-xs text-primary hover:underline">+ 行を追加</button>
            {status !== "done" && (
              <button
                onClick={handleSave}
                disabled={status === "saving"}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition"
              >
                {status === "saving" ? "保存中..." : "HIROCKシートに保存"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
