import { useEffect, useState } from "react";
import { getDashboard, type DashboardResponse } from "../api/client";
import { AlertTriangleIcon, CheckCircleIcon, TagIcon } from "../components/icons";

export interface DashboardPageProps {
  shopId: string;
}

function trustScoreTone(percent: number): { text: string; ring: string } {
  if (percent >= 90) return { text: "text-emerald-700", ring: "border-emerald-200 bg-emerald-50" };
  if (percent >= 70) return { text: "text-amber-700", ring: "border-amber-200 bg-amber-50" };
  return { text: "text-rose-700", ring: "border-rose-200 bg-rose-50" };
}

/**
 * Owner-facing rollups (Phase 3 of the "complete product" roadmap) — a
 * thin read-only view over GET /dashboard (dashboardQuery.ts). Server
 * enforces owner/manager-only access independently (authContext.ts's
 * canViewDashboard); App.tsx only rendering this link for those roles is
 * a UX nicety, not the actual security boundary.
 */
export function DashboardPage({ shopId }: DashboardPageProps) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDashboard(shopId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <p className="text-sm text-rose-600">Couldn't load the dashboard. Check the connection and try again.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  const tone = trustScoreTone(data.trust_score.percent);

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="mb-4 text-xl font-bold text-slate-900">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Total revenue</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">₹{data.revenue.total.toLocaleString()}</p>
          <p className="mt-1 text-xs text-slate-500">{data.revenue.order_count} orders · ₹{data.revenue.average_order_value} avg</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Last 7 days</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">₹{data.revenue.last_7_days.toLocaleString()}</p>
        </div>

        <div className={`rounded-xl border p-4 ${tone.ring}`}>
          <p className="text-xs font-medium text-slate-500">Trust score</p>
          <p className={`mt-1 flex items-center gap-1.5 text-2xl font-bold ${tone.text}`}>
            <CheckCircleIcon className="h-5 w-5" />
            {data.trust_score.percent}%
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {data.trust_score.items_with_open_conflict} of {data.trust_score.total_items} items have an open conflict
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <AlertTriangleIcon className="h-4 w-4 text-amber-500" />
          Low stock
        </h2>
        {data.low_stock.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nothing running low right now.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {data.low_stock.map((item) => (
              <li key={item.item_id} className="flex items-center justify-between py-2 text-sm">
                <span className="flex items-center gap-1.5 text-slate-800">
                  <TagIcon className="h-3.5 w-3.5 text-slate-400" />
                  {item.name ?? item.item_id}
                </span>
                <span className={item.stock === 0 ? "font-semibold text-rose-600" : "text-amber-600"}>
                  {item.stock} left
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
