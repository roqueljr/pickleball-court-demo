import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronRight, Clock3, MailCheck, ShieldCheck, Tag } from "lucide-react";
import { cloneElement, useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { ApiError, apiFetch } from "../lib/api";
import type { Court } from "../types";

type Slot = { startTime: string; endTime: string; available: boolean };
type Availability = { slots: Slot[] };
type GuestQuote = {
  currency: string;
  baseHourlyRate: number;
  effectiveHourlyRate: number;
  pricingRule: { id: string; name: string; adjustmentPercent: number } | null;
  subtotal: number;
  promotion: { id: string; code: string; discountPercent: number | null; fixedDiscount: number | null; remainingUses: number | null; discount: number } | null;
  promotionDiscount: number;
  tax: number;
  total: number;
};

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const money = (value: number) => `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const timeLabel = (value: string) => new Date(`2026-01-01T${value}:00+08:00`).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });

export function GuestBooking() {
  const [contact, setContact] = useState({ firstName: "", lastName: "", email: "", phone: "", marketingConsent: false });
  const [selection, setSelection] = useState({ courtId: "", date: today(), durationMinutes: 60, startTime: "", paymentMethod: "GCASH", transactionReference: "" });
  const [leadId, setLeadId] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromoCode, setAppliedPromoCode] = useState("");
  const [promoError, setPromoError] = useState("");

  const courts = useQuery({ queryKey: ["guest-courts"], queryFn: () => apiFetch<{ courts: Court[] }>("/api/courts") });
  const availability = useQuery({
    queryKey: ["guest-availability", selection.courtId, selection.date, selection.durationMinutes],
    queryFn: () => apiFetch<Availability>(`/api/courts/${selection.courtId}/availability?date=${selection.date}&duration=${selection.durationMinutes}`),
    enabled: Boolean(selection.courtId && selection.date),
    refetchInterval: 10_000
  });
  const quoteUrl = (promoCode = "") => `/api/growth/guest/pricing/quote?courtId=${encodeURIComponent(selection.courtId)}&date=${selection.date}&startTime=${selection.startTime}&durationMinutes=${selection.durationMinutes}${promoCode ? `&promoCode=${encodeURIComponent(promoCode)}` : ""}`;
  const quote = useQuery({
    queryKey: ["guest-pricing-quote", selection.courtId, selection.date, selection.startTime, selection.durationMinutes, appliedPromoCode],
    queryFn: () => apiFetch<GuestQuote>(quoteUrl(appliedPromoCode)),
    enabled: Boolean(selection.courtId && selection.startTime && selection.date)
  });
  const promoValidation = useMutation({ mutationFn: (promoCode: string) => apiFetch<GuestQuote>(quoteUrl(promoCode)) });
  const selectedCourt = useMemo(() => courts.data?.courts.find((court) => court.id === selection.courtId), [courts.data, selection.courtId]);
  const selectedSlot = availability.data?.slots.find((slot) => slot.startTime === selection.startTime && slot.available);
  const requestCode = useMutation({
    mutationFn: () => apiFetch<{ leadId: string; message: string }>("/api/growth/guest/request-code", { method: "POST", body: JSON.stringify(contact) }),
    onSuccess: (data) => { setLeadId(data.leadId); setMessage(data.message); setError(""); },
    onError: (exception) => setError(exception instanceof ApiError ? exception.message : "Unable to send the guest code.")
  });
  const book = useMutation({
    mutationFn: () => apiFetch<{ booking: { reference: string; status: string }; accountCreated: boolean; message: string }>("/api/growth/guest/book", {
      method: "POST",
      body: JSON.stringify({ leadId, code, ...selection, promoCode: appliedPromoCode || undefined, marketingConsent: contact.marketingConsent })
    }),
    onSuccess: (data) => { setMessage(`${data.message} Reference: ${data.booking.reference}. Check your email to manage this request.`); setError(""); },
    onError: (exception) => setError(exception instanceof ApiError ? exception.message : "Unable to submit this booking request.")
  });

  const estimatedSubtotal = quote.data?.subtotal ?? (selectedCourt ? selectedCourt.hourlyRate * selection.durationMinutes / 60 : 0);
  const estimatedTax = quote.data?.tax ?? 0;
  const estimatedTotal = quote.data?.total ?? estimatedSubtotal;

  function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    requestCode.mutate();
  }

  async function applyPromotion() {
    const promoCode = promoInput.trim().toUpperCase();
    setPromoError("");
    if (!promoCode) { setPromoError("Enter a promotion code first."); return; }
    if (!selectedCourt || !selectedSlot) { setPromoError("Choose an available court time before applying a promotion."); return; }
    try {
      await promoValidation.mutateAsync(promoCode);
      setPromoInput(promoCode);
      setAppliedPromoCode(promoCode);
    } catch (exception) {
      setPromoError(exception instanceof ApiError ? exception.message : "Unable to validate this promotion code.");
    }
  }

  function removePromotion() {
    setPromoInput("");
    setAppliedPromoCode("");
    setPromoError("");
  }

  function submitBooking() {
    setMessage("");
    setError("");
    if (!selectedCourt || !selectedSlot) { setError("Choose an available court time first."); return; }
    if (promoInput.trim() && !appliedPromoCode) {
      setPromoError("Select Apply to validate this promotion code before submitting.");
      setError("Apply or clear the promotion code before continuing.");
      return;
    }
    if (quote.isError) { setError("Remove the promotion code or choose booking details that qualify for it."); return; }
    if (!/^\d{6}$/.test(code)) { setError("Enter the 6-digit code sent to your email."); return; }
    if (selection.transactionReference.trim().length < 3) { setError("Enter your payment transaction reference."); return; }
    book.mutate();
  }

  return <main className="bg-sand px-5 py-12 lg:px-8">
    <div className="mx-auto max-w-6xl">
      <div className="max-w-3xl">
        <p className="text-sm font-bold uppercase tracking-[.18em] text-pine">No account required</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Reserve your first court as a guest.</h1>
        <p className="mt-4 text-lg leading-8 text-ink/55">Verify your email, apply an eligible promotion, submit a payment reference, and the club will confirm your booking. We create a secure player account only after your email code is accepted.</p>
      </div>
      {error && <div className="mt-6 flex gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle size={17} />{error}</div>}
      {message && <div className="mt-6 flex gap-2 rounded-xl bg-lime/50 px-4 py-3 text-sm text-pine"><CheckCircle2 size={17} />{message}</div>}

      <div className="mt-8 grid gap-6 lg:grid-cols-[.8fr_1.2fr]">
        <form className="h-fit rounded-3xl bg-white p-6 shadow-sm" onSubmit={sendCode}>
          <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-lime text-pine"><MailCheck size={20} /></div><div><h2 className="text-xl font-semibold">1. Verify your details</h2><p className="text-xs text-ink/45">Code expires after 10 minutes</p></div></div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Field label="First name"><input value={contact.firstName} onChange={(event) => setContact({ ...contact, firstName: event.target.value })} required /></Field>
            <Field label="Last name"><input value={contact.lastName} onChange={(event) => setContact({ ...contact, lastName: event.target.value })} required /></Field>
            <Field label="Email" wide><input type="email" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} required /></Field>
            <Field label="Phone" wide><input value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} required /></Field>
          </div>
          <label className="mt-4 flex items-start gap-2 text-xs leading-5 text-ink/55"><input className="mt-1" type="checkbox" checked={contact.marketingConsent} onChange={(event) => setContact({ ...contact, marketingConsent: event.target.checked })} />Send me relevant open-play and club offers. Optional.</label>
          <Button className="mt-5 w-full" disabled={requestCode.isPending}>{requestCode.isPending ? "Sending code…" : leadId ? "Send a fresh code" : "Email my verification code"}</Button>
          <p className="mt-4 text-center text-xs text-ink/40">Already a member? <Link className="font-semibold text-pine" to="/login">Sign in</Link></p>
        </form>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-lime text-pine"><Clock3 size={20} /></div><div><h2 className="text-xl font-semibold">2. Choose and pay</h2><p className="text-xs text-ink/45">Live court availability and pricing</p></div></div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Field label="Court"><select value={selection.courtId} onChange={(event) => setSelection({ ...selection, courtId: event.target.value, startTime: "" })}><option value="">Choose court</option>{courts.data?.courts.filter((court) => court.status === "AVAILABLE").map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select></Field>
            <Field label="Date"><input type="date" min={today()} value={selection.date} onChange={(event) => setSelection({ ...selection, date: event.target.value, startTime: "" })} /></Field>
            <Field label="Duration"><select value={selection.durationMinutes} onChange={(event) => setSelection({ ...selection, durationMinutes: Number(event.target.value), startTime: "" })}><option value="60">1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option><option value="180">3 hours</option></select></Field>
          </div>

          <div className="mt-5">
            <p className="text-sm font-semibold">Available times</p>
            {!selection.courtId ? <State text="Choose a court first." /> : availability.isLoading ? <State text="Checking live availability…" /> : <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">{availability.data?.slots.map((slot) => <button type="button" key={slot.startTime} disabled={!slot.available} onClick={() => setSelection({ ...selection, startTime: slot.startTime })} className={`rounded-xl px-2 py-3 text-sm font-semibold ${!slot.available ? "bg-black/[.04] text-ink/25" : selection.startTime === slot.startTime ? "bg-pine text-white" : "bg-lime/50 text-pine"}`}>{timeLabel(slot.startTime)}<span className="block text-[10px] font-normal opacity-70">{slot.available ? `to ${timeLabel(slot.endTime)}` : "Unavailable"}</span></button>)}</div>}
          </div>

          <div className="mt-6 rounded-2xl border border-black/5 bg-sand p-4">
            <label htmlFor="guest-promo" className="text-sm font-semibold"><Tag className="mr-1.5 inline text-pine" size={15} />Promotion code (optional)</label>
            <div className="mt-2 flex gap-2"><input id="guest-promo" value={promoInput} disabled={Boolean(appliedPromoCode)} onChange={(event) => { setPromoInput(event.target.value.toUpperCase()); setPromoError(""); }} placeholder="e.g. PICKLE10" className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-pine disabled:opacity-60" /><Button type="button" variant="secondary" disabled={!selectedSlot || promoValidation.isPending} onClick={() => appliedPromoCode ? removePromotion() : void applyPromotion()}>{promoValidation.isPending ? "Checking…" : appliedPromoCode ? "Remove" : "Apply"}</Button></div>
            {quote.data?.promotion && appliedPromoCode && !quote.isError && <p className="mt-3 rounded-xl bg-lime/60 px-3 py-2 text-xs font-semibold text-pine"><CheckCircle2 className="mr-1 inline" size={14} />{quote.data.promotion.code} applied · You save {money(quote.data.promotion.discount)}{quote.data.promotion.remainingUses !== null ? ` · ${quote.data.promotion.remainingUses} uses remaining` : ""}</p>}
            {promoError && <p className="mt-2 text-xs text-red-700"><AlertCircle className="mr-1 inline" size={14} />{promoError}</p>}
            {appliedPromoCode && quote.isError && <p className="mt-2 text-xs text-red-700"><AlertCircle className="mr-1 inline" size={14} />{quote.error instanceof ApiError ? quote.error.message : "This promotion no longer applies to the selected booking."}</p>}
            <p className="mt-2 text-xs leading-5 text-ink/45">Apply the code to preview its exact discount before submitting.</p>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Field label="Payment method"><select value={selection.paymentMethod} onChange={(event) => setSelection({ ...selection, paymentMethod: event.target.value })}><option value="GCASH">GCash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CARD">Card</option><option value="ONLINE_PAYMENT">Online payment</option></select></Field>
            <Field label="Transaction reference"><input value={selection.transactionReference} onChange={(event) => setSelection({ ...selection, transactionReference: event.target.value })} placeholder="Required" /></Field>
            <Field label="Email code" wide><input inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="6 digits" /></Field>
          </div>

          <div className="mt-5 space-y-2 rounded-xl bg-sand p-4 text-sm">
            <div className="flex justify-between"><span className="text-ink/50">Court price</span><strong>{selectedCourt ? money(estimatedSubtotal) : "—"}</strong></div>
            {quote.data?.pricingRule && <div className="flex justify-between text-pine"><span>{quote.data.pricingRule.name}</span><strong>{quote.data.pricingRule.adjustmentPercent > 0 ? "+" : ""}{quote.data.pricingRule.adjustmentPercent}%</strong></div>}
            {quote.data?.promotion && <div className="flex justify-between text-pine"><span>{quote.data.promotion.code} promotion</span><strong>−{money(quote.data.promotionDiscount)}</strong></div>}
            <div className="flex justify-between"><span className="text-ink/50">Tax</span><strong>{selectedCourt ? money(estimatedTax) : "—"}</strong></div>
            <div className="flex justify-between border-t border-black/5 pt-2 text-base"><span className="font-semibold">Estimated total</span><strong>{selectedCourt ? money(estimatedTotal) : "—"}</strong></div>
            <p className="pt-1 text-xs leading-5 text-ink/45">The server rechecks this amount during booking. Any active membership attached to a verified existing account is applied securely at final checkout.</p>
          </div>
          <Button type="button" className="mt-5 flex w-full items-center justify-center gap-1" disabled={!leadId || !selectedSlot || Boolean(promoInput.trim() && !appliedPromoCode) || quote.isFetching || quote.isError || book.isPending} onClick={submitBooking}>{book.isPending ? "Submitting…" : "Submit guest booking"}<ChevronRight size={16} /></Button>
          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-ink/45"><ShieldCheck className="mt-0.5 shrink-0 text-pine" size={15} />The final database transaction rechecks availability and the promotion usage limit, preventing simultaneous double booking or over-redemption.</p>
        </section>
      </div>
    </div>
  </main>;
}

function Field({ label, children, wide = false }: { label: string; children: ReactElement<{ className?: string }>; wide?: boolean }) {
  return <label className={`text-sm font-medium ${wide ? "sm:col-span-full" : ""}`}>{label}{cloneElement(children, { className: `mt-1.5 min-h-11 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-pine ${children.props.className ?? ""}` })}</label>;
}

function State({ text }: { text: string }) {
  return <div className="mt-3 rounded-xl bg-sand p-6 text-center text-sm text-ink/45">{text}</div>;
}
