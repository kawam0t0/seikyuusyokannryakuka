"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import {
  fetchApikaRows,
  fetchMaintenanceRows,
  fetchHirockRows,
  fetchPartnerInfo,
  fetchSupportRows,
  appendSupportRows,
  type ApikaRow,
  type MaintenanceRow,
  type HirockRow,
  type PartnerInfo,
  type SupportRow,
} from "@/app/invoice-actions";
import { fetchOtherItems, saveOtherItems, type OtherItem } from "@/app/other-actions";
import {
  getRegularMaintenanceStatus,
  lookupLiquidPrice,
  FREE_MAINTENANCE_NOTE,
  type StoreMasterMap,
} from "@/lib/store-master";

type InvoiceData = {
  apika: ApikaRow[];
  maintenance: MaintenanceRow[];
  hirock: HirockRow[];
  support: SupportRow[];
};

type Props = {
  storeNames: string[];
  masters?: StoreMasterMap;
  // 売上ダッシュボードから引き継いだ値
  selectedStore: string;
  selectedPeriod: string;
  royaltyAmountExTax: number;
  cashExTax: number;
  cashlessExTax: number;
  memberExTax: number;
};

export function InvoiceDashboard({
  masters = {},
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
  // 部品処分費用（メンテナンスデータがある場合にデフォルトON）
  const DISPOSAL_FEE = 5000;
  const [includeDisposalFee, setIncludeDisposalFee] = useState(true);

  // 消耗品（HIROCK）手動追加行
  type HirockManualRow = { date: string; itemName: string; quantity: string; unitPrice: string };
  const emptyHirockRow = (): HirockManualRow => ({ date: "", itemName: "", quantity: "1", unitPrice: "" });
  const [hirockManualRows, setHirockManualRows] = useState<HirockManualRow[]>([]);

  // メンテナンス手動追加行
  type MaintenanceManualRow = { date: string; itemName: string; quantity: string; price: string; note: string };
  const emptyMaintenanceRow = (): MaintenanceManualRow => ({ date: "", itemName: "", quantity: "1", price: "", note: "" });
  const [maintenanceManualRows, setMaintenanceManualRows] = useState<MaintenanceManualRow[]>([]);

  // ---- 店舗マスタ ----
  const master = selectedStore ? masters[selectedStore] : undefined;
  // 液剤単価の手動上書き key=APIKA行インデックス value=入力値
  const [apikaPriceOverrides, setApikaPriceOverrides] = useState<Record<number, string>>({});
  // システム利用料（マスタ値 or 手動入力）
  const [systemFeeInput, setSystemFeeInput] = useState("");
  // 定期メンテナンス（マスタ値 or 手動入力）
  const [regMaintInput, setRegMaintInput] = useState("");
  const regMaint = getRegularMaintenanceStatus(master, selectedPeriod);
  const masterSystemFee = master?.systemFee ?? null;

  // 店舗・期間・マスタが変わったら、マスタの値を初期値としてセット
  useEffect(() => {
    setSystemFeeInput(masterSystemFee !== null ? String(masterSystemFee) : "");
  }, [selectedStore, selectedPeriod, masterSystemFee]);
  useEffect(() => {
    setRegMaintInput(regMaint.isTargetMonth && regMaint.defaultAmount !== null ? String(regMaint.defaultAmount) : "");
  }, [selectedStore, selectedPeriod, regMaint.isTargetMonth, regMaint.defaultAmount]);
  useEffect(() => {
    setApikaPriceOverrides({});
  }, [selectedStore, selectedPeriod]);

  // 高崎棟高店：マイクロファイバー分割料金
  const MICROFIBER_FEE = 10000;
  const isTakasaki = selectedStore.includes("高崎棟高");

  // 現場応援入力フォーム（複数行対応）
  type SupportEntry = { date: string; itemName: string; hours: string; unitPrice: string };
  const emptySupportEntry = (): SupportEntry => ({ date: "", itemName: "現場応援", hours: "", unitPrice: "1500" });
  const [supportEntries, setSupportEntries] = useState<SupportEntry[]>([emptySupportEntry()]);
  const [supportSaving, setSupportSaving] = useState(false);
  const [supportMsg, setSupportMsg] = useState("");

  // その他請求項目（全店舗共通・OTHERシートに保存）
  type OtherRow = { date: string; itemName: string; quantity: string; unitPrice: string; note: string };
  const emptyOtherRow = (): OtherRow => ({ date: "", itemName: "", quantity: "1", unitPrice: "", note: "" });
  const [otherRows, setOtherRows] = useState<OtherRow[]>([]);
  const [otherVisible, setOtherVisible] = useState(false);
  const [otherDirty, setOtherDirty] = useState(false);
  const [otherSaving, setOtherSaving] = useState(false);
  const [otherMsg, setOtherMsg] = useState("");
  const updateOtherRows = (fn: (prev: OtherRow[]) => OtherRow[]) => {
    setOtherRows(fn);
    setOtherDirty(true);
    setOtherMsg("");
  };

  const fmt = (v: number) => `¥${v.toLocaleString("ja-JP")}`;
  // 小数を含む数値も表示できるフォーマット（整数なら小数点なし）
  const fmtNum = (v: number) => {
    if (!v || v === 0) return "—";
    const isDecimal = !Number.isInteger(v);
    return `¥${v.toLocaleString("ja-JP", { minimumFractionDigits: isDecimal ? 2 : 0, maximumFractionDigits: 2 })}`;
  };

  const loadInvoice = useCallback((store: string, period: string) => {
    if (!store || !period) return;
    setErrorMsg("");
    startTransition(async () => {
      try {
        const [apika, maintenance, hirock, support, partner, others] = await Promise.all([
          fetchApikaRows(store, period),
          fetchMaintenanceRows(store, period),
          fetchHirockRows(store, period),
          fetchSupportRows(store, period),
          fetchPartnerInfo(store),
          fetchOtherItems(store, period),
        ]);
        setInvoiceData({ apika, maintenance, hirock, support });
        setPartnerInfo(partner);
        // 保存済みのその他請求項目があれば表示ON
        setOtherRows(others.map((o) => ({
          date: o.date,
          itemName: o.itemName,
          quantity: String(o.quantity),
          unitPrice: String(o.unitPrice),
          note: o.note,
        })));
        setOtherVisible(others.length > 0);
        setOtherDirty(false);
        setOtherMsg("");
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "データ取得に失敗しました");
      }
    });
  }, []);

  // 店名・期間が変わったら自動で再取得し、金額入力もリセット
  useEffect(() => {
    setMaintenancePrices({});
    setIncludeDisposalFee(true);
    setHirockManualRows([]);
    setMaintenanceManualRows([]);
    if (selectedStore && selectedPeriod) {
      loadInvoice(selectedStore, selectedPeriod);
    } else {
      setInvoiceData(null);
    }
  }, [selectedStore, selectedPeriod, hirockRefreshKey, loadInvoice]);

  // 液剤代：単価は 手動上書き > 店舗マスタ > APIKAシート の優先順
  const apikaRows = (invoiceData?.apika ?? []).map((r, i) => {
    const override = apikaPriceOverrides[i];
    const masterPrice = lookupLiquidPrice(master, r.itemName);
    let unitPrice = r.unitPrice;
    let source: "manual" | "master" | "sheet" = "sheet";
    if (override !== undefined && override !== "") {
      unitPrice = parseFloat(override) || 0;
      source = "manual";
    } else if (masterPrice !== null) {
      unitPrice = masterPrice;
      source = "master";
    }
    return { ...r, unitPrice, total: r.quantity * unitPrice, source };
  });
  const apikaTotal = apikaRows.reduce((s, r) => s + r.total, 0);
  const hirockTotal = invoiceData?.hirock.reduce((s, r) => s + r.total, 0) ?? 0;
  const supportTotal = invoiceData?.support.reduce((s, r) => s + r.total, 0) ?? 0;
  // 消耗品手動追加分の合計
  const hirockManualTotal = hirockManualRows.reduce((s, r) => {
    const qty = parseFloat(r.quantity) || 0;
    const unit = parseFloat(r.unitPrice) || 0;
    return s + qty * unit;
  }, 0);
  // 行ごとの金額の合計（スプレッドシート行 + 手動追加行）
  const maintenanceAmount = Object.values(maintenancePrices).reduce((s, v) => s + v, 0)
    + maintenanceManualRows.reduce((s, r) => s + (parseFloat(r.price) || 0), 0);
  // メンテナンスデータがある場合の部品処分費用
  const hasMaintenance = (invoiceData?.maintenance.length ?? 0) > 0 || maintenanceManualRows.length > 0;
  const disposalFeeAmount = hasMaintenance && includeDisposalFee ? DISPOSAL_FEE : 0;
  // メンテナンスデータがあるのに金額未入力（0）の行が1件でもある場合はCSV不可
  const hasMaintenanceUnfilled = (invoiceData?.maintenance ?? []).some((_, i) => (maintenancePrices[i] ?? 0) === 0)
    || maintenanceManualRows.some((r) => !r.price || parseFloat(r.price) === 0);
  // システム利用料：店舗マスタの値（未設定なら手動入力）
  const systemFee = parseFloat(systemFeeInput) || 0;
  const isSystemFeeUnfilled = systemFeeInput.trim() === "";
  // 定期メンテナンス：実施月のみ（3/6/9/12など）
  // 無償期間中は常に0円
  const regMaintAmount = regMaint.isTargetMonth && !regMaint.isFree ? parseFloat(regMaintInput) || 0 : 0;
  const showRegMaintLine = regMaint.isTargetMonth && (regMaint.isFree || regMaintAmount > 0);
  // ダイヤルパッド通信費：鹿児島中山店のみ¥3,000
  const dialpadFee = selectedStore.includes("鹿児島中山") ? 3000 : 0;
  // マイクロファイバー分割料金：高崎棟高店のみ
  const microfiberFee = isTakasaki ? MICROFIBER_FEE : 0;
  // その他請求項目（非表示のときは請求に含めない）
  const otherLines = otherVisible
    ? otherRows
        .filter((r) => r.itemName.trim())
        .map((r) => {
          const qty = parseFloat(r.quantity) || 0;
          const unit = parseFloat(r.unitPrice) || 0;
          return { date: r.date, itemName: r.itemName.trim(), qty, unit, amount: qty * unit, note: r.note };
        })
    : [];
  const otherTotal = otherLines.reduce((s, r) => s + r.amount, 0);
  const grandTotal = apikaTotal + (hirockTotal + hirockManualTotal) + maintenanceAmount + disposalFeeAmount + regMaintAmount + supportTotal + systemFee + dialpadFee + microfiberFee + otherTotal + royaltyAmountExTax;

  async function handleSaveOther() {
    if (!selectedStore || !selectedPeriod) return;
    const items: OtherItem[] = otherRows
      .filter((r) => r.itemName.trim())
      .map((r) => ({
        date: r.date,
        itemName: r.itemName.trim(),
        quantity: parseFloat(r.quantity) || 0,
        unitPrice: parseFloat(r.unitPrice) || 0,
        note: r.note,
      }));
    setOtherSaving(true);
    setOtherMsg("保存中...");
    try {
      const n = await saveOtherItems(selectedStore, selectedPeriod, items);
      setOtherDirty(false);
      setOtherMsg(n > 0 ? `${n} 件を保存しました。` : "保存しました（項目なし）。");
    } catch (e) {
      setOtherMsg(e instanceof Error ? e.message : "保存に失敗しました。");
    } finally {
      setOtherSaving(false);
    }
  }

  async function handleSaveSupport() {
    if (!selectedStore || !selectedPeriod) return;
    const valid = supportEntries.filter((e) => e.date && e.hours && e.unitPrice);
    if (valid.length === 0) { setSupportMsg("入力内容を確認してください。"); return; }
    setSupportSaving(true);
    setSupportMsg("保存中...");
    try {
      const rows: SupportRow[] = valid.map((e) => {
        const hours = parseFloat(e.hours) || 0;
        const unit = parseFloat(e.unitPrice) || 0;
        return { date: e.date, storeName: selectedStore, itemName: e.itemName || "現場応援", hours, unitPrice: unit, total: hours * unit };
      });
      await appendSupportRows(rows);
      setSupportMsg(`${rows.length} 件を保存しました。`);
      setSupportEntries([emptySupportEntry()]);
      loadInvoice(selectedStore, selectedPeriod);
    } catch (e) {
      setSupportMsg(e instanceof Error ? e.message : "保存に失敗しました。");
    } finally {
      setSupportSaving(false);
    }
  }

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
    // 日付文字列をYYYY/MM/DD形式に統一（ハイフン区切りをスラッシュに変換）
    const normalizeDate = (s: string) => s.replace(/-/g, "/");
    // 支払期限：新前橋店は請求日（先月末）の翌々月15日、他は今月末日
    // 例）請求日2026/06/30 → 2026/08/15
    const isShimmae = selectedStore.includes("新前橋");
    const dueDate = isShimmae
      ? fmtDate(new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth() + 2, 15))
      : fmtDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));

    // ---- 全明細行を収集（カテゴリー見出し行 + 明細行） ----
    type DetailRow = { date: string; name: string; qty: number; unitPrice: number; amount: number; isHeader?: boolean; detail?: string };
    const details: DetailRow[] = [];

    // 1. 液剤代セクション
    if (apikaRows.length > 0) {
      details.push({ date: "", name: "【液剤代】", qty: 0, unitPrice: 0, amount: 0, isHeader: true });
      apikaRows.forEach((r) => details.push({ date: normalizeDate(r.date), name: r.itemName, qty: r.quantity, unitPrice: r.unitPrice, amount: r.total }));
    }

    // 2. 消耗品セクション（スプレッドシート + 手動追加）
    if (d.hirock.length > 0 || hirockManualRows.length > 0) {
      details.push({ date: "", name: "【消耗品】", qty: 0, unitPrice: 0, amount: 0, isHeader: true });
      d.hirock.forEach((r) => details.push({ date: normalizeDate(r.date), name: r.itemName, qty: r.quantity, unitPrice: r.unitPrice, amount: r.total }));
      hirockManualRows.forEach((r) => {
        const qty = parseFloat(r.quantity) || 0;
        const unit = parseFloat(r.unitPrice) || 0;
        if (r.itemName && unit > 0) {
          details.push({ date: normalizeDate(r.date), name: r.itemName, qty, unitPrice: unit, amount: qty * unit });
        }
      });
    }

    // 3. メンテナンスセクション（スプレッドシート + 手動追加）
    const hasAnyMaintenance = d.maintenance.length > 0 || maintenanceManualRows.length > 0;
    if (hasAnyMaintenance) {
      details.push({ date: "", name: "【メンテナンス】", qty: 0, unitPrice: 0, amount: 0, isHeader: true });
      d.maintenance.forEach((r, i) => {
        const price = maintenancePrices[i] ?? 0;
        if (price > 0 || r.itemName) {
          // 備考があれば詳細カラムに格納（5点目）
          details.push({ date: normalizeDate(r.date), name: r.itemName, qty: r.quantity || 1, unitPrice: price, amount: price, detail: r.note ?? "" });
        }
      });
      maintenanceManualRows.forEach((r) => {
        const price = parseFloat(r.price) || 0;
        if (r.itemName && price > 0) {
          details.push({ date: normalizeDate(r.date), name: r.itemName, qty: parseFloat(r.quantity) || 1, unitPrice: price, amount: price, detail: r.note ?? "" });
        }
      });
      // 部品処分費用（チェックONの場合のみ追加）
      if (includeDisposalFee) {
        details.push({ date: billingDate, name: "部品処分費用", qty: 1, unitPrice: DISPOSAL_FEE, amount: DISPOSAL_FEE });
      }
    }

    // 3.5 定期メンテナンス（実施月のみ）
    if (showRegMaintLine) {
      details.push({ date: "", name: "【定期メンテナンス】", qty: 0, unitPrice: 0, amount: 0, isHeader: true });
      details.push({
        date: billingDate,
        name: "定期メンテナンス",
        qty: 1,
        unitPrice: regMaintAmount,
        amount: regMaintAmount,
        detail: regMaint.isFree ? `${FREE_MAINTENANCE_NOTE}（無償期間 ${regMaint.rangeLabel}）` : "",
      });
    }

    // 4. 現場応援セクション
    if (d.support.length > 0) {
      details.push({ date: "", name: "【現場応援】", qty: 0, unitPrice: 0, amount: 0, isHeader: true });
      d.support.forEach((r) => details.push({ date: normalizeDate(r.date), name: r.itemName, qty: r.hours, unitPrice: r.unitPrice, amount: r.total }));
    }

    // 5. システム利用料セクション
    details.push({ date: "", name: "【システム利用料】", qty: 0, unitPrice: 0, amount: 0, isHeader: true });
    details.push({ date: billingDate, name: "システム利用料", qty: 1, unitPrice: systemFee, amount: systemFee });
    if (dialpadFee > 0) {
      details.push({ date: billingDate, name: "ダイヤルパッド通信費", qty: 1, unitPrice: dialpadFee, amount: dialpadFee });
    }

    // 5.5 その他セクション（マイクロファイバー分割料金など）
    if (microfiberFee > 0) {
      details.push({ date: "", name: "【その他】", qty: 0, unitPrice: 0, amount: 0, isHeader: true });
      details.push({ date: billingDate, name: "マイクロファイバー分割料金", qty: 1, unitPrice: microfiberFee, amount: microfiberFee });
    }

    // 5.6 その他請求項目
    if (otherLines.length > 0) {
      details.push({ date: "", name: "【その他請求項目】", qty: 0, unitPrice: 0, amount: 0, isHeader: true });
      otherLines.forEach((r) =>
        details.push({ date: normalizeDate(r.date || billingDate), name: r.itemName, qty: r.qty, unitPrice: r.unit, amount: r.amount, detail: r.note })
      );
    }

    // 6. ロイヤリティセクション
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
    infoRow[0] = rowCount > 0 ? "40101" : "";  // A: csv_type (明細がある場合)
    infoRow[1] = "請求書";                       // B: 行形式
    infoRow[2] = p?.name ?? "";                  // C: 取引先名称
    // 件名: "2026年5月度" → "5月度請求について"
    const periodLabel = selectedPeriod.replace(/^\d{4}年/, "");
    infoRow[3] = `${periodLabel}請求について`;      // D: 件名
    infoRow[4] = billingDate;                    // E: 請求日（先月末）
    infoRow[5] = dueDate;                        // F: お支払期限（今月末）
    infoRow[10] = String(subtotal);               // K: 小計
    infoRow[11] = String(tax);                    // L: 消費税
    infoRow[12] = String(total);                  // M: 合計金額
    infoRow[13] = "御中";                          // N: 取引先敬称
    infoRow[14] = p?.zip ?? "";                 // O: 郵便番号
    infoRow[15] = p?.pref ?? "";                 // P: ��道府県
    infoRow[16] = p?.addr1 ?? "";                 // Q: 住所1
    infoRow[17] = p?.addr2 ?? "";                 // R: 住所2
    infoRow[18] = p?.dept ?? "";                 // S: 部署
    infoRow[19] = p?.title ?? "";                 // T: 担当者役職
    infoRow[20] = p?.contact ?? "";               // U: 担当者氏名
    infoRow[21] = "岡村昌輝";                      // V: 自社担当者氏名
    infoRow[22] = "誠に恐れ入りますが、振り込み手数料はご負担いただきますようお願いいたします。"; // W: 備考
    infoRow[23] = "埼玉縣信用金庫(金融機関コード：1250)\n新河岸支店(店番：045)\n普通口座　口座番号 9254883\n名義　ｶ)ｽﾌﾟﾗｯｼｭﾌﾞﾗｻﾞｰｽﾞ"; // X: 振込先

    // 3行目以降: 明細行（カテゴリー見出し行は品名のみ、明細行は各値を設定）
    const detailRows = details.map((det) => {
      const row = new Array(38).fill("");
      row[0] = "40101";  // A: csv_type
      row[1] = "品目";    // B: 行形式
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

    const apikaPrintRows = apikaRows.map((r) => `
      <tr>
        <td>${r.date}</td>
        <td>${r.itemName}</td>
        <td style="text-align:right">${r.quantity}</td>
        <td style="text-align:right">${fmt(r.unitPrice)}</td>
        <td style="text-align:right">${fmt(r.total)}</td>
      </tr>`).join("");

    const esc = (v: string) =>
      v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const fmtUnitPrice = (v: number) => {
      const isDecimal = !Number.isInteger(v);
      return `¥${v.toLocaleString("ja-JP", { minimumFractionDigits: isDecimal ? 2 : 0, maximumFractionDigits: 2 })}`;
    };
    const hirockRows = d.hirock.map((r) => `
      <tr>
        <td>${r.date}</td>
        <td>${r.itemName}</td>
        <td style="text-align:right">${r.quantity}</td>
        <td style="text-align:right">${fmtUnitPrice(r.unitPrice)}</td>
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
  ${apikaRows.length === 0 ? '<p class="no-data">該当データなし</p>' : `
  <table>
    <thead><tr><th>日付</th><th>品名</th><th class="num">数量</th><th class="num">単価</th><th class="num">合計</th></tr></thead>
    <tbody>${apikaPrintRows}</tbody>
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
${showRegMaintLine ? `<div class="section">
  <div class="section-title">定期メンテナンス</div>
  <table>
    <thead><tr><th>項目</th><th>備考</th><th class="num">金額</th></tr></thead>
    <tbody><tr><td>定期メンテナンス</td><td>${regMaint.isFree ? `${FREE_MAINTENANCE_NOTE}<br/><span style="color:#64748b;">無償期間 ${regMaint.rangeLabel}</span>` : ""}</td><td class="num">${fmt(regMaintAmount)}</td></tr></tbody>
  </table>
</div>` : ""}
<div class="section">
  <div class="section-title">消耗品（HIROCK）</div>
  ${d.hirock.length === 0 ? '<p class="no-data">該当データなし</p>' : `
  <table>
    <thead><tr><th>日付</th><th>品目</th><th class="num">数量</th><th class="num">単価</th><th class="num">合計</th></tr></thead>
    <tbody>${hirockRows}</tbody>
    <tfoot><tr class="subtotal"><td colspan="4">小計</td><td class="num">${fmt(hirockTotal)}</td></tr></tfoot>
  </table>`}
</div>
${otherLines.length > 0 ? `<div class="section">
  <div class="section-title">その他請求項目</div>
  <table>
    <thead><tr><th>日付</th><th>項目名</th><th class="num">数量</th><th class="num">単価</th><th>備考</th><th class="num">合計</th></tr></thead>
    <tbody>${otherLines.map((r) => `
      <tr>
        <td>${esc(r.date)}</td>
        <td>${esc(r.itemName)}</td>
        <td class="num">${r.qty}</td>
        <td class="num">${fmt(r.unit)}</td>
        <td>${esc(r.note)}</td>
        <td class="num">${fmt(r.amount)}</td>
      </tr>`).join("")}</tbody>
    <tfoot><tr class="subtotal"><td colspan="5">小計</td><td class="num">${fmt(otherTotal)}</td></tr></tfoot>
  </table>
</div>` : ""}
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
  ${showRegMaintLine ? `<div class="summary-row"><span class="label">定期メンテナンス</span><span class="amount">${fmt(regMaintAmount)}</span></div>` : ""}
  <div class="summary-row"><span class="label">消耗品 小計</span><span class="amount">${fmt(hirockTotal)}</span></div>
  <div class="summary-row"><span class="label">システム利用料</span><span class="amount">${fmt(systemFee + dialpadFee)}</span></div>
  ${otherLines.length > 0 ? `<div class="summary-row"><span class="label">その他請求項目</span><span class="amount">${fmt(otherTotal)}</span></div>` : ""}
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
            <div className="flex flex-col items-end gap-1">
              <button
                onClick={handleCsvDownload}
                disabled={hasMaintenanceUnfilled || isSystemFeeUnfilled}
                title={hasMaintenanceUnfilled ? "メンテナンスの金額をすべて入力してください" : isSystemFeeUnfilled ? "システム利用料を入力してください" : undefined}
                className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                CSVダウンロード
              </button>
              {hasMaintenanceUnfilled && (
                <p className="text-xs text-red-500 font-medium">メンテナンスの金額をすべて入力してください</p>
              )}
              {isSystemFeeUnfilled && (
                <p className="text-xs text-red-500 font-medium">システム利用料を入力してください</p>
              )}
            </div>
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
          {/* 1. 液剤代 */}
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
                  {apikaRows.map((r, i) => (
                    <tr key={i} className={`border-b border-border ${i % 2 === 0 ? "bg-card" : "bg-muted/20"}`}>
                      <td className="px-4 py-2.5 text-foreground tabular-nums">{r.date}</td>
                      <td className="px-4 py-2.5 text-foreground">{r.itemName}</td>
                      <td className="px-4 py-2.5 text-right text-foreground tabular-nums">{r.quantity}</td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${
                              r.source === "master"
                                ? "bg-green-100 text-green-700"
                                : r.source === "manual"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {r.source === "master" ? "マスタ" : r.source === "manual" ? "手動" : "シート"}
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={apikaPriceOverrides[i] ?? String(r.unitPrice)}
                            onChange={(e) => setApikaPriceOverrides((prev) => ({ ...prev, [i]: e.target.value }))}
                            className="w-24 rounded border border-border bg-card px-2 py-1 text-right text-xs text-foreground tabular-nums focus:outline-none focus:ring-1 focus:ring-primary/20"
                          />
                          {apikaPriceOverrides[i] !== undefined && (
                            <button
                              onClick={() => setApikaPriceOverrides((prev) => { const n = { ...prev }; delete n[i]; return n; })}
                              className="text-[10px] text-muted-foreground underline hover:text-foreground whitespace-nowrap"
                              title="マスタ／シートの単価に戻す"
                            >
                              戻す
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-foreground tabular-nums">{fmtNum(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </InvoiceSection>

          {/* 2. 消耗品 HIROCK */}
          <InvoiceSection title="消耗品（HIROCK）" color="bg-orange-500" total={hirockTotal + hirockManualTotal} isEmpty={!invoiceData || (invoiceData.hirock.length === 0 && hirockManualRows.length === 0)}>
            {invoiceData && (
              <>
                {invoiceData.hirock.length > 0 && (
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
                {/* 手動追加行 */}
                {hirockManualRows.length > 0 && (
                  <table className="w-full text-xs border-t border-border">
                    <thead>
                      <tr className="border-b border-border bg-muted/60">
                        <th className="px-3 py-2 text-left text-muted-foreground font-semibold">日付</th>
                        <th className="px-3 py-2 text-left text-muted-foreground font-semibold">品目</th>
                        <th className="px-3 py-2 text-right text-muted-foreground font-semibold">数量</th>
                        <th className="px-3 py-2 text-right text-muted-foreground font-semibold">単価</th>
                        <th className="px-3 py-2 text-right text-muted-foreground font-semibold">合計</th>
                        <th className="px-3 py-2 text-center text-muted-foreground font-semibold">削除</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hirockManualRows.map((r, i) => {
                        const qty = parseFloat(r.quantity) || 0;
                        const unit = parseFloat(r.unitPrice) || 0;
                        return (
                          <tr key={i} className="border-b border-border bg-primary/5">
                            <td className="px-3 py-1.5"><input type="text" value={r.date} onChange={(e) => setHirockManualRows((p) => p.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} className="w-28 rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" placeholder="YYYY/MM/DD" /></td>
                            <td className="px-3 py-1.5"><input type="text" value={r.itemName} onChange={(e) => setHirockManualRows((p) => p.map((x, j) => j === i ? { ...x, itemName: e.target.value } : x))} className="w-full rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" placeholder="品目名" /></td>
                            <td className="px-3 py-1.5"><input type="number" min={0} value={r.quantity} onChange={(e) => setHirockManualRows((p) => p.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} className="w-20 rounded border border-border bg-card px-2 py-1 text-right text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" /></td>
                            <td className="px-3 py-1.5"><input type="number" min={0} value={r.unitPrice} onChange={(e) => setHirockManualRows((p) => p.map((x, j) => j === i ? { ...x, unitPrice: e.target.value } : x))} className="w-24 rounded border border-border bg-card px-2 py-1 text-right text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" placeholder="単価" /></td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{fmt(qty * unit)}</td>
                            <td className="px-3 py-1.5 text-center"><button onClick={() => setHirockManualRows((p) => p.filter((_, j) => j !== i))} className="text-red-500 text-xs border border-red-200 rounded px-2 py-0.5 hover:bg-red-50">削除</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <div className="px-4 py-2 border-t border-border">
                  <button onClick={() => setHirockManualRows((p) => [...p, emptyHirockRow()])} className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition">+ 手動で行を追加</button>
                </div>
              </>
            )}
          </InvoiceSection>

          {/* 3. メンテナンス */}
          <InvoiceSection
            title="メンテナンス"
            color="bg-blue-500"
            total={maintenanceAmount + disposalFeeAmount}
            isEmpty={!invoiceData || (invoiceData.maintenance.length === 0 && maintenanceManualRows.length === 0)}
            titleExtra={
              <a
                href="https://docs.google.com/spreadsheets/d/1eynNDQX-qPSKog67kU9RXKUpomc906QqwAAGzx4Sm-k/edit?usp=sharing"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary underline hover:opacity-75 transition ml-2"
              >
                部品価格表はこちら
              </a>
            }
          >
            {invoiceData && (
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
                  {invoiceData.maintenance.map((r, i) => {
                    const priceVal = maintenancePrices[i] ?? 0;
                    const isEmpty = priceVal === 0;
                    return (
                      <tr key={i} className={`border-b border-border ${isEmpty ? "bg-red-50" : i % 2 === 0 ? "bg-card" : "bg-muted/20"}`}>
                        <td className="px-4 py-2.5 text-foreground tabular-nums">{r.date}</td>
                        <td className="px-4 py-2.5 text-foreground">{r.itemName}</td>
                        <td className="px-4 py-2.5 text-right text-foreground tabular-nums">{r.quantity}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{r.note}</td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <input
                              type="number"
                              min={0}
                              value={priceVal === 0 ? "" : priceVal}
                              onChange={(e) =>
                                setMaintenancePrices((prev) => ({
                                  ...prev,
                                  [i]: Math.max(0, parseInt(e.target.value) || 0),
                                }))
                              }
                              className={`w-28 rounded border px-2 py-1 text-right text-xs text-foreground focus:outline-none focus:ring-1 tabular-nums ${isEmpty ? "border-red-400 bg-red-50 focus:ring-red-300" : "border-border bg-card focus:border-primary focus:ring-primary/20"}`}
                              placeholder="金額を入力"
                              required
                            />
                            {isEmpty && (
                              <span className="text-xs text-red-500 font-medium">金額の入力が必要です</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {/* 手動追加行 */}
                  {maintenanceManualRows.map((r, i) => {
                    const priceVal = parseFloat(r.price) || 0;
                    const isEmpty = priceVal === 0;
                    return (
                      <tr key={`manual-${i}`} className={`border-b border-border ${isEmpty ? "bg-red-50" : "bg-primary/5"}`}>
                        <td className="px-2 py-1.5"><input type="text" value={r.date} onChange={(e) => setMaintenanceManualRows((p) => p.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} className="w-28 rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" placeholder="YYYY/MM/DD" /></td>
                        <td className="px-2 py-1.5"><input type="text" value={r.itemName} onChange={(e) => setMaintenanceManualRows((p) => p.map((x, j) => j === i ? { ...x, itemName: e.target.value } : x))} className="w-full rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" placeholder="品名" /></td>
                        <td className="px-2 py-1.5"><input type="number" min={0} value={r.quantity} onChange={(e) => setMaintenanceManualRows((p) => p.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} className="w-20 rounded border border-border bg-card px-2 py-1 text-right text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" /></td>
                        <td className="px-2 py-1.5 flex gap-1">
                          <input type="text" value={r.note} onChange={(e) => setMaintenanceManualRows((p) => p.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} className="w-full rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" placeholder="備考" />
                          <button onClick={() => setMaintenanceManualRows((p) => p.filter((_, j) => j !== i))} className="text-red-500 text-xs border border-red-200 rounded px-2 py-0.5 hover:bg-red-50 whitespace-nowrap">削除</button>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <input type="number" min={0} value={r.price} onChange={(e) => setMaintenanceManualRows((p) => p.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} className={`w-28 rounded border px-2 py-1 text-right text-xs text-foreground focus:outline-none focus:ring-1 tabular-nums ${isEmpty ? "border-red-400 bg-red-50 focus:ring-red-300" : "border-border bg-card focus:border-primary focus:ring-primary/20"}`} placeholder="金額を入力" />
                            {isEmpty && <span className="text-xs text-red-500 font-medium">金額の入力が必要です</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* 部品処分費用行 */}
                <tbody>
                  <tr className={`border-b border-border ${includeDisposalFee ? "bg-card" : "bg-muted/30"}`}>
                    <td className="px-4 py-2.5 text-foreground tabular-nums text-xs"></td>
                    <td className="px-4 py-2.5 text-foreground text-xs font-medium">部品処分費用</td>
                    <td className="px-4 py-2.5 text-right text-foreground tabular-nums text-xs">1</td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs"></td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <span className={`text-xs tabular-nums font-semibold ${includeDisposalFee ? "text-foreground" : "text-muted-foreground line-through"}`}>
                          {fmt(DISPOSAL_FEE)}
                        </span>
                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={includeDisposalFee}
                            onChange={(e) => setIncludeDisposalFee(e.target.checked)}
                            className="w-3.5 h-3.5 rounded accent-primary cursor-pointer"
                          />
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {includeDisposalFee ? "含む" : "除外"}
                          </span>
                        </label>
                      </div>
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/40">
                    <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-foreground">合計</td>
                    <td className="px-4 py-2.5 text-right text-sm font-bold text-foreground tabular-nums">
                      {fmt(maintenanceAmount + disposalFeeAmount)}
                    </td>
                  </tr>
                </tfoot>
                <tbody>
                  <tr>
                    <td colSpan={5} className="px-4 py-2">
                      <button onClick={() => setMaintenanceManualRows((p) => [...p, emptyMaintenanceRow()])} className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition">+ 手動で行を追加</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </InvoiceSection>

          {/* 3.5 定期メンテナンス（実施月のみ表示） */}
          {regMaint.isTargetMonth && (
            <InvoiceSection title="定期メンテナンス" color="bg-sky-500" total={regMaintAmount} isEmpty={false}>
              <div className="p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-foreground">定期メンテナンス</span>
                    {regMaint.isFree ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">無償期間中</span>
                    ) : regMaint.defaultAmount !== null ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">マスタ</span>
                    ) : (
                      <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">マスタ未設定</span>
                    )}
                  </div>
                  {regMaint.isFree ? (
                    <span className="font-bold text-foreground tabular-nums">{fmt(0)}</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      value={regMaintInput}
                      onChange={(e) => setRegMaintInput(e.target.value)}
                      className="w-32 rounded border border-border bg-card px-2 py-1 text-right text-sm text-foreground tabular-nums focus:outline-none focus:ring-1 focus:ring-primary/20"
                      placeholder="金額を入力"
                    />
                  )}
                </div>
                {regMaint.isFree ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <p className="text-sm font-medium text-emerald-800">{FREE_MAINTENANCE_NOTE}</p>
                    <p className="text-xs text-emerald-700 mt-0.5">無償期間 {regMaint.rangeLabel}</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">実施月のため表示しています。請求しない場合は空欄（または0）のままにしてください。</p>
                )}
              </div>
            </InvoiceSection>
          )}

          {/* 4. 現場応援 */}
          <InvoiceSection title="現場応援" color="bg-orange-500" total={supportTotal} isEmpty={false}>
            {/* 保存済みデータ表示 */}
            {invoiceData && invoiceData.support.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-4 py-2 text-left font-semibold text-muted-foreground">日付</th>
                    <th className="px-4 py-2 text-left font-semibold text-muted-foreground">項目名</th>
                    <th className="px-4 py-2 text-right font-semibold text-muted-foreground">時間</th>
                    <th className="px-4 py-2 text-right font-semibold text-muted-foreground">単価</th>
                    <th className="px-4 py-2 text-right font-semibold text-muted-foreground">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceData.support.map((r, i) => (
                    <tr key={i} className={`border-b border-border ${i % 2 === 0 ? "bg-card" : "bg-muted/20"}`}>
                      <td className="px-4 py-2.5 text-foreground tabular-nums">{r.date}</td>
                      <td className="px-4 py-2.5 text-foreground">{r.itemName}</td>
                      <td className="px-4 py-2.5 text-right text-foreground tabular-nums">{r.hours}</td>
                      <td className="px-4 py-2.5 text-right text-foreground tabular-nums">{fmt(r.unitPrice)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-foreground tabular-nums">{fmt(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* 入力フォーム */}
            <div className="p-4 space-y-3 border-t border-border">
              <p className="text-xs font-semibold text-muted-foreground">新規追加</p>
              {supportEntries.map((entry, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-5 items-end">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground">日付</label>
                    <input type="date" value={entry.date}
                      onChange={(e) => setSupportEntries((prev) => prev.map((r, j) => j === i ? { ...r, date: e.target.value } : r))}
                      className="rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground">項目名</label>
                    <input type="text" value={entry.itemName}
                      onChange={(e) => setSupportEntries((prev) => prev.map((r, j) => j === i ? { ...r, itemName: e.target.value } : r))}
                      className="rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground">時間</label>
                    <input type="number" min={0} step={0.5} value={entry.hours}
                      onChange={(e) => setSupportEntries((prev) => prev.map((r, j) => j === i ? { ...r, hours: e.target.value } : r))}
                      className="rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground">単価</label>
                    <input type="number" min={0} value={entry.unitPrice}
                      onChange={(e) => setSupportEntries((prev) => prev.map((r, j) => j === i ? { ...r, unitPrice: e.target.value } : r))}
                      className="rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground">合計</label>
                    <div className="rounded border border-border bg-muted px-2 py-1.5 text-xs text-foreground tabular-nums">
                      {fmt((parseFloat(entry.hours) || 0) * (parseFloat(entry.unitPrice) || 0))}
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <button onClick={() => setSupportEntries((prev) => [...prev, emptySupportEntry()])}
                  className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition">
                  + 行を追加
                </button>
                <button onClick={handleSaveSupport} disabled={supportSaving}
                  className="rounded bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition disabled:opacity-50">
                  {supportSaving ? "保存中..." : "スプレッドシートに保存"}
                </button>
                {supportMsg && <span className="text-xs text-muted-foreground">{supportMsg}</span>}
              </div>
            </div>
          </InvoiceSection>

          {/* 5. システム利用料 */}
          <InvoiceSection title="システム利用料" color="bg-slate-500" total={systemFee + dialpadFee} isEmpty={false}>
            <div className={`p-4 flex justify-between items-center ${dialpadFee > 0 ? "border-b border-border" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground">システム利用料（月額）</span>
                {masterSystemFee !== null ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">マスタ</span>
                ) : (
                  <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">マスタ未設定</span>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <input
                  type="number"
                  min={0}
                  value={systemFeeInput}
                  onChange={(e) => setSystemFeeInput(e.target.value)}
                  className={`w-32 rounded border px-2 py-1 text-right text-sm text-foreground tabular-nums focus:outline-none focus:ring-1 ${isSystemFeeUnfilled ? "border-red-400 bg-red-50 focus:ring-red-300" : "border-border bg-card focus:ring-primary/20"}`}
                  placeholder="金額を入力"
                />
                {isSystemFeeUnfilled && <span className="text-xs text-red-500 font-medium">金額の入力が必要です</span>}
              </div>
            </div>
            {dialpadFee > 0 && (
              <div className="p-4 flex justify-between items-center">
                <span className="text-sm text-foreground">ダイヤルパッド通信費</span>
                <span className="font-bold text-foreground tabular-nums">{fmt(dialpadFee)}</span>
              </div>
            )}
          </InvoiceSection>

          {/* 5.5 その他（高崎棟高店のみ表示） */}
          {microfiberFee > 0 && (
            <InvoiceSection title="その他" color="bg-amber-500" total={microfiberFee} isEmpty={false}>
              <div className="p-4 flex justify-between items-center">
                <span className="text-sm text-foreground">マイクロファイバー分割料金</span>
                <span className="font-bold text-foreground tabular-nums">{fmt(microfiberFee)}</span>
              </div>
            </InvoiceSection>
          )}

          {/* 5.6 その他請求項目（全店舗・表示/非表示切替） */}
          <InvoiceSection
            title="その他請求項目"
            color="bg-teal-500"
            total={otherVisible ? otherTotal : undefined}
            isEmpty={false}
            titleExtra={
              <label className="ml-3 flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={otherVisible}
                  onChange={(e) => {
                    setOtherVisible(e.target.checked);
                    if (e.target.checked && otherRows.length === 0) setOtherRows([emptyOtherRow()]);
                  }}
                  className="w-3.5 h-3.5 rounded accent-primary cursor-pointer"
                />
                <span className="text-xs text-muted-foreground">{otherVisible ? "表示中（請求に含む）" : "非表示（請求に含めない）"}</span>
              </label>
            }
          >
            {otherVisible ? (
              <div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted">
                      <th className="px-3 py-2 text-left text-muted-foreground font-semibold">日付</th>
                      <th className="px-3 py-2 text-left text-muted-foreground font-semibold">項目名</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-semibold">数量</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-semibold">単価</th>
                      <th className="px-3 py-2 text-left text-muted-foreground font-semibold">備考</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-semibold">合計</th>
                      <th className="px-3 py-2 text-center text-muted-foreground font-semibold">削除</th>
                    </tr>
                  </thead>
                  <tbody>
                    {otherRows.map((r, i) => {
                      const qty = parseFloat(r.quantity) || 0;
                      const unit = parseFloat(r.unitPrice) || 0;
                      const set = (patch: Partial<typeof r>) => updateOtherRows((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                      return (
                        <tr key={i} className="border-b border-border">
                          <td className="px-3 py-1.5"><input type="date" value={r.date.replace(/\//g, "-")} onChange={(e) => set({ date: e.target.value.replace(/-/g, "/") })} className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" /></td>
                          <td className="px-3 py-1.5"><input type="text" value={r.itemName} onChange={(e) => set({ itemName: e.target.value })} className="w-full rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" placeholder="項目名" /></td>
                          <td className="px-3 py-1.5"><input type="number" min={0} step="any" value={r.quantity} onChange={(e) => set({ quantity: e.target.value })} className="w-16 text-right rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" /></td>
                          <td className="px-3 py-1.5"><input type="number" min={0} value={r.unitPrice} onChange={(e) => set({ unitPrice: e.target.value })} className="w-24 text-right rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" placeholder="単価" /></td>
                          <td className="px-3 py-1.5"><input type="text" value={r.note} onChange={(e) => set({ note: e.target.value })} className="w-full rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/20" placeholder="備考" /></td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{fmt(qty * unit)}</td>
                          <td className="px-3 py-1.5 text-center"><button onClick={() => updateOtherRows((p) => p.filter((_, j) => j !== i))} className="text-red-500 text-xs border border-red-200 rounded px-2 py-0.5 hover:bg-red-50">削除</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-border">
                  <button onClick={() => updateOtherRows((p) => [...p, emptyOtherRow()])} className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition">+ 行を追加</button>
                  <button onClick={handleSaveOther} disabled={otherSaving} className="rounded bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition disabled:opacity-50">
                    {otherSaving ? "保存中..." : "スプレッドシートに保存"}
                  </button>
                  {otherDirty && !otherSaving && <span className="text-xs text-amber-600">未保存の変更があります</span>}
                  {otherMsg && <span className="text-xs text-muted-foreground">{otherMsg}</span>}
                </div>
              </div>
            ) : (
              <p className="px-5 py-4 text-xs text-muted-foreground">
                チェックを入れると、項目を自由に追加して請求に含められます。
                {otherRows.some((r) => r.itemName.trim()) && "（入力済みの項目がありますが、非表示のため請求には含まれません）"}
              </p>
            )}
          </InvoiceSection>

          {/* 6. ロイヤリティ */}
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
              <p className="text-xs text-muted-foreground mt-1">
                液剤代 + 消耗品 + メンテナンス{regMaintAmount > 0 ? " + 定期メンテナンス" : ""} + 現場応援 + システム利用料
                {dialpadFee > 0 ? " + ダイヤルパッド通信費" : ""}
                {microfiberFee > 0 ? " + その他" : ""}
                {otherTotal > 0 ? " + その他請求項目" : ""}
                {" + ロイヤリティ"}
              </p>
            </div>
            <p className="text-4xl font-bold text-foreground tabular-nums">{fmt(grandTotal)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function InvoiceSection({
  title, color, total, isEmpty, children, titleExtra,
}: {
  title: string;
  color: string;
  total?: number;
  isEmpty: boolean;
  children?: React.ReactNode;
  titleExtra?: React.ReactNode;
}) {
  const fmt = (v: number) => `¥${v.toLocaleString("ja-JP")}`;
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {titleExtra}
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
