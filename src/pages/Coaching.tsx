import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, CheckCircle2, Clock3, UserRound } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/Button";
import { apiFetch, ApiError } from "../lib/api";
import { primaryRole } from "../lib/roles";
import type { Coach, CoachingSession } from "../types";

const paymentMethods = ["CASH", "BANK_TRANSFER", "GCASH", "CARD", "ONLINE_PAYMENT"] as const;
const paymentLabel = (value: string) => ({ CASH: "Cash", BANK_TRANSFER: "Bank transfer", GCASH: "GCash", CARD: "Card", ONLINE_PAYMENT: "Online payment" }[value] ?? value);

function sessionTime(value: string) {
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function Coaching() {
  const { user } = useAuth();
  const role = primaryRole(user);
  const isCustomer = role === "CUSTOMER";
  const isCoach = role === "COACH";
  const client = useQueryClient();
  const [coachId, setCoachId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<typeof paymentMethods[number]>("GCASH");
  const [transactionReference, setTransactionReference] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const coaches = useQuery({ queryKey: ["coaches"], queryFn: () => apiFetch<{ coaches: Coach[] }>("/api/coaching/coaches"), enabled: isCustomer });
  const sessions = useQuery({ queryKey: ["coaching-sessions"], queryFn: () => apiFetch<{ sessions: CoachingSession[] }>("/api/coaching/sessions"), refetchInterval: 30_000 });
  const book = useMutation({ mutationFn: () => apiFetch<{ session: CoachingSession }>("/api/coaching/sessions", { method: "POST", body: JSON.stringify({ coachId, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), paymentMethod, transactionReference: transactionReference || undefined }) }), onSuccess: () => { client.invalidateQueries({ queryKey: ["coaching-sessions"] }); client.invalidateQueries({ queryKey: ["payments"] }); setStartsAt(""); setEndsAt(""); setTransactionReference(""); setMessage("Coaching session requested. The slot remains pending until staff verifies payment."); } });
  const update = useMutation({ mutationFn: ({ id, status, sessionNotes }: { id: string; status?: string; sessionNotes?: string }) => apiFetch(`/api/coaching/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ status, notes: sessionNotes }) }), onSuccess: () => { client.invalidateQueries({ queryKey: ["coaching-sessions"] }); setMessage("Coaching session updated."); } });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(""); setMessage("");
    if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) { setError("Choose a valid end time after the session start."); return; }
    try { await book.mutateAsync(); } catch (exception) { setError(exception instanceof ApiError ? exception.message : "Unable to book coaching session."); }
  }

  async function updateSession(id: string, status?: string) {
    setError(""); setMessage("");
    try { await update.mutateAsync({ id, status, sessionNotes: notes[id] }); } catch (exception) { setError(exception instanceof ApiError ? exception.message : "Unable to update coaching session."); }
  }

  const title = isCoach ? "My coaching schedule" : isCustomer ? "Coaching" : "Coaching schedule";
  const description = isCoach ? "Review assigned players, record notes, and complete your sessions." : isCustomer ? "Book a focused session with a Rally coach." : "Monitor customer sessions and help coaches keep schedules current.";
  const sessionRows = sessions.data?.sessions ?? [];

  return <div>
    <div><p className="text-sm font-bold uppercase tracking-[.18em] text-pine">{isCustomer ? "Improve your game" : isCoach ? "Coach workspace" : "Club operations"}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-ink/55">{description}</p></div>
    {message && <div className="mt-5 rounded-xl bg-lime/50 px-4 py-3 text-sm text-pine">{message}</div>}
    {error && <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

    {isCustomer && <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]"><div>{coaches.isLoading ? <div className="rounded-3xl bg-white p-8 text-center text-sm text-ink/50">Loading coaches…</div> : coaches.isError ? <div className="rounded-3xl bg-red-50 p-8 text-center text-sm text-red-700">Unable to load coaches.</div> : coaches.data?.coaches.length ? <div className="grid gap-4 md:grid-cols-2">{coaches.data.coaches.map((coach) => <article key={coach.id} className={`rounded-3xl bg-white p-6 shadow-sm ${coachId === coach.id ? "ring-2 ring-pine" : ""}`}><div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-full bg-lime text-pine"><UserRound /></div><div><h2 className="font-semibold">{coach.user.firstName} {coach.user.lastName}</h2><p className="text-sm text-ink/50">₱{coach.hourlyRate.toLocaleString()}/hour</p></div></div><p className="mt-5 text-sm leading-6 text-ink/60">{coach.biography}</p><p className="mt-3 text-xs text-ink/45">{coach.certifications}</p><Button className="mt-5 w-full" variant={coachId === coach.id ? "secondary" : "primary"} onClick={() => setCoachId(coach.id)}>{coachId === coach.id ? "Selected" : "Choose coach"}</Button></article>)}</div> : <div className="rounded-3xl bg-white p-8 text-center text-sm text-ink/50">No active coaches are available.</div>}</div>
      <form onSubmit={submit} className="h-fit rounded-3xl bg-pine p-6 text-white"><p className="text-sm text-white/60">Request a session</p><h2 className="mt-1 text-2xl font-semibold">Set your time</h2><label className="mt-6 block text-sm"><span className="text-white/70">Start</span><input className="mt-2 w-full rounded-xl border-0 bg-white/10 px-3 py-3 text-white outline-none" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label><label className="mt-4 block text-sm"><span className="text-white/70">End</span><input className="mt-2 w-full rounded-xl border-0 bg-white/10 px-3 py-3 text-white outline-none" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /></label><label className="mt-4 block text-sm"><span className="text-white/70">Payment method</span><select className="mt-2 w-full rounded-xl border-0 bg-white px-3 py-3 text-ink outline-none" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethods[number])}>{paymentMethods.map((method) => <option key={method} value={method}>{paymentLabel(method)}</option>)}</select></label><label className="mt-4 block text-sm"><span className="text-white/70">Payment reference (optional)</span><input className="mt-2 w-full rounded-xl border-0 bg-white/10 px-3 py-3 text-white outline-none placeholder:text-white/35" value={transactionReference} onChange={(event) => setTransactionReference(event.target.value)} placeholder="Receipt or transfer reference" /></label><p className="mt-4 text-xs leading-5 text-white/55">Your request creates a pending payment. Staff confirms the session only after verifying payment.</p><Button className="mt-5 w-full" variant="secondary" disabled={!coachId || book.isPending}>{book.isPending ? "Requesting…" : "Request coaching"}<CalendarPlus className="ml-2 inline" size={16} /></Button></form></div>}

    <section className="mt-8 rounded-3xl bg-white p-5 shadow-sm sm:p-6"><div className="flex items-center justify-between"><div><p className="text-sm text-ink/50">{isCustomer ? "Your sessions" : isCoach ? "Assigned sessions" : "Club sessions"}</p><h2 className="mt-1 text-xl font-semibold">Schedule</h2></div><Clock3 className="text-pine" size={20} /></div>
      {sessions.isLoading ? <div className="py-10 text-center text-sm text-ink/50">Loading coaching sessions…</div> : sessions.isError ? <div className="mt-5 rounded-2xl bg-red-50 p-6 text-center text-sm text-red-700">Unable to load the coaching schedule. <button type="button" className="font-semibold underline" onClick={() => void sessions.refetch()}>Try again</button></div> : sessionRows.length ? <div className="mt-5 space-y-4">{sessionRows.map((session) => <article key={session.id} className="rounded-2xl bg-sand p-4 sm:p-5"><div className="flex flex-col justify-between gap-3 md:flex-row md:items-start"><div><p className="font-semibold">{isCustomer ? `${session.coach.user.firstName} ${session.coach.user.lastName}` : `${session.customer.user.firstName} ${session.customer.user.lastName}`}</p><p className="mt-1 text-sm text-ink/50">{sessionTime(session.startsAt)}–{new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", timeStyle: "short" }).format(new Date(session.endsAt))} · ₱{session.rate.toLocaleString()}</p>{!isCustomer && <p className="mt-1 text-xs text-ink/40">{session.customer.user.email}</p>}</div><span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-bold text-pine"><CheckCircle2 className="mr-1 inline" size={14} />{session.status.replaceAll("_", " ")}</span></div>
          {!isCustomer && <><label className="mt-4 block text-xs font-semibold uppercase tracking-wider text-ink/45">Session notes<textarea className="mt-2 block w-full rounded-xl border border-black/10 bg-white px-3 py-3 text-sm font-normal normal-case tracking-normal outline-none" rows={2} value={notes[session.id] ?? session.notes ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [session.id]: event.target.value }))} placeholder="Progress, drills, and follow-up notes" /></label><div className="mt-3 flex flex-wrap gap-2"><Button className="px-3 py-2 text-xs" variant="ghost" disabled={update.isPending} onClick={() => void updateSession(session.id)}>Save notes</Button>{session.status === "PENDING" && <Button className="px-3 py-2 text-xs" disabled={update.isPending} onClick={() => void updateSession(session.id, "CONFIRMED")}>Confirm</Button>}{["PENDING", "CONFIRMED"].includes(session.status) && <Button className="px-3 py-2 text-xs" variant="ghost" disabled={update.isPending} onClick={() => void updateSession(session.id, "CANCELLED")}>Cancel</Button>}{session.status === "CONFIRMED" && <><Button className="px-3 py-2 text-xs" disabled={update.isPending} onClick={() => void updateSession(session.id, "COMPLETED")}>Mark completed</Button><Button className="px-3 py-2 text-xs" variant="ghost" disabled={update.isPending} onClick={() => void updateSession(session.id, "NO_SHOW")}>No show</Button></>}</div></>}
        </article>)}</div> : <div className="py-10 text-center text-sm text-ink/50">No coaching sessions found.</div>}
    </section>
  </div>;
}
