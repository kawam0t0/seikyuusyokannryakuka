"use client";

import { useState, useEffect } from "react";
import { Settings } from "lucide-react";
import { fetchStoreNames } from "@/app/actions";
import { CockpitDashboard } from "@/components/cockpit-dashboard";
import { InvoiceDashboard } from "@/components/invoice-dashboard";
import { StoreMasterDialog } from "@/components/store-master-dialog";
import { fetchStoreMasters } from "@/app/master-actions";
import type { StoreMasterMap } from "@/lib/store-master";

type DashboardState = {
  selectedStore: string;
  selectedPeriod: string;
  royaltyAmountExTax: number;
  cashExTax: number;
  cashlessExTax: number;
  memberExTax: number;
};

export default function Page() {
  const [storeNames, setStoreNames] = useState<string[]>([]);
  const [dashboardState, setDashboardState] = useState<DashboardState>({
    selectedStore: "",
    selectedPeriod: "",
    royaltyAmountExTax: 0,
    cashExTax: 0,
    cashlessExTax: 0,
    memberExTax: 0,
  });

  const [masters, setMasters] = useState<StoreMasterMap>({});
  const [isMasterOpen, setIsMasterOpen] = useState(false);

  useEffect(() => {
    fetchStoreNames()
      .then(setStoreNames)
      .catch(() => setStoreNames([]));
    fetchStoreMasters()
      .then(setMasters)
      .catch(() => setMasters({}));
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-8 space-y-10">

        {/* ヘッダー（1つのみ） */}
        <header className="flex items-center justify-between gap-4 border-b border-border pb-6">
          <h1 className="text-4xl font-bold tracking-tight text-primary">SplashBrothers</h1>
          <button
            onClick={() => setIsMasterOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted transition"
          >
            <Settings className="w-4 h-4" />
            店舗マスタ
          </button>
        </header>

        <StoreMasterDialog
          open={isMasterOpen}
          onClose={() => setIsMasterOpen(false)}
          storeNames={storeNames}
          masters={masters}
          initialStore={dashboardState.selectedStore}
          onSaved={(m) => setMasters((prev) => ({ ...prev, [m.storeName]: m }))}
        />

        {/* 売上ダッシュボード */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-6">
            売上ダッシュボード
          </h2>
          <CockpitDashboard
            storeNames={storeNames}
            masters={masters}
            onStateChange={setDashboardState}
          />
        </section>

        <div className="h-px bg-border" />

        {/* 請求書 */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-6">
            請求書
          </h2>
          <InvoiceDashboard
            storeNames={storeNames}
            masters={masters}
            selectedStore={dashboardState.selectedStore}
            selectedPeriod={dashboardState.selectedPeriod}
            royaltyAmountExTax={dashboardState.royaltyAmountExTax}
            cashExTax={dashboardState.cashExTax}
            cashlessExTax={dashboardState.cashlessExTax}
            memberExTax={dashboardState.memberExTax}
          />
        </section>

      </div>
    </div>
  );
}
