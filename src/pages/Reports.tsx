import { useQuery } from "@tanstack/react-query";
import { BarChart3, CircleDollarSign, Clock3, Download, TrendingDown, TrendingUp } from "lucide-react";
import { apiFetch } from "../lib/api";
import type { ReportSummary } from "../types";
import { useState } from "react";

function money(value: number, currency = "PHP") {
  try { return new Intl.NumberFormat("en-PH", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function Reports() {
  const [period, setPeriod] = useState("MONTH");
  const [customFrom, setCustomFrom] = useState(new Date().toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(new Date().toISOString().slice(0, 10));
  const current = new Date();
  const from = period === "TODAY" ? new Date(current.getFullYear(), current.getMonth(), current.getDate()) : period === "WEEK" ? new Date(current.getFullYear(), current.getMonth(), current.getDate() - 6) : period === "YEAR" ? new Date(current.getFullYear(), 0, 1) : period === "CUSTOM" ? new Date(`${customFrom}T00:00:00+08:00`) : new Date(current.getFullYear(), current.getMonth(), 1);
  const to = period === "CUSTOM" ? new Date(`${customTo}T23:59:59.999+08:00`) : current;
  const query = useQuery({
    queryKey: ["reports", "summary", period, customFrom, customTo],
    queryFn: () => apiFetch<ReportSummary>(`/api/reports/summary?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
    enabled: !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from <= to
  });
  const summary = query.data;
  const revenueSources = summary ? [
    { label: "Court bookings", value: summary.revenue.bookings },
    { label: "Memberships", value: summary.revenue.memberships },
    { label: "Coaching", value: summary.revenue.coaching },
    { label: "POS sales", value: summary.revenue.pos },
    { label: "Equipment rentals", value: summary.revenue.rentals },
    { label: "Packages, leagues, open play & wallet", value: summary.revenue.packages + summary.revenue.openPlay + summary.revenue.leagues + summary.revenue.walletTopUps + summary.revenue.other }
  ] : [];

  return <div>
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="text-sm font-bold uppercase tracking-[.18em] text-pine">Finance & analytics</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-2 text-ink/55">Live revenue, refunds, expenses, profit, bookings, and court utilization for the selected period.</p>
      </div>
      <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-ink/70" onClick={() => window.print()}>
        <Download size={16} /> Print report
      </button>
    </div>

    <div className="mt-6 rounded-2xl bg-white p-4 shadow-sm"><div className="flex flex-wrap gap-2">{[["TODAY", "Today"], ["WEEK", "Last 7 days"], ["MONTH", "This month"], ["YEAR", "This year"], ["CUSTOM", "Custom"]].map(([value, label]) => <button key={value} type="button" onClick={() => setPeriod(value)} className={`rounded-xl px-3 py-2 text-sm font-semibold ${period === value ? "bg-pine text-white" : "bg-sand text-ink/60"}`}>{label}</button>)}</div>{period === "CUSTOM" && <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">From<input className="mt-1.5 w-full rounded-xl border border-black/10 px-3 py-3" type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><label className="text-sm font-medium">To<input className="mt-1.5 w-full rounded-xl border border-black/10 px-3 py-3" type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}<p className="mt-3 text-xs text-ink/45">Reporting period: {from.toLocaleDateString("en-PH")}–{to.toLocaleDateString("en-PH")}</p></div>

    {query.isLoading && <div className="mt-8 rounded-3xl bg-white p-10 text-center text-sm text-ink/50 shadow-sm">Loading report…</div>}
    {query.isError && <div className="mt-8 rounded-3xl bg-white p-10 text-center shadow-sm"><p className="text-lg font-semibold">Unable to load reports</p><p className="mt-2 text-sm text-ink/50">{query.error instanceof Error ? query.error.message : "Please try again."}</p><button type="button" className="mt-5 rounded-xl bg-pine px-4 py-3 text-sm font-semibold text-white" onClick={() => void query.refetch()}>Try again</button></div>}
    {!query.isLoading && !query.isError && summary && <>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Revenue", value: money(summary.revenue.total, summary.currency), note: "Income net of recorded refunds", icon: CircleDollarSign },
          { label: "Expenses", value: money(summary.expenses, summary.currency), note: "Recorded operating costs", icon: TrendingDown },
          { label: "Net profit", value: money(summary.netProfit, summary.currency), note: "Revenue less expenses", icon: TrendingUp },
          { label: "Bookings", value: String(summary.bookingCount), note: "Bookings in this period", icon: BarChart3 }
        ].map(({ label, value, note, icon: Icon }) => <div key={label} className="rounded-2xl bg-white p-5 shadow-sm"><div className="flex items-center justify-between text-sm text-ink/55"><span>{label}</span><Icon className="text-pine" size={19} /></div><p className="mt-5 truncate text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-ink/45">{note}</p></div>)}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between"><div><p className="text-sm text-ink/50">Revenue breakdown</p><h2 className="mt-1 text-xl font-semibold">Where revenue comes from</h2></div><CircleDollarSign className="text-pine" size={21} /></div>
          <div className="mt-6 space-y-5">{revenueSources.map(({ label, value }) => <div key={label}><div className="flex justify-between gap-3 text-sm"><span>{label}</span><span className="font-semibold">{money(value, summary.currency)}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-sand"><div className="h-full rounded-full bg-pine" style={{ width: `${summary.revenue.total > 0 ? Math.min(100, Math.max(0, value) / summary.revenue.total * 100) : 0}%` }} /></div></div>)}</div>
          {summary.revenue.total === 0 && <p className="mt-5 rounded-xl bg-sand px-4 py-3 text-sm text-ink/50">No paid revenue recorded for this period.</p>}
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between"><div><p className="text-sm text-ink/50">Booking activity</p><h2 className="mt-1 text-xl font-semibold">Status breakdown</h2></div><BarChart3 className="text-pine" size={21} /></div>
          {summary.bookingStatuses.length ? <div className="mt-6 space-y-3">{summary.bookingStatuses.map((row) => <div key={row.status} className="flex items-center justify-between rounded-xl bg-sand px-4 py-3"><span className="text-sm">{formatStatus(row.status)}</span><span className="font-semibold">{row._count._all}</span></div>)}</div> : <p className="mt-6 rounded-xl bg-sand px-4 py-3 text-sm text-ink/50">No bookings recorded for this period.</p>}
        </section>
      </div>

      <section className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between"><div><p className="text-sm text-ink/50">Court utilization</p><h2 className="mt-1 text-xl font-semibold">Booked versus available hours</h2></div><Clock3 className="text-pine" size={21} /></div>
        {summary.courtHours.length ? <div className="mt-6 grid gap-5 md:grid-cols-2">{summary.courtHours.map((court) => <div key={court.court}><div className="flex justify-between gap-3 text-sm"><span>{court.court}</span><span className="font-semibold">{court.utilizationPercent.toFixed(1)}%</span></div><p className="mt-1 text-xs text-ink/45">{court.bookedHours.toFixed(1)} booked / {court.availableHours.toFixed(1)} available hours</p><div className="mt-2 h-3 overflow-hidden rounded-full bg-sand"><div className="h-full rounded-full bg-lime" style={{ width: `${court.utilizationPercent}%` }} /></div></div>)}</div> : <p className="mt-6 rounded-xl bg-sand px-4 py-3 text-sm text-ink/50">No courts are configured.</p>}
      </section>
    </>}
  </div>;
}
