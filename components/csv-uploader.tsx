"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import { appendCashlessRows } from "@/app/actions";

type UploadStatus = "idle" | "parsing" | "uploading" | "done" | "error";

export function CsvUploader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [message, setMessage] = useState("");
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const names = Array.from(files).map((f) => f.name);
    setFileNames(names);
    setStatus("parsing");
    setMessage("CSVを解析中...");

    try {
      // 全ファイルを並列パース
      const perFileRows = await Promise.all(
        Array.from(files).map(
          (file) =>
            new Promise<string[][]>((resolve, reject) => {
              Papa.parse<string[]>(file, {
                skipEmptyLines: true,
                complete: (result) => {
                  // ヘッダー行をスキップ（1行目）
                  const data = result.data.slice(1);
                  // A=0, V=21, AE=30, AG=32 列を抽出
                  const extracted = data.map((row) => [
                    row[0] ?? "",   // A列 → CASHLESS A列（日付）
                    row[21] ?? "",  // V列 → CASHLESS B列（売上）
                    row[30] ?? "",  // AE列 → CASHLESS C列（商品名）
                    row[32] ?? "",  // AG列 → CASHLESS D列（店舗名）
                  ]);
                  resolve(extracted);
                },
                error: reject,
              });
            })
        )
      );

      // マージ（全ファイルの行を結合）
      const merged = perFileRows.flat().filter((row) =>
        row.some((cell) => cell.trim() !== "")
      );

      if (merged.length === 0) {
        setStatus("error");
        setMessage("有効なデータが見つかりませんでした。");
        return;
      }

      setStatus("uploading");
      setMessage(`${merged.length} 行をスプレッドシートに反映中...`);

      const result = await appendCashlessRows(merged);
      setStatus("done");
      setMessage(`完了: ${result.appended} 行を CASHLESS シートに追記しました。`);
    } catch (e) {
      console.error("[v0] CSV upload error:", e);
      setStatus("error");
      setMessage(
        e instanceof Error ? e.message : "アップロード中にエラーが発生しました。"
      );
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleFiles(e.target.files);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  function reset() {
    setFileNames([]);
    setStatus("idle");
    setMessage("");
    if (inputRef.current) inputRef.current.value = "";
  }

  const isLoading = status === "parsing" || status === "uploading";

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
            キャッシュレスデータ インポート
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            一度CHASHLESSシートに追加されているなら複数回する必要なし
          </p>
        </div>
        {status !== "idle" && (
          <button
            onClick={reset}
            className="text-xs text-muted-foreground hover:text-foreground transition"
          >
            リセット
          </button>
        )}
      </div>

      {/* ドロップゾーン */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !isLoading && inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed
          py-8 cursor-pointer transition-colors
          ${dragOver
            ? "border-primary bg-accent"
            : "border-border hover:border-primary/50 bg-muted/40"
          }
          ${isLoading ? "pointer-events-none opacity-60" : ""}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          multiple
          className="hidden"
          onChange={handleInputChange}
        />
        <svg
          className="w-8 h-8 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
        <p className="text-sm text-muted-foreground">
          {fileNames.length > 0
            ? fileNames.join(", ")
            : "クリックまたはドラッグ＆ドロップでCSVファイルを選択"}
        </p>
        <p className="text-xs text-muted-foreground/60">複数ファイル同時選択可</p>
      </div>

      {/* ステータスメッセージ */}
      {message && (
        <div
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm ${
            status === "done"
              ? "bg-green-50 border border-green-200 text-green-700"
              : status === "error"
              ? "bg-red-50 border border-red-200 text-red-700"
              : "bg-muted border border-border text-muted-foreground"
          }`}
        >
          {isLoading && (
            <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
          )}
          {message}
        </div>
      )}
    </div>
  );
}
