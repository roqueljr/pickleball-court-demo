import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Tag, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/Button";
import { ApiError, apiFetch } from "../lib/api";
import type { Court, MembershipPlan, Promotion } from "../types";

type FormState = {
  code: string;
  discountPercent: string;
  fixedDiscount: string;
  usageLimit: string;
  minimumPurchase: string;
  startDate: string;
  endDate: string;
  applicableCourtIds: string[];
  applicablePlanIds: string[];
};

const emptyForm: FormState = { code: "", discountPercent: "", fixedDiscount: "", usageLimit: "", minimumPurchase: "0", startDate: "", endDate: "", applicableCourtIds: [], applicablePlanIds: [] };
const localDate = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));

function formFor(promotion: Promotion): FormState {
  return {
    code: promotion.code,
    discountPercent: promotion.discountPercent === null ? "" : String(promotion.discountPercent),
    fixedDiscount: promotion.fixedDiscount === null ? "" : String(promotion.fixedDiscount),
    usageLimit: promotion.usageLimit === null ? "" : String(promotion.usageLimit),
    minimumPurchase: String(promotion.minimumPurchase),
    startDate: localDate(promotion.startDate),
    endDate: localDate(promotion.endDate),
    applicableCourtIds: promotion.applicableCourtIds,
    applicablePlanIds: promotion.applicablePlanIds
  };
}

function toggle(values: string[], id: string) {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}

export function Promotions() {
  const client = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const query = useQuery({ queryKey: ["promotions"], queryFn: () => apiFetch<{ promotions: Promotion[] }>("/api/promotions") });
  const courts = useQuery({ queryKey: ["courts", "promotion-form"], queryFn: () => apiFetch<{ courts: Court[] }>("/api/courts") });
  const plans = useQuery({ queryKey: ["memberships", "plans", "promotion-form"], queryFn: () => apiFetch<{ plans: MembershipPlan[] }>("/api/memberships") });

  function payload() {
    return {
      code: form.code,
      discountPercent: form.discountPercent ? Number(form.discountPercent) : null,
      fixedDiscount: form.fixedDiscount ? Number(form.fixedDiscount) : null,
      usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
      minimumPurchase: Number(form.minimumPurchase),
      startDate: new Date(`${form.startDate}T00:00:00+08:00`).toISOString(),
      endDate: new Date(`${form.endDate}T23:59:59+08:00`).toISOString(),
      applicableCourtIds: form.applicableCourtIds,
      applicablePlanIds: form.applicablePlanIds
    };
  }

  const save = useMutation({
    mutationFn: () => apiFetch<{ promotion: Promotion }>(editing ? `/api/promotions/${editing.id}` : "/api/promotions", { method: editing ? "PUT" : "POST", body: JSON.stringify(payload()) }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ["promotions"] }); closeForm(); }
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/promotions/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["promotions"] })
  });

  function openCreate() { setEditing(null); setForm(emptyForm); setError(""); setFormOpen(true); }
  function openEdit(promotion: Promotion) { setEditing(promotion); setForm(formFor(promotion)); setError(""); setFormOpen(true); }
  function closeForm() { setFormOpen(false); setEditing(null); setForm(emptyForm); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!form.discountPercent && !form.fixedDiscount) { setError("Enter either a percentage or fixed discount."); return; }
    try { await save.mutateAsync(); } catch (exception) { setError(exception instanceof ApiError ? exception.message : "Unable to save promotion."); }
  }
  async function deactivatePromotion(promotion: Promotion) {
    if (!window.confirm(`Deactivate ${promotion.code}? Customers will no longer be able to apply it.`)) return;
    setError("");
    try { await deactivate.mutateAsync(promotion.id); } catch (exception) { setError(exception instanceof ApiError ? exception.message : "Unable to deactivate promotion."); }
  }

  const courtNames = new Map(courts.data?.courts.map((court) => [court.id, court.name]));
  const planNames = new Map(plans.data?.plans.map((plan) => [plan.id, plan.name]));

  return <div>
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-bold uppercase tracking-[.18em] text-pine">Marketing</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Promotions</h1><p className="mt-2 text-ink/55">Create codes, control usage, and target specific courts or membership plans.</p></div><Button variant="secondary" onClick={openCreate}><Plus className="mr-1 inline" size={16} />New promotion</Button></div>
    {error && <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {query.isLoading ? <div className="mt-6 rounded-3xl bg-white p-10 text-center text-sm text-ink/50">Loading promotions…</div> : query.isError ? <div className="mt-6 rounded-3xl bg-red-50 p-10 text-center text-sm text-red-700">Unable to load promotions. <button className="font-semibold underline" onClick={() => void query.refetch()}>Try again</button></div> : query.data?.promotions.length ? <div className="mt-6 grid gap-4 md:grid-cols-2">{query.data.promotions.map((promotion) => {
      const courtScope = promotion.applicableCourtIds.length ? promotion.applicableCourtIds.map((id) => courtNames.get(id) ?? "Unknown court").join(", ") : "All courts";
      const planScope = promotion.applicablePlanIds.length ? promotion.applicablePlanIds.map((id) => planNames.get(id) ?? "Unknown plan").join(", ") : "All membership plans";
      return <article key={promotion.id} className="rounded-3xl bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-lime text-pine"><Tag size={19} /></div><div><p className="font-semibold">{promotion.code}</p><p className="text-sm text-ink/50">{promotion.discountPercent !== null ? `${promotion.discountPercent}% off` : `₱${promotion.fixedDiscount?.toLocaleString()} off`}</p></div></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${promotion.isActive ? "bg-lime/60 text-pine" : "bg-black/5 text-ink/40"}`}>{promotion.isActive ? "ACTIVE" : "INACTIVE"}</span></div><p className="mt-5 text-sm text-ink/60">{localDate(promotion.startDate)} – {localDate(promotion.endDate)}</p><p className="mt-2 text-xs text-ink/45">Used {promotion.usedCount}{promotion.usageLimit ? ` of ${promotion.usageLimit}` : ""} · Minimum ₱{promotion.minimumPurchase.toLocaleString()}</p><div className="mt-4 rounded-xl bg-sand p-3 text-xs leading-5 text-ink/55"><p><span className="font-semibold text-ink/70">Courts:</span> {courtScope}</p><p><span className="font-semibold text-ink/70">Plans:</span> {planScope}</p></div><div className="mt-5 flex gap-3"><button className="text-sm font-semibold text-pine" onClick={() => openEdit(promotion)}><Pencil className="mr-1 inline" size={14} />Edit</button>{promotion.isActive && <button className="text-sm font-semibold text-red-600" onClick={() => void deactivatePromotion(promotion)}>Deactivate</button>}</div></article>;
    })}</div> : <div className="mt-6 rounded-3xl bg-white p-10 text-center text-sm text-ink/50">No promotions yet. Create a code when your first campaign is ready.</div>}

    {formOpen && <div className="fixed inset-0 z-40 grid place-items-center bg-ink/30 px-5"><form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-3xl bg-white p-6 shadow-soft"><div className="flex items-center justify-between"><div><p className="text-sm font-bold uppercase tracking-[.16em] text-pine">Campaign setup</p><h2 className="mt-1 text-xl font-semibold">{editing ? `Edit ${editing.code}` : "New promotion"}</h2></div><button type="button" aria-label="Close promotion form" onClick={closeForm}><X /></button></div>{error && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}<div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Code<input className="mt-1.5 w-full rounded-xl border border-black/10 px-3 py-3 uppercase" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} required /></label><label className="text-sm font-medium">Usage limit (optional)<input className="mt-1.5 w-full rounded-xl border border-black/10 px-3 py-3" type="number" min="1" value={form.usageLimit} onChange={(event) => setForm({ ...form, usageLimit: event.target.value })} /></label><label className="text-sm font-medium">Discount percent<input className="mt-1.5 w-full rounded-xl border border-black/10 px-3 py-3" type="number" min="0" max="100" step="0.01" value={form.discountPercent} onChange={(event) => setForm({ ...form, discountPercent: event.target.value, ...(event.target.value ? { fixedDiscount: "" } : {}) })} /></label><label className="text-sm font-medium">Fixed discount<input className="mt-1.5 w-full rounded-xl border border-black/10 px-3 py-3" type="number" min="0" step="0.01" value={form.fixedDiscount} onChange={(event) => setForm({ ...form, fixedDiscount: event.target.value, ...(event.target.value ? { discountPercent: "" } : {}) })} /></label><label className="text-sm font-medium">Minimum purchase<input className="mt-1.5 w-full rounded-xl border border-black/10 px-3 py-3" type="number" min="0" step="0.01" value={form.minimumPurchase} onChange={(event) => setForm({ ...form, minimumPurchase: event.target.value })} required /></label><span /><label className="text-sm font-medium">Starts<input className="mt-1.5 w-full rounded-xl border border-black/10 px-3 py-3" type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} required /></label><label className="text-sm font-medium">Ends<input className="mt-1.5 w-full rounded-xl border border-black/10 px-3 py-3" type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} required /></label></div><div className="mt-6 grid gap-5 sm:grid-cols-2"><fieldset><legend className="text-sm font-semibold">Applicable courts</legend><p className="mt-1 text-xs text-ink/45">Leave all unchecked to allow every court.</p><div className="mt-3 max-h-40 space-y-2 overflow-y-auto rounded-xl border border-black/10 p-3">{courts.data?.courts.map((court) => <label key={court.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.applicableCourtIds.includes(court.id)} onChange={() => setForm({ ...form, applicableCourtIds: toggle(form.applicableCourtIds, court.id) })} />{court.name}</label>)}</div></fieldset><fieldset><legend className="text-sm font-semibold">Applicable membership plans</legend><p className="mt-1 text-xs text-ink/45">Leave all unchecked to allow every plan.</p><div className="mt-3 max-h-40 space-y-2 overflow-y-auto rounded-xl border border-black/10 p-3">{plans.data?.plans.map((plan) => <label key={plan.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.applicablePlanIds.includes(plan.id)} onChange={() => setForm({ ...form, applicablePlanIds: toggle(form.applicablePlanIds, plan.id) })} />{plan.name}</label>)}</div></fieldset></div><div className="mt-6 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={closeForm}>Cancel</Button><Button disabled={save.isPending}>{save.isPending ? "Saving…" : editing ? "Save changes" : "Create promotion"}</Button></div></form></div>}
  </div>;
}
