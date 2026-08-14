import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, FilterX, GraduationCap, RefreshCw, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { apiFetch } from "../lib/api";

type CalendarView = "DAY" | "WEEK" | "MONTH";
type EventType = "BOOKING" | "COACHING" | "BLOCKED" | "MAINTENANCE";
type CalendarEvent = {
  id: string;
  entityId: string;
  type: EventType;
  title: string;
  detail: string;
  startsAt: string;
  endsAt: string;
  status: string;
  court: { id: string; name: string };
  customer: { name: string; email: string } | null;
  targetUrl: string;
};
type CalendarResponse = {
  events: CalendarEvent[];
  courts: { id: string; name: string; status: string }[];
  generatedAt: string;
};

const timeZone = "Asia/Manila";
const statuses = ["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW", "REFUNDED", "BLOCKED", "MAINTENANCE", "CLOSED"];

function manilaDateKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function todayKey() {
  return manilaDateKey(new Date());
}

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00+08:00`);
}

function addDays(value: string, days: number) {
  const next = dateFromKey(value);
  next.setUTCDate(next.getUTCDate() + days);
  return manilaDateKey(next);
}

function addMonths(value: string, months: number) {
  const next = dateFromKey(value);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  return manilaDateKey(next);
}

function startOfWeek(value: string) {
  const date = dateFromKey(value);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addDays(value, -mondayOffset);
}

function startOfMonthGrid(value: string) {
  return startOfWeek(`${value.slice(0, 7)}-01`);
}

function rangeFor(view: CalendarView, anchor: string) {
  if (view === "DAY") return [anchor];
  const start = view === "WEEK" ? startOfWeek(anchor) : startOfMonthGrid(anchor);
  return Array.from({ length: view === "WEEK" ? 7 : 42 }, (_, index) => addDays(start, index));
}

function periodLabel(view: CalendarView, anchor: string, days: string[]) {
  if (view === "DAY") return dateFromKey(anchor).toLocaleDateString("en-PH", { timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" });
  if (view === "MONTH") return dateFromKey(anchor).toLocaleDateString("en-PH", { timeZone, month: "long", year: "numeric" });
  const first = dateFromKey(days[0]);
  const last = dateFromKey(days[days.length - 1]);
  const firstLabel = first.toLocaleDateString("en-PH", { timeZone, month: "short", day: "numeric" });
  const lastLabel = last.toLocaleDateString("en-PH", { timeZone, month: "short", day: "numeric", year: "numeric" });
  return `${firstLabel} – ${lastLabel}`;
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-PH", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function eventTone(status: string, type: EventType) {
  if (["CANCELLED", "NO_SHOW", "REFUNDED", "CLOSED"].includes(status)) return "border-red-200 bg-red-50 text-red-800";
  if (status === "PENDING") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "CHECKED_IN") return "border-blue-200 bg-blue-50 text-blue-800";
  if (status === "COMPLETED") return "border-slate-200 bg-slate-50 text-slate-700";
  if (type === "COACHING") return "border-violet-200 bg-violet-50 text-violet-800";
  if (type === "BLOCKED" || type === "MAINTENANCE") return "border-orange-200 bg-orange-50 text-orange-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function CalendarEventCard({ event, compact = false }: { event: CalendarEvent; compact?: boolean }) {
  return <Link to={event.targetUrl} className={`block rounded-xl border p-2.5 transition hover:-translate-y-0.5 hover:shadow-sm ${eventTone(event.status, event.type)}`}>
    <div className="flex items-center justify-between gap-2"><p className="font-bold">{timeLabel(event.startsAt)}</p><span className="text-[9px] font-bold uppercase tracking-wide opacity-65">{event.type}</span></div>
    <p className="mt-1 line-clamp-2 font-semibold">{event.title}</p>
    {!compact && <><p className="mt-1 truncate opacity-75">{event.detail}</p><p className="mt-1 truncate opacity-60">{timeLabel(event.startsAt)}–{timeLabel(event.endsAt)} · {event.status.replaceAll("_", " ")}</p></>}
  </Link>;
}

export function Calendar() {
  const [view, setView] = useState<CalendarView>("WEEK");
  const [anchor, setAnchor] = useState(todayKey());
  const [courtId, setCourtId] = useState("");
  const [status, setStatus] = useState("");
  const [eventType, setEventType] = useState("");
  const [customer, setCustomer] = useState("");
  const deferredCustomer = useDeferredValue(customer.trim());
  const days = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const from = new Date(`${days[0]}T00:00:00+08:00`).toISOString();
  const to = new Date(`${addDays(days[days.length - 1], 1)}T00:00:00+08:00`).toISOString();
  const parameters = new URLSearchParams({ from, to });
  if (courtId) parameters.set("courtId", courtId);
  if (status) parameters.set("status", status);
  if (eventType) parameters.set("eventType", eventType);
  if (deferredCustomer) parameters.set("customer", deferredCustomer);

  const query = useQuery({
    queryKey: ["calendar", view, from, to, courtId, status, eventType, deferredCustomer],
    queryFn: () => apiFetch<CalendarResponse>(`/api/calendar?${parameters.toString()}`),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 0
  });

  const eventsByDay = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();
    for (const event of query.data?.events ?? []) {
      const key = manilaDateKey(new Date(event.startsAt));
      grouped.set(key, [...(grouped.get(key) ?? []), event]);
    }
    return grouped;
  }, [query.data?.events]);
  const bookingCount = query.data?.events.filter((event) => event.type === "BOOKING").length ?? 0;
  const coachingCount = query.data?.events.filter((event) => event.type === "COACHING").length ?? 0;
  const unavailableCount = query.data?.events.filter((event) => event.type === "BLOCKED" || event.type === "MAINTENANCE").length ?? 0;
  const month = anchor.slice(0, 7);
  const monthAgendaDays = days.filter((day) => day.startsWith(month) && (eventsByDay.get(day)?.length ?? 0) > 0);
  const filtersActive = Boolean(courtId || status || eventType || customer);

  function move(direction: number) {
    setAnchor((value) => view === "MONTH" ? addMonths(value, direction) : addDays(value, direction * (view === "WEEK" ? 7 : 1)));
  }

  function clearFilters() {
    setCourtId("");
    setStatus("");
    setEventType("");
    setCustomer("");
  }

  function DayCard({ day, compact = false }: { day: string; compact?: boolean }) {
    const events = eventsByDay.get(day) ?? [];
    const date = dateFromKey(day);
    const isToday = day === todayKey();
    const outsideMonth = view === "MONTH" && !day.startsWith(month);
    return <section className={`min-h-48 rounded-2xl border bg-white p-3 shadow-sm ${isToday ? "border-pine ring-2 ring-lime/50" : "border-black/5"} ${outsideMonth ? "opacity-45" : ""}`}>
      <div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-pine">{date.toLocaleDateString("en-PH", { timeZone, weekday: "short" })}</p><p className="mt-1 text-2xl font-semibold">{date.getUTCDate()}</p></div>{isToday && <span className="rounded-full bg-lime px-2 py-1 text-[9px] font-bold uppercase text-pine">Today</span>}</div>
      <div className="mt-3 space-y-2">{events.length ? events.map((event) => <CalendarEventCard key={event.id} event={event} compact={compact} />) : <p className="pt-2 text-xs text-ink/35">No events</p>}</div>
    </section>;
  }

  return <div>
    <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
      <div><p className="text-sm font-bold uppercase tracking-[.18em] text-pine">Operations</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Booking calendar</h1><p className="mt-2 text-ink/55">Bookings, coaching, and unavailable court time in Asia/Manila.</p></div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="inline-flex rounded-xl bg-white p-1 shadow-sm">{(["DAY", "WEEK", "MONTH"] as CalendarView[]).map((option) => <button key={option} type="button" onClick={() => setView(option)} className={`rounded-lg px-3 py-2 text-xs font-bold ${view === option ? "bg-pine text-white" : "text-ink/50 hover:text-pine"}`}>{option[0]}{option.slice(1).toLowerCase()}</button>)}</div>
        <div className="flex items-center gap-2"><button type="button" aria-label={`Previous ${view.toLowerCase()}`} className="rounded-xl bg-white p-2.5 shadow-sm" onClick={() => move(-1)}><ChevronLeft size={18} /></button><button type="button" className="min-w-28 rounded-xl bg-white px-3 py-2.5 text-sm font-semibold shadow-sm" onClick={() => setAnchor(todayKey())}>Today</button><button type="button" aria-label={`Next ${view.toLowerCase()}`} className="rounded-xl bg-white p-2.5 shadow-sm" onClick={() => move(1)}><ChevronRight size={18} /></button></div>
      </div>
    </div>

    <div className="mt-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><h2 className="text-xl font-semibold">{periodLabel(view, anchor, days)}</h2><button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className="flex items-center gap-2 self-start text-xs font-semibold text-pine disabled:opacity-50"><RefreshCw size={14} className={query.isFetching ? "animate-spin" : ""} />{query.isFetching ? "Refreshing…" : "Refresh calendar"}</button></div>

    <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-white p-4 shadow-sm"><CalendarDays className="text-pine" size={18} /><p className="mt-3 text-2xl font-semibold">{bookingCount}</p><p className="text-xs text-ink/45">Court bookings</p></div><div className="rounded-2xl bg-white p-4 shadow-sm"><GraduationCap className="text-violet-600" size={18} /><p className="mt-3 text-2xl font-semibold">{coachingCount}</p><p className="text-xs text-ink/45">Coaching sessions</p></div><div className="rounded-2xl bg-white p-4 shadow-sm"><ShieldAlert className="text-orange-600" size={18} /><p className="mt-3 text-2xl font-semibold">{unavailableCount}</p><p className="text-xs text-ink/45">Blocked or maintenance</p></div></div>

    <div className="mt-5 grid gap-3 rounded-3xl bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.25fr_auto]">
      <label className="text-xs font-semibold text-ink/55">Court<select className="mt-1.5 block w-full rounded-xl border border-black/10 bg-white px-3 py-3 text-sm text-ink" value={courtId} onChange={(event) => setCourtId(event.target.value)}><option value="">All courts</option>{query.data?.courts.map((court) => <option key={court.id} value={court.id}>{court.name}{court.status !== "AVAILABLE" ? ` · ${court.status}` : ""}</option>)}</select></label>
      <label className="text-xs font-semibold text-ink/55">Event type<select className="mt-1.5 block w-full rounded-xl border border-black/10 bg-white px-3 py-3 text-sm text-ink" value={eventType} onChange={(event) => setEventType(event.target.value)}><option value="">All event types</option><option value="BOOKING">Court bookings</option><option value="COACHING">Coaching</option><option value="BLOCKED">Blocked time</option><option value="MAINTENANCE">Maintenance</option></select></label>
      <label className="text-xs font-semibold text-ink/55">Status<select className="mt-1.5 block w-full rounded-xl border border-black/10 bg-white px-3 py-3 text-sm text-ink" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
      <label className="text-xs font-semibold text-ink/55">Customer<input className="mt-1.5 block w-full rounded-xl border border-black/10 bg-white px-3 py-3 text-sm text-ink" placeholder="Name or email" value={customer} onChange={(event) => setCustomer(event.target.value)} /></label>
      <Button type="button" variant="ghost" className="self-end px-3 py-3" disabled={!filtersActive} onClick={clearFilters}><FilterX className="mr-1 inline" size={16} />Clear</Button>
    </div>

    <div className="mt-4 flex flex-wrap gap-4 text-xs text-ink/50"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />Pending</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Confirmed</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" />Checked in</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-violet-500" />Coaching</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" />Unavailable</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />Cancelled/no-show</span></div>

    {query.isLoading ? <div className="mt-6 grid min-h-72 place-items-center rounded-3xl bg-white text-sm text-ink/45"><RefreshCw className="mb-3 animate-spin text-pine" /><span>Loading calendar…</span></div> : query.isError ? <div className="mt-6 rounded-3xl bg-red-50 p-8 text-center text-sm text-red-700"><p className="font-semibold">Unable to load the calendar.</p><button type="button" className="mt-2 underline" onClick={() => void query.refetch()}>Try again</button></div> : view === "DAY" ? <div className="mt-6"><DayCard day={days[0]} /></div> : view === "WEEK" ? <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-7">{days.map((day) => <DayCard key={day} day={day} />)}</div> : <>
      <div className="mt-6 space-y-3 lg:hidden">{monthAgendaDays.length ? monthAgendaDays.map((day) => <DayCard key={day} day={day} />) : <div className="rounded-3xl bg-white p-10 text-center text-sm text-ink/45">No events match this month and these filters.</div>}</div>
      <div className="mt-6 hidden grid-cols-7 gap-2 lg:grid">{days.map((day) => <DayCard key={day} day={day} compact />)}</div>
    </>}

    {!query.isLoading && !query.isError && query.data?.events.length === 0 && view !== "MONTH" && <div className="mt-4 rounded-2xl bg-white p-6 text-center text-sm text-ink/45">No calendar events match the selected period and filters.</div>}
    <p className="mt-5 flex items-center gap-2 text-xs text-ink/40"><Clock3 size={13} />All calendar dates and times use Asia/Manila. Events refresh automatically every 30 seconds.</p>
  </div>;
}
