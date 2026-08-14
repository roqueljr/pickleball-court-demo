import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronRight, Clock3, Coins, CreditCard, Crown, PackageCheck, RefreshCw, Tag, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/Button";
import { ApiError, apiFetch } from "../lib/api";
import type { Court, Customer } from "../types";

type SlotReason = "BOOKED" | "BLOCKED" | "TOO_SOON" | "COURT_UNAVAILABLE" | null;
type ConflictPeriod = { startTime: string; endTime: string; type: "BOOKING" | "SCHEDULE" };
type Slot = { startTime: string; endTime: string; available: boolean; reason: SlotReason; conflictPeriod: ConflictPeriod | null };
type Availability = { slots: Slot[]; court: Court; generatedAt: string; occupiedPeriods: { startTime: string; endTime: string }[] };
type BookingSettings = {
  currency: string;
  taxRate: number;
  minimumBookingMinutes: number;
  maximumBookingMinutes: number;
  minimumAdvanceMinutes: number;
  maximumAdvanceDays: number;
  slotIntervalMinutes: number;
};
type PricingQuote = {
  currency: string;
  baseHourlyRate: number;
  effectiveHourlyRate: number;
  pricingRule: { id: string; name: string; adjustmentPercent: number } | null;
  subtotal: number;
  membership: { id: string; plan: { name: string; discountPercent: number } } | null;
  membershipDiscount: number;
  promotion: { id: string; code: string; discountPercent: number | null; fixedDiscount: number | null; minimumPurchase: number; remainingUses: number | null; discount: number } | null;
  promotionDiscount: number;
  discount: number;
  tax: number;
  total: number;
  walletBalance: number;
  packages: { id: string; creditsRemaining: number; expiresAt: string; packagePlan: { id: string; name: string } }[];
};

const paymentMethods = [
  { value: "CASH", label: "Cash at the club" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "GCASH", label: "GCash" },
  { value: "CARD", label: "Card" },
  { value: "ONLINE_PAYMENT", label: "Online payment" }
] as const;

function todayInManila() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function isValidDateInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00+08:00`).getTime());
}

function dateLabel(value: string) {
  if (!isValidDateInput(value)) return "Choose a valid date";
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00+08:00`));
}

function timeLabel(value: string) {
  const [hourValue, minutes] = value.split(":").map(Number);
  const suffix = hourValue >= 12 ? "PM" : "AM";
  const hour = hourValue % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function money(value: number) {
  return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function unavailableLabel(slot: Slot) {
  if (slot.reason === "BOOKED" && slot.conflictPeriod) return `Overlaps ${timeLabel(slot.conflictPeriod.startTime)}–${timeLabel(slot.conflictPeriod.endTime)}`;
  if (slot.reason === "BLOCKED" && slot.conflictPeriod) return `Blocked ${timeLabel(slot.conflictPeriod.startTime)}–${timeLabel(slot.conflictPeriod.endTime)}`;
  if (slot.reason === "BOOKED") return "Overlaps a reservation";
  if (slot.reason === "BLOCKED") return "Overlaps blocked time";
  if (slot.reason === "TOO_SOON") return "Too soon";
  if (slot.reason === "COURT_UNAVAILABLE") return "Closed";
  return "Unavailable";
}

export function BookCourt() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const isOperations = user?.roles.some((role) => ["SUPER_ADMIN", "ADMIN", "STAFF"].includes(role)) ?? false;
  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(todayInManila());
  const [courtId, setCourtId] = useState("");
  const [duration, setDuration] = useState(60);
  const [startTime, setStartTime] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromoCode, setAppliedPromoCode] = useState("");
  const [promoError, setPromoError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<typeof paymentMethods[number]["value"]>("CASH");
  const [transactionReference, setTransactionReference] = useState("");
  const [packagePurchaseId, setPackagePurchaseId] = useState("");
  const [walletAmount, setWalletAmount] = useState("0");
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [error, setError] = useState("");

  const courts = useQuery({ queryKey: ["courts"], queryFn: () => apiFetch<{ courts: Court[] }>("/api/courts") });
  const customers = useQuery({ queryKey: ["customers", "booking-form"], queryFn: () => apiFetch<{ customers: Customer[] }>("/api/customers"), enabled: isOperations });
  const bookingSettings = useQuery({ queryKey: ["booking-settings"], queryFn: () => apiFetch<BookingSettings>("/api/settings/booking") });
  const pricingQuoteUrl = (code = "") => `/api/growth/pricing/quote?courtId=${encodeURIComponent(courtId)}&date=${date}&startTime=${startTime}&durationMinutes=${duration}${isOperations && customerId ? `&customerId=${encodeURIComponent(customerId)}` : ""}${code ? `&promoCode=${encodeURIComponent(code)}` : ""}`;
  const availability = useQuery({
    queryKey: ["availability", courtId, date, duration],
    queryFn: () => apiFetch<Availability>(`/api/courts/${courtId}/availability?date=${date}&duration=${duration}`),
    enabled: Boolean(courtId && isValidDateInput(date)),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    staleTime: 0
  });
  const quote = useQuery({
    queryKey: ["booking-quote", courtId, date, startTime, duration, isOperations ? customerId : "me", appliedPromoCode],
    queryFn: () => apiFetch<PricingQuote>(pricingQuoteUrl(appliedPromoCode)),
    enabled: Boolean(courtId && startTime && isValidDateInput(date) && (!isOperations || customerId))
  });
  const promoValidation = useMutation({ mutationFn: (code: string) => apiFetch<PricingQuote>(pricingQuoteUrl(code)) });

  const selectedCourt = useMemo(() => courts.data?.courts.find((court) => court.id === courtId), [courts.data?.courts, courtId]);
  const selectedSlot = availability.data?.slots.find((slot) => slot.startTime === startTime && slot.available);
  const durationOptions = useMemo(() => {
    const minimum = bookingSettings.data?.minimumBookingMinutes ?? 60;
    const maximum = bookingSettings.data?.maximumBookingMinutes ?? 180;
    const interval = bookingSettings.data?.slotIntervalMinutes ?? 30;
    const options: number[] = [];
    for (let value = minimum; value <= maximum; value += interval) options.push(value);
    return options;
  }, [bookingSettings.data]);
  const maximumDate = addDays(todayInManila(), bookingSettings.data?.maximumAdvanceDays ?? 30);
  const basePrice = quote.data?.subtotal ?? (selectedCourt ? selectedCourt.hourlyRate * duration / 60 : 0);
  const activeMembership = quote.data?.membership ?? null;
  const membershipDiscount = quote.data?.membershipDiscount ?? 0;
  const promotionDiscount = quote.data?.promotionDiscount ?? 0;
  const discountedPrice = Math.max(0, basePrice - membershipDiscount);
  const estimatedTax = quote.data?.tax ?? discountedPrice * (bookingSettings.data?.taxRate ?? 0.12);
  const totalBeforeCredit = quote.data?.total ?? discountedPrice + estimatedTax;
  const selectedPackage = quote.data?.packages.find((purchase) => purchase.id === packagePurchaseId);
  const walletApplied = selectedPackage ? 0 : Math.min(Math.max(0, Number(walletAmount) || 0), quote.data?.walletBalance ?? 0, totalBeforeCredit);
  const estimatedTotal = selectedPackage ? 0 : Math.max(0, totalBeforeCredit - walletApplied);
  const availableCount = availability.data?.slots.filter((slot) => slot.available).length ?? 0;

  async function applyPromotion() {
    const code = promoInput.trim().toUpperCase();
    setPromoError("");
    if (!code) { setPromoError("Enter a promotion code first."); return; }
    if (!selectedCourt || !selectedSlot || (isOperations && !customerId)) { setPromoError("Choose a customer, court, and available time before applying a promotion."); return; }
    if (selectedPackage) { setPromoError("Remove the booking package before applying a promotion code."); return; }
    try {
      const preview = await promoValidation.mutateAsync(code);
      client.setQueryData(["booking-quote", courtId, date, startTime, duration, isOperations ? customerId : "me", code], preview);
      setPromoInput(code);
      setAppliedPromoCode(code);
    } catch (exception) {
      setPromoError(exception instanceof ApiError ? exception.message : "Unable to validate this promotion code.");
    }
  }

  function removePromotion() {
    setAppliedPromoCode("");
    setPromoInput("");
    setPromoError("");
  }

  function choosePackage(value: string) {
    setPackagePurchaseId(value);
    if (value) {
      setWalletAmount("0");
      if (appliedPromoCode) {
        setAppliedPromoCode("");
        setPromoInput("");
        setPromoError("Promotion removed because booking package credit covers this reservation.");
      }
    }
  }

  useEffect(() => {
    if (!courtId && courts.data?.courts) {
      const firstAvailableCourt = courts.data.courts.find((court) => court.status === "AVAILABLE");
      if (firstAvailableCourt) setCourtId(firstAvailableCourt.id);
    }
  }, [courtId, courts.data?.courts]);

  useEffect(() => {
    if (durationOptions.length > 0 && !durationOptions.includes(duration)) {
      setDuration(durationOptions[0]);
      setStartTime("");
    }
  }, [duration, durationOptions]);

  useEffect(() => {
    if (!startTime || !availability.data) return;
    const latestSlot = availability.data.slots.find((slot) => slot.startTime === startTime);
    if (!latestSlot?.available) {
      setStartTime("");
      setError("That time was just reserved or became unavailable. Please choose another available time.");
    }
  }, [availability.data, startTime]);

  useEffect(() => {
    if (packagePurchaseId && !quote.data?.packages.some((purchase) => purchase.id === packagePurchaseId)) setPackagePurchaseId("");
    const maximumWallet = quote.data?.walletBalance ?? 0;
    if (Number(walletAmount) > maximumWallet) setWalletAmount(String(maximumWallet));
  }, [packagePurchaseId, quote.data?.packages, quote.data?.walletBalance, walletAmount]);

  const create = useMutation({
    mutationFn: () => apiFetch<{ booking: { reference: string } }>("/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        customerId: isOperations ? customerId : undefined,
        courtId,
        date,
        startTime,
        durationMinutes: duration,
        promoCode: appliedPromoCode || undefined,
        paymentMethod,
        transactionReference: transactionReference || undefined,
        packagePurchaseId: packagePurchaseId || undefined,
        walletAmount: selectedPackage ? undefined : walletApplied || undefined
      })
    })
  });

  async function submit() {
    setError("");
    if (!isValidDateInput(date)) {
      setError("Choose a valid booking date before continuing.");
      return;
    }
    if (isOperations && !customerId) {
      setError("Select the customer who will use this booking.");
      return;
    }
    if (promoInput.trim() && !appliedPromoCode) {
      setPromoError("Select Apply to validate this promotion code before submitting the booking.");
      setError("Apply or clear the promotion code before continuing.");
      return;
    }
    if (!selectedCourt || !startTime) {
      setError("Choose an available court time before continuing.");
      return;
    }

    setCheckingAvailability(true);
    try {
      const refreshed = await availability.refetch();
      const latestSlot = refreshed.data?.slots.find((slot) => slot.startTime === startTime);
      if (!latestSlot?.available) {
        setStartTime("");
        setError("Another customer has already reserved that time. Availability has been refreshed—please choose another slot.");
        return;
      }

      await create.mutateAsync();
      await Promise.all([
        client.invalidateQueries({ queryKey: ["bookings"] }),
        client.invalidateQueries({ queryKey: ["availability", courtId, date] }),
        client.invalidateQueries({ queryKey: ["notifications"] }),
        client.invalidateQueries({ queryKey: ["growth-me"] })
      ]);
      navigate("/app/bookings");
    } catch (exception) {
      if (exception instanceof ApiError && exception.status === 409) {
        setStartTime("");
        await availability.refetch();
        setError("That time became unavailable before the booking was submitted. Please select another available time.");
      } else {
        setError(exception instanceof ApiError ? exception.message : "Unable to create booking.");
      }
    } finally {
      setCheckingAvailability(false);
    }
  }

  return <div className="mx-auto max-w-6xl">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
       <div><p className="text-sm font-bold uppercase tracking-[.18em] text-pine">{isOperations ? "Front-desk reservation" : "Reserve your time"}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{isOperations ? "Create a customer booking" : "Book a court"}</h1><p className="mt-2 text-ink/55">Occupied times are disabled automatically. Availability refreshes while you choose.</p></div>
      <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs text-ink/50 shadow-sm"><RefreshCw size={14} className={availability.isFetching ? "animate-spin text-pine" : "text-pine"} />Live availability · refreshes every 10 seconds</div>
    </div>
    {error && <div className="mt-6 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle className="mt-0.5 shrink-0" size={17} /><span>{error}</span></div>}

    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_380px]">
      <section className="space-y-6 rounded-3xl bg-white p-5 shadow-sm sm:p-6">
        {isOperations && <label className="block text-sm font-semibold">Customer
          <select value={customerId} onChange={(event) => { setCustomerId(event.target.value); setError(""); }} className="mt-2 block w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 outline-none focus:border-pine" required>
            <option value="">Select an active customer</option>
            {customers.data?.customers.filter((customer) => customer.status === "ACTIVE").map((customer) => <option key={customer.id} value={customer.id}>{customer.firstName} {customer.lastName} · {customer.email}{customer.membership ? ` · ${customer.membership.plan.name}` : ""}</option>)}
          </select>
          <span className="mt-2 block text-xs font-normal text-ink/45">The booking, payment, discount, QR code, and notifications will be assigned to this customer.</span>
        </label>}
        <label className="block text-sm font-semibold">1. Choose a date
          <input type="date" min={todayInManila()} max={maximumDate} value={date} onChange={(event) => { setDate(event.target.value); setStartTime(""); setError(""); }} className="mt-2 block w-full rounded-xl border border-black/10 px-3.5 py-3 outline-none focus:border-pine" />
          <span className="mt-2 block text-xs font-normal text-ink/45">Bookings are available up to {bookingSettings.data?.maximumAdvanceDays ?? 30} days ahead.</span>
        </label>

        <div><p className="text-sm font-semibold">2. Choose a court</p>
          {courts.isLoading ? <div className="mt-3 rounded-2xl bg-sand p-6 text-center text-sm text-ink/50">Loading courts…</div> : courts.isError ? <div className="mt-3 rounded-2xl bg-red-50 p-6 text-center text-sm text-red-700">Unable to load courts.</div> : <div className="mt-2 grid gap-3 sm:grid-cols-2">{courts.data?.courts.map((court) => {
            const unavailable = court.status !== "AVAILABLE";
            return <button key={court.id} type="button" disabled={unavailable} onClick={() => { setCourtId(court.id); setStartTime(""); setError(""); }} className={`rounded-2xl border p-4 text-left transition ${unavailable ? "cursor-not-allowed border-black/5 bg-black/[.025] text-ink/35" : courtId === court.id ? "border-pine bg-pine text-white" : "border-black/10 hover:border-pine"}`}>
              <div className="flex items-start justify-between gap-2"><p className="font-semibold">{court.name}</p>{unavailable && <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-bold text-red-700">{court.status}</span>}</div>
              <p className={`mt-1 text-xs ${courtId === court.id && !unavailable ? "text-white/70" : "text-ink/50"}`}>{court.indoor ? "Indoor" : "Open air"} · {money(court.hourlyRate)}/hr</p>
            </button>;
          })}</div>}
        </div>

        <label className="block text-sm font-semibold">3. Choose duration
          <select value={duration} onChange={(event) => { setDuration(Number(event.target.value)); setStartTime(""); setError(""); }} disabled={bookingSettings.isLoading} className="mt-2 block w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 outline-none focus:border-pine disabled:opacity-50">
            {durationOptions.map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} minutes` : minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${Math.floor(minutes / 60)} hour ${minutes % 60} minutes`}</option>)}
          </select>
          <span className="mt-2 block text-xs font-normal text-ink/45">Time choices below account for the full {duration}-minute reservation.</span>
        </label>

        <div>
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><p className="text-sm font-semibold">4. Choose a time</p><div className="flex flex-wrap items-center gap-3 text-xs text-ink/45"><span><Clock3 className="mr-1 inline" size={14} />{selectedCourt ? `${timeLabel(selectedCourt.openingTime)}–${timeLabel(selectedCourt.closingTime)}` : "Select a court"}</span>{courtId && !availability.isLoading && <span className="font-semibold text-pine">{availableCount} available</span>}</div></div>
          {!courtId ? <div className="mt-3 rounded-2xl bg-sand p-6 text-center text-sm text-ink/50">Select a court to see available times.</div> : availability.isLoading ? <div className="mt-3 rounded-2xl bg-sand p-6 text-center text-sm text-ink/50">Loading current availability…</div> : availability.isError ? <div className="mt-3 rounded-2xl bg-red-50 p-6 text-center text-sm text-red-700"><p>Unable to load availability.</p><button type="button" className="mt-2 font-semibold underline" onClick={() => void availability.refetch()}>Try again</button></div> : availability.data?.slots.length ? <>
            {availability.data.occupiedPeriods.length > 0 && <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Court occupied</p>
              <div className="mt-2 flex flex-wrap gap-2">{availability.data.occupiedPeriods.map((period) => <span key={`${period.startTime}-${period.endTime}`} className="rounded-full bg-white px-3 py-1 text-xs font-semibold shadow-sm">{timeLabel(period.startTime)}–{timeLabel(period.endTime)}</span>)}</div>
              <p className="mt-2 text-xs leading-5 text-amber-800">These are the exact reserved court hours. A start time before them is also disabled when your full {duration}-minute booking would overlap an occupied period.</p>
            </div>}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">{availability.data.slots.map((slot) => <button key={slot.startTime} type="button" disabled={!slot.available} onClick={() => { setStartTime(slot.startTime); setError(""); }} className={`min-h-16 rounded-xl px-2 py-2.5 text-sm font-semibold transition ${!slot.available ? "cursor-not-allowed border border-black/5 bg-black/[.035] text-ink/30" : startTime === slot.startTime ? "bg-pine text-white shadow-sm" : "bg-lime/50 text-pine hover:bg-lime"}`}>
              {timeLabel(slot.startTime)}<span className="mt-0.5 block text-[10px] font-normal leading-4 opacity-70">{slot.available ? `until ${timeLabel(slot.endTime)}` : unavailableLabel(slot)}</span>
            </button>)}</div>
            {availableCount === 0 && <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">No {duration}-minute times remain for this court and date. Try a shorter duration, another court, or another date.</div>}
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-ink/45"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-lime" />Available</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-black/10" />Reserved or unavailable</span></div>
          </> : <div className="mt-3 rounded-2xl bg-amber-50 p-6 text-center text-sm text-amber-800">No times fit the selected duration.</div>}
        </div>
      </section>

      <aside className="h-fit rounded-3xl bg-pine p-6 text-white lg:sticky lg:top-24">
        <div className="flex items-start justify-between gap-3"><div><p className="text-sm text-white/60">Booking summary</p><h2 className="mt-2 text-2xl font-semibold">{selectedCourt?.name ?? "Choose a court"}</h2></div>{selectedSlot && <CheckCircle2 className="text-lime" size={24} />}</div>
        <div className="mt-6 space-y-3 border-t border-white/15 pt-5 text-sm"><div className="flex justify-between gap-4"><span className="text-white/60">Date</span><span className="text-right">{dateLabel(date)}</span></div><div className="flex justify-between"><span className="text-white/60">Time</span><span>{selectedSlot ? `${timeLabel(selectedSlot.startTime)}–${timeLabel(selectedSlot.endTime)}` : "—"}</span></div><div className="flex justify-between"><span className="text-white/60">Duration</span><span>{duration} min</span></div><div className="flex justify-between"><span className="text-white/60">Court price</span><span>{selectedCourt ? money(basePrice) : "—"}</span></div>{quote.data?.pricingRule && <div className="flex items-center justify-between text-lime"><span><Zap className="mr-1 inline" size={15} />{quote.data.pricingRule.name}</span><span>{quote.data.pricingRule.adjustmentPercent > 0 ? "+" : ""}{quote.data.pricingRule.adjustmentPercent}%</span></div>}{activeMembership ? <><div className="flex items-center justify-between text-lime"><span><Crown className="mr-1 inline" size={15} />{activeMembership.plan.name} discount</span><span>−{money(membershipDiscount)}</span></div><div className="flex justify-between"><span className="text-white/60">After member discount</span><span>{money(discountedPrice)}</span></div></> : <div className="rounded-xl bg-white/10 px-3 py-2 text-xs text-white/65">No active membership discount applies on this booking date.</div>}{quote.data?.promotion && <div className="flex items-center justify-between text-lime"><span><Tag className="mr-1 inline" size={15} />{quote.data.promotion.code} promotion</span><span>−{money(promotionDiscount)}</span></div>}<div className="flex justify-between"><span className="text-white/60">Estimated tax</span><span>{selectedCourt ? money(estimatedTax) : "—"}</span></div>{selectedPackage && <div className="flex justify-between text-lime"><span>Package credit</span><span>−{money(totalBeforeCredit)}</span></div>}{walletApplied > 0 && <div className="flex justify-between text-lime"><span>Wallet credit</span><span>−{money(walletApplied)}</span></div>}<div className="flex justify-between border-t border-white/15 pt-3 text-base font-semibold"><span>Estimated total</span><span>{selectedCourt ? money(estimatedTotal) : "—"}</span></div></div>

        {quote.data && (quote.data.packages.length > 0 || quote.data.walletBalance > 0) && <div className="mt-5 rounded-2xl bg-white/10 p-4"><p className="text-sm font-semibold text-lime"><Coins className="mr-1 inline" size={16} />Club credit</p>{quote.data.packages.length > 0 && <label className="mt-3 block text-xs text-white/65"><PackageCheck className="mr-1 inline" size={14} />Booking package<select value={packagePurchaseId} onChange={(event) => choosePackage(event.target.value)} className="mt-2 w-full rounded-xl border-0 bg-white px-3 py-3 text-sm text-ink"><option value="">Do not use a package</option>{quote.data.packages.map((purchase) => <option key={purchase.id} value={purchase.id}>{purchase.packagePlan.name} · {purchase.creditsRemaining} credits left</option>)}</select></label>}{quote.data.walletBalance > 0 && !selectedPackage && <label className="mt-3 block text-xs text-white/65">Wallet amount · {money(quote.data.walletBalance)} available<input type="number" min="0" max={Math.min(quote.data.walletBalance, totalBeforeCredit)} step="0.01" value={walletAmount} onChange={(event) => setWalletAmount(event.target.value)} className="mt-2 w-full rounded-xl border-0 bg-white px-3 py-3 text-sm text-ink" /></label>}{estimatedTotal === 0 && <p className="mt-3 rounded-xl bg-lime px-3 py-2 text-xs font-semibold text-pine">Fully covered—this booking will confirm instantly and create its access pass.</p>}</div>}

        <div className="mt-6 text-sm"><label htmlFor="booking-promo" className="text-white/70"><Tag className="mr-1 inline" size={14} />Promo code (optional)</label><div className="mt-2 flex gap-2"><input id="booking-promo" value={promoInput} disabled={Boolean(appliedPromoCode)} onChange={(event) => { setPromoInput(event.target.value.toUpperCase()); setPromoError(""); }} placeholder="e.g. PICKLE10" className="min-w-0 flex-1 rounded-xl border-0 bg-white/10 px-3 py-3 text-white placeholder:text-white/35 outline-none focus:ring-2 focus:ring-lime disabled:opacity-70" /><Button type="button" variant="secondary" disabled={promoValidation.isPending || (!appliedPromoCode && Boolean(selectedPackage))} onClick={() => appliedPromoCode ? removePromotion() : void applyPromotion()}>{promoValidation.isPending ? "Checking…" : appliedPromoCode ? "Remove" : "Apply"}</Button></div>{quote.data?.promotion && appliedPromoCode && !quote.isError && <div className="mt-3 rounded-xl bg-lime px-3 py-2.5 text-xs font-semibold text-pine"><CheckCircle2 className="mr-1.5 inline" size={15} />{quote.data.promotion.code} applied · You save {money(quote.data.promotion.discount)}{quote.data.promotion.remainingUses !== null ? ` · ${quote.data.promotion.remainingUses} uses remaining` : ""}</div>}{promoError && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700"><AlertCircle className="mr-1 inline" size={14} />{promoError}</p>}{appliedPromoCode && quote.isError && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700"><AlertCircle className="mr-1 inline" size={14} />{quote.error instanceof ApiError ? quote.error.message : "This promotion no longer applies to the current booking choices."} Remove the code or update your booking choices.</p>}<span className="mt-2 block text-xs leading-5 text-white/50">Apply the code to preview the exact discount and final amount. It is checked again when the booking is submitted.</span></div>
        <label className="mt-5 block text-sm"><span className="text-white/70"><CreditCard className="mr-1 inline" size={14} />{estimatedTotal === 0 ? "Fallback payment method" : "Payment method"}</span><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethods[number]["value"])} className="mt-2 w-full rounded-xl border-0 bg-white/10 px-3 py-3 text-white outline-none focus:ring-2 focus:ring-lime">{paymentMethods.map((method) => <option key={method.value} value={method.value} className="text-ink">{method.label}</option>)}</select><span className="mt-2 block text-xs leading-5 text-white/50">{estimatedTotal === 0 ? "No payment confirmation is needed while club credit fully covers the booking." : "The booking remains pending until staff verifies payment."}</span></label>
        <label className="mt-4 block text-sm"><span className="text-white/70">Payment or receipt reference (optional)</span><input value={transactionReference} onChange={(event) => setTransactionReference(event.target.value)} placeholder={paymentMethod === "CASH" ? "Staff receipt number" : "Transfer or transaction reference"} className="mt-2 w-full rounded-xl border-0 bg-white/10 px-3 py-3 text-white placeholder:text-white/35 outline-none focus:ring-2 focus:ring-lime" /></label>
        <Button variant="secondary" className="mt-5 flex w-full items-center justify-center gap-2" disabled={(isOperations && !customerId) || !selectedCourt || !selectedSlot || Boolean(promoInput.trim() && !appliedPromoCode) || quote.isFetching || quote.isError || create.isPending || checkingAvailability || availability.isFetching} onClick={() => void submit()}>{checkingAvailability || create.isPending ? "Checking and submitting…" : estimatedTotal === 0 ? "Confirm with club credit" : isOperations ? "Create booking request" : "Submit booking request"}<ChevronRight size={17} /></Button>
        <p className="mt-4 text-xs leading-5 text-white/50"><CreditCard className="mr-1 inline" size={13} />Your slot is checked again before submission. The database also prevents simultaneous double bookings.</p>
      </aside>
    </div>
  </div>;
}
