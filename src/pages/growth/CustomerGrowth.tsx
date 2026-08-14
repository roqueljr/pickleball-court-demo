import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Coins, CreditCard, Gauge, PackageCheck, Trophy, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { apiFetch, ApiError } from "../../lib/api";
import type { Court, League, OpenPlay, PackagePlan, PackagePurchase, WaitlistEntry } from "../../types";
import { dateTime, money, paymentLabel, paymentMethods, Status } from "./shared";

type GrowthMe = {
  profile: { skillRating: number; duprId: string | null; walletBalance: number; marketingConsent: boolean };
  waitlist: WaitlistEntry[];
  participations: { id: string; status: string; amount: number; openPlay: OpenPlay; payment: { status: string } | null }[];
  walletTransactions: { id: string; type: string; amount: number; balanceAfter: number; description: string; createdAt: string }[];
  topUps: { id: string; amount: number; status: string; payment: { status: string } }[];
  packagePurchases: PackagePurchase[];
  leagueEntries: { id: string; status: string; league: League }[];
};

const initialWaitlist = { courtId: "", date: "", time: "", durationMinutes: "60" };

export function CustomerGrowth() {
  const client = useQueryClient();
  const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [method, setMethod] = useState<(typeof paymentMethods)[number]>("GCASH"); const [reference, setReference] = useState("");
  const [topUp, setTopUp] = useState("500"); const [waitlistForm, setWaitlistForm] = useState(initialWaitlist);
  const me = useQuery({ queryKey: ["growth-me"], queryFn: () => apiFetch<GrowthMe>("/api/growth/me") });
  const courts = useQuery({ queryKey: ["courts"], queryFn: () => apiFetch<{ courts: Court[] }>("/api/courts") });
  const openPlays = useQuery({ queryKey: ["open-plays"], queryFn: () => apiFetch<{ openPlays: OpenPlay[] }>("/api/growth/open-plays") });
  const packages = useQuery({ queryKey: ["package-plans"], queryFn: () => apiFetch<{ packages: PackagePlan[] }>("/api/growth/packages") });
  const leagues = useQuery({ queryKey: ["growth-leagues"], queryFn: () => apiFetch<{ leagues: League[] }>("/api/growth/leagues") });
  const joinedPlayIds = useMemo(() => new Set(me.data?.participations.filter((item) => item.status !== "CANCELLED").map((item) => item.openPlay.id)), [me.data]);
  const joinedLeagueIds = useMemo(() => new Set(me.data?.leagueEntries.filter((item) => item.status !== "WITHDRAWN").map((item) => item.league.id)), [me.data]);

  const action = useMutation({ mutationFn: ({ url, body }: { url: string; body?: unknown }) => apiFetch(url, { method: "POST", body: JSON.stringify(body ?? {}) }), onSuccess: () => { setError(""); setMessage("Action completed successfully."); void Promise.all([client.invalidateQueries({ queryKey: ["growth-me"] }), client.invalidateQueries({ queryKey: ["open-plays"] }), client.invalidateQueries({ queryKey: ["growth-leagues"] })]); }, onError: (exception) => setError(exception instanceof ApiError ? exception.message : "Unable to complete this action.") });
  const updateProfile = useMutation({ mutationFn: (marketingConsent: boolean) => apiFetch("/api/growth/profile", { method: "PATCH", body: JSON.stringify({ marketingConsent }) }), onSuccess: () => { setMessage("Communication preference updated."); client.invalidateQueries({ queryKey: ["growth-me"] }); }, onError: (exception) => setError(exception instanceof ApiError ? exception.message : "Unable to update your preference.") });
  const paymentBody = { paymentMethod: method, transactionReference: reference || undefined };

  function joinWaitlist() {
    setMessage(""); setError("");
    if (!waitlistForm.courtId || !waitlistForm.date || !waitlistForm.time) { setError("Choose a court, date, and time."); return; }
    action.mutate({ url: "/api/growth/waitlist", body: { courtId: waitlistForm.courtId, startsAt: new Date(`${waitlistForm.date}T${waitlistForm.time}:00+08:00`).toISOString(), durationMinutes: Number(waitlistForm.durationMinutes) } });
  }

  if (me.isLoading || openPlays.isLoading || packages.isLoading || leagues.isLoading) return <div className="rounded-3xl bg-white p-10 text-center text-ink/50">Loading your club benefits…</div>;
  if (me.isError) return <div className="rounded-3xl bg-white p-10 text-center text-red-700">Unable to load the club growth workspace.</div>;
  const activePackages = me.data?.packagePurchases.filter((purchase) => purchase.status === "ACTIVE") ?? [];

  return <div>
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-bold uppercase tracking-[.18em] text-pine">Play & rewards</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Your Rally experience</h1><p className="mt-2 max-w-2xl text-ink/55">Find players, recover booked court times, use club credit, and track your competitive progress.</p></div><label className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm shadow-sm"><input type="checkbox" checked={me.data?.profile.marketingConsent ?? false} onChange={(event) => updateProfile.mutate(event.target.checked)} />Receive relevant club offers</label></div>
    {message && <div className="mt-5 rounded-xl bg-lime/50 px-4 py-3 text-sm text-pine"><CheckCircle2 className="mr-1 inline" size={16} />{message}</div>}{error && <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={Coins} label="Club wallet" value={money(me.data?.profile.walletBalance ?? 0)} /><Metric icon={Gauge} label="Skill rating" value={(me.data?.profile.skillRating ?? 3).toFixed(2)} /><Metric icon={PackageCheck} label="Package credits" value={String(activePackages.reduce((sum, item) => sum + item.creditsRemaining, 0))} /><Metric icon={CalendarClock} label="Active waitlists" value={String(me.data?.waitlist.filter((item) => ["WAITING", "OFFERED"].includes(item.status)).length ?? 0)} /></div>

    <section className="mt-8 rounded-3xl bg-pine p-6 text-white shadow-sm sm:p-8"><div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-end"><div><p className="text-sm font-bold uppercase tracking-[.16em] text-lime">Payment preference</p><h2 className="mt-2 text-2xl font-semibold">Use one payment choice across this page</h2><p className="mt-2 text-sm leading-6 text-white/60">Club wallet top-ups, open-play spots, packages, and waitlist claims remain pending until staff verifies the reference.</p></div><div className="grid gap-3"><select className="rounded-xl border-0 bg-white px-3 py-3 text-sm text-ink" value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>{paymentMethods.map((item) => <option key={item} value={item}>{paymentLabel(item)}</option>)}</select><input className="rounded-xl border-0 bg-white px-3 py-3 text-sm text-ink" placeholder="Payment reference (if applicable)" value={reference} onChange={(event) => setReference(event.target.value)} /></div></div></section>

    <div className="mt-8 grid gap-8 xl:grid-cols-2">
      <Section title="Open play matchmaker" subtitle="Join as one player. The club handles the court and compatible group.">
        <div className="space-y-3">{openPlays.data?.openPlays.length ? openPlays.data.openPlays.map((play) => <article key={play.id} className="rounded-2xl border border-black/5 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{play.title}</h3><p className="mt-1 text-sm text-ink/50">{play.court.name} · {dateTime(play.startsAt)}</p></div><Status value={play.status} /></div><div className="mt-4 flex flex-wrap gap-3 text-xs text-ink/55"><span>{play.skillMin.toFixed(1)}–{play.skillMax.toFixed(1)} rating</span><span>{play.participants.length}/{play.capacity} players</span><span>{money(play.pricePerPlayer)}</span><span>{play.competitive ? "Competitive" : "Social"}</span></div><Button className="mt-4 w-full" disabled={action.isPending || joinedPlayIds.has(play.id) || play.participants.length >= play.capacity} onClick={() => action.mutate({ url: `/api/growth/open-plays/${play.id}/join`, body: paymentBody })}>{joinedPlayIds.has(play.id) ? "You joined this match" : "Join open play"}</Button></article>) : <Empty text="No open-play sessions are available yet." />}</div>
      </Section>
      <Section title="Smart waitlist" subtitle="Ask the system to notify you when a booked time becomes available.">
        <div className="grid gap-3 sm:grid-cols-2"><select className="rounded-xl border border-black/10 px-3 py-3 text-sm" value={waitlistForm.courtId} onChange={(event) => setWaitlistForm({ ...waitlistForm, courtId: event.target.value })}><option value="">Choose court</option>{courts.data?.courts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select><input type="date" className="rounded-xl border border-black/10 px-3 py-3 text-sm" value={waitlistForm.date} onChange={(event) => setWaitlistForm({ ...waitlistForm, date: event.target.value })} /><input type="time" className="rounded-xl border border-black/10 px-3 py-3 text-sm" value={waitlistForm.time} onChange={(event) => setWaitlistForm({ ...waitlistForm, time: event.target.value })} /><select className="rounded-xl border border-black/10 px-3 py-3 text-sm" value={waitlistForm.durationMinutes} onChange={(event) => setWaitlistForm({ ...waitlistForm, durationMinutes: event.target.value })}><option value="60">1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option><option value="180">3 hours</option></select></div><Button className="mt-3 w-full" disabled={action.isPending} onClick={joinWaitlist}>Join waitlist</Button>
        <div className="mt-5 space-y-3">{me.data?.waitlist.slice(0, 6).map((entry) => <div key={entry.id} className="rounded-xl bg-sand p-4"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{entry.court.name}</p><p className="mt-1 text-xs text-ink/50">{dateTime(entry.startsAt)} · {entry.durationMinutes} minutes</p></div><Status value={entry.status} /></div>{entry.status === "OFFERED" && <Button className="mt-3 w-full" onClick={() => action.mutate({ url: `/api/growth/waitlist/${entry.id}/claim`, body: paymentBody })}>Claim available court</Button>}{["WAITING", "OFFERED"].includes(entry.status) && <Button variant="ghost" className="mt-2 w-full" onClick={() => action.mutate({ url: `/api/growth/waitlist/${entry.id}/cancel` })}>Leave waitlist</Button>}</div>)}</div>
      </Section>
      <Section title="Booking packages" subtitle="Prepay booking credits and use them for instant confirmation.">
        <div className="grid gap-3 sm:grid-cols-2">{packages.data?.packages.map((plan) => <article key={plan.id} className="rounded-2xl bg-sand p-4"><p className="text-xs font-bold uppercase tracking-wider text-pine">{plan.bookingCredits} credits</p><h3 className="mt-2 font-semibold">{plan.name}</h3><p className="mt-1 text-sm text-ink/50">{plan.description}</p><p className="mt-4 text-xl font-semibold">{money(plan.price)}</p><Button className="mt-4 w-full" disabled={action.isPending} onClick={() => action.mutate({ url: `/api/growth/packages/${plan.id}/purchase`, body: paymentBody })}>Purchase package</Button></article>)}</div>{activePackages.map((purchase) => <p key={purchase.id} className="mt-3 rounded-xl border border-lime bg-lime/20 px-4 py-3 text-sm text-pine"><strong>{purchase.packagePlan.name}:</strong> {purchase.creditsRemaining} credits remaining until {new Date(purchase.expiresAt).toLocaleDateString("en-PH")}</p>)}
      </Section>
      <Section title="Club wallet" subtitle="Keep reusable club credit for faster checkout and refunds.">
        <div className="flex gap-2"><input type="number" min="100" className="min-w-0 flex-1 rounded-xl border border-black/10 px-3 py-3" value={topUp} onChange={(event) => setTopUp(event.target.value)} /><Button disabled={action.isPending} onClick={() => action.mutate({ url: "/api/growth/wallet/top-up", body: { amount: Number(topUp), ...paymentBody } })}><CreditCard className="mr-1 inline" size={16} />Request top-up</Button></div><div className="mt-5 space-y-2">{me.data?.walletTransactions.slice(0, 6).map((item) => <div key={item.id} className="flex items-center justify-between rounded-xl bg-sand px-4 py-3 text-sm"><div><p className="font-medium">{item.description}</p><p className="text-xs text-ink/45">{new Date(item.createdAt).toLocaleDateString("en-PH")}</p></div><p className={item.type === "DEBIT" ? "text-red-700" : "text-pine"}>{item.type === "DEBIT" ? "−" : "+"}{money(item.amount)}</p></div>)}</div>
      </Section>
    </div>
    <Section className="mt-8" title="Leagues, ladders & ratings" subtitle="Join club competition and build a verified local playing history.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{leagues.data?.leagues.length ? leagues.data.leagues.map((league) => <article key={league.id} className="rounded-2xl border border-black/5 p-5"><div className="flex items-start justify-between gap-3"><Trophy className="text-pine" /><Status value={league.status} /></div><h3 className="mt-4 text-lg font-semibold">{league.name}</h3><p className="mt-2 text-sm leading-6 text-ink/50">{league.description}</p><p className="mt-4 text-sm">Division {league.skillMin.toFixed(1)}–{league.skillMax.toFixed(1)} · {money(league.entryFee)}</p><Button className="mt-4 w-full" disabled={action.isPending || joinedLeagueIds.has(league.id) || league.status !== "REGISTRATION_OPEN"} onClick={() => action.mutate({ url: `/api/growth/leagues/${league.id}/join`, body: paymentBody })}>{joinedLeagueIds.has(league.id) ? "Registered" : "Join league"}</Button>{league.entries.length > 0 && <div className="mt-4 border-t border-black/5 pt-3"><p className="text-xs font-bold uppercase tracking-wider text-ink/40">Standings</p>{league.entries.slice(0, 5).map((entry, index) => <p key={entry.id} className="mt-2 flex justify-between text-sm"><span>{index + 1}. {entry.customer.user.firstName} {entry.customer.user.lastName}</span><span>{entry.points} pts</span></p>)}</div>}</article>) : <Empty text="No leagues are currently open." />}</div>
    </Section>
  </div>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof Coins; label: string; value: string }) { return <div className="rounded-2xl bg-white p-5 shadow-sm"><div className="grid h-10 w-10 place-items-center rounded-xl bg-lime text-pine"><Icon size={19} /></div><p className="mt-4 text-sm text-ink/50">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>; }
function Section({ title, subtitle, children, className = "" }: { title: string; subtitle: string; children: React.ReactNode; className?: string }) { return <section className={`rounded-3xl bg-white p-5 shadow-sm sm:p-6 ${className}`}><div className="mb-5"><h2 className="text-xl font-semibold">{title}</h2><p className="mt-1 text-sm text-ink/50">{subtitle}</p></div>{children}</section>; }
function Empty({ text }: { text: string }) { return <div className="rounded-xl bg-sand p-6 text-center text-sm text-ink/45"><Users className="mx-auto mb-2 text-pine" size={20} />{text}</div>; }
