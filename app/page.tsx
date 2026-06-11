"use client";

import { useState, useEffect } from "react";
import { fetchStoreNames } from "@/app/actions";
import { CockpitDashboard } from "@/components/cockpit-dashboard";
import { InvoiceDashboard } from "@/components/invoice-dashboard";

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

  useEffect(() => {
    fetchStoreNames()
      .then(setStoreNames)
      .catch(() => setStoreNames([]));
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-8 space-y-10">

        {/* ヘッダー（1つのみ） */}
        <header className="border-b border-border pb-6">
          <h1 className="text-4xl font-bold tracking-tight text-primary">SplashBrothers</h1>
        </header>

        {/* 売上ダッシュボード */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-6">
            売上ダッシュボード
          </h2>
          <CockpitDashboard
            storeNames={storeNames}
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
