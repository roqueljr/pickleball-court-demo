import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3, MapPin, Search, Timer } from "lucide-react";
import QRCode from "qrcode";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/Button";
import { ApiError, apiFetch } from "../lib/api";
import type { Booking } from "../types";

type BookingAction = "confirm" | "complete" | "no-show";

type ActionHandlers = {
  onCancel: (booking: Booking) => void;
  onReschedule: (booking: Booking) => void;
  onStatus: (booking: Booking, action: BookingAction) => void;
  onToggleQr?: (bookingId: string) => void;
};

function bookingDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function bookingTime(value: string) {
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes} minutes`;
  if (remainingMinutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${remainingMinutes} minutes`;
}

function money(value: number) {
  return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function statusTone(status: string) {
  if (["CANCELLED", "REFUNDED", "NO_SHOW"].includes(status)) return "bg-red-50 text-red-700";
  if (["CONFIRMED", "COMPLETED", "CHECKED_IN"].includes(status)) return "bg-lime text-pine";
  return "bg-amber-50 text-amber-700";
}

function checkedInRescheduleNotice(booking: Booking) {
  if (booking.status !== "CHECKED_IN") return null;
  if (booking.canReschedule && booking.rescheduleDeadline) return `Early check-in · reschedule until ${bookingTime(booking.rescheduleDeadline)}`;
  return "Rescheduling closed";
}

function AccessNotice({ booking }: { booking: Booking }) {
  if (!booking.accessPass) return null;
  const status = booking.accessPass.status.replaceAll("_", " ");
  return <div className="mt-3 rounded-xl bg-lime/30 px-3 py-2 text-xs text-pine"><strong>Access pass {status.toLowerCase()}</strong><span className="block mt-1">Valid {bookingTime(booking.accessPass.validFrom)}–{bookingTime(booking.accessPass.validUntil)} on {bookingDate(booking.accessPass.validFrom)}</span></div>;
}

function BookingQr({ token }: { token: string }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(token, { width: 220, margin: 2 }).then((value) => {
      if (active) setSrc(value);
    });
    return () => { active = false; };
  }, [token]);

  return <div className="rounded-2xl bg-sand p-4 text-center">
    <p className="text-sm font-semibold text-pine">Show this QR code at the front desk</p>
    {src
      ? <img className="mx-auto mt-3 h-44 w-44 rounded-xl bg-white p-2" src={src} alt="Booking check-in QR code" />
      : <p className="mt-3 text-xs text-ink/50">Generating QR code…</p>}
    <p className="mt-2 break-all text-[10px] text-ink/40">Backup token: {token}</p>
  </div>;
}

function ScheduleDetails({ booking, layout = "row" }: { booking: Booking; layout?: "row" | "column" }) {
  const className = layout === "row" ? "flex flex-wrap gap-4 text-sm text-ink/65" : "space-y-1 text-sm text-ink/60";
  return <div className={className}>
    <span className="block"><CalendarDays className="mr-1.5 inline text-pine" size={16} />{bookingDate(booking.startsAt)}</span>
    <span className="block"><Clock3 className="mr-1.5 inline text-pine" size={16} />{bookingTime(booking.startsAt)}–{bookingTime(booking.endsAt)}</span>
    <span className="block"><Timer className="mr-1.5 inline text-pine" size={16} />{durationLabel(booking.durationMinutes)}</span>
  </div>;
}

function BookingActions({ booking, isOperations, compact = false, qrExpanded = false, handlers }: {
  booking: Booking;
  isOperations: boolean;
  compact?: boolean;
  qrExpanded?: boolean;
  handlers: ActionHandlers;
}) {
  const buttonClass = compact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-xs";
  const isTerminal = ["CANCELLED", "COMPLETED", "REFUNDED", "NO_SHOW"].includes(booking.status);

  if (isOperations) {
    return <div className="flex flex-wrap gap-2 md:justify-end">
      {booking.status === "PENDING" && <Button className={buttonClass} onClick={() => handlers.onStatus(booking, "confirm")}>Confirm</Button>}
      {["CONFIRMED", "CHECKED_IN"].includes(booking.status) && <Button className={buttonClass} onClick={() => handlers.onStatus(booking, "complete")}>Complete</Button>}
      {["PENDING", "CONFIRMED"].includes(booking.status) && <Button variant="ghost" className={`${buttonClass} text-red-600`} onClick={() => handlers.onStatus(booking, "no-show")}>No-show</Button>}
      {!isTerminal && <Button variant="ghost" className={`${buttonClass} text-red-600`} onClick={() => handlers.onCancel(booking)}>Cancel</Button>}
      {isTerminal && <span className="self-center text-xs text-ink/35">No actions</span>}
    </div>;
  }

  const canCustomerReschedule = booking.canReschedule ?? ["PENDING", "CONFIRMED"].includes(booking.status);
  const canCustomerCancel = ["PENDING", "CONFIRMED"].includes(booking.status);
  const hasQrAction = booking.status === "CONFIRMED" && Boolean(booking.qrToken && handlers.onToggleQr);
  return <div className="flex flex-wrap gap-2 md:justify-end">
    {hasQrAction && <Button variant="secondary" className={buttonClass} onClick={() => handlers.onToggleQr?.(booking.id)}>
      {qrExpanded ? "Hide QR" : "View QR"}<ChevronDown className={`ml-1 inline transition ${qrExpanded ? "rotate-180" : ""}`} size={14} />
    </Button>}
    {canCustomerReschedule && <Button variant="ghost" className={`${buttonClass} text-pine`} onClick={() => handlers.onReschedule(booking)}>Reschedule</Button>}
    {canCustomerCancel && <Button variant="ghost" className={`${buttonClass} text-red-600`} onClick={() => handlers.onCancel(booking)}>Cancel</Button>}
    {!hasQrAction && !canCustomerReschedule && !canCustomerCancel && <span className="self-center text-xs text-ink/35">No actions</span>}
  </div>;
}

function MobileBookingCard({ booking, isOperations, handlers }: { booking: Booking; isOperations: boolean; handlers: ActionHandlers }) {
  return <article className="rounded-3xl bg-white p-5 shadow-sm md:hidden">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-xl font-semibold">{booking.court.name}</h2>
      <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone(booking.status)}`}>{statusLabel(booking.status)}</span>
    </div>
    <p className="mt-2 text-sm text-ink/50">{booking.reference}</p>
    {isOperations && booking.customer && <p className="mt-1 text-sm font-medium">{booking.customer.user.firstName} {booking.customer.user.lastName}</p>}
    {checkedInRescheduleNotice(booking) && <p className={`mt-2 text-xs font-medium ${booking.canReschedule ? "text-pine" : "text-ink/40"}`}>{checkedInRescheduleNotice(booking)}</p>}
    <div className="mt-5"><ScheduleDetails booking={booking} /></div>
    <p className="mt-3 text-sm text-ink/60"><MapPin className="mr-1.5 inline text-pine" size={16} />{booking.court.location || "Location not specified"}</p>
    <div className="mt-5 flex items-end justify-between gap-3 border-t border-black/5 pt-4">
      <div><p className="text-xs text-ink/45">Total</p><p className="mt-1 text-xl font-semibold">{money(booking.total)}</p></div>
      <BookingActions booking={booking} isOperations={isOperations} handlers={handlers} compact />
    </div>
    {!isOperations && booking.status === "CONFIRMED" && booking.qrToken && <div className="mt-4"><BookingQr token={booking.qrToken} /></div>}
    {!isOperations && <AccessNotice booking={booking} />}
    {!isOperations && booking.status === "PENDING" && <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-700">Payment is pending staff confirmation. Your QR code will appear after payment is verified.</div>}
  </article>;
}

function DesktopBookingsTable({ bookings, isOperations, expandedQrId, handlers }: {
  bookings: Booking[];
  isOperations: boolean;
  expandedQrId: string | null;
  handlers: ActionHandlers;
}) {
  const columnCount = isOperations ? 7 : 6;
  return <div className="hidden flex-col overflow-hidden rounded-3xl bg-white shadow-sm md:flex">
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] border-collapse text-left">
        <thead className="bg-pine text-xs uppercase tracking-[.12em] text-white/75">
          <tr>
            <th className="px-5 py-4 font-semibold">Booking</th>
            {isOperations && <th className="px-5 py-4 font-semibold">Customer</th>}
            <th className="px-5 py-4 font-semibold">Schedule</th>
            <th className="px-5 py-4 font-semibold">Location</th>
            <th className="px-5 py-4 font-semibold">Status</th>
            <th className="px-5 py-4 text-right font-semibold">Total</th>
            <th className="px-5 py-4 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5">
          {bookings.map((booking) => <Fragment key={booking.id}>
            <tr className="align-top transition hover:bg-sand/50">
              <td className="px-5 py-5"><p className="font-semibold">{booking.court.name}</p><p className="mt-1 text-xs text-ink/45">{booking.reference}</p></td>
              {isOperations && <td className="px-5 py-5">{booking.customer ? <><p className="text-sm font-semibold">{booking.customer.user.firstName} {booking.customer.user.lastName}</p><p className="mt-1 max-w-48 truncate text-xs text-ink/45" title={booking.customer.user.email}>{booking.customer.user.email}</p></> : <span className="text-sm text-ink/35">—</span>}</td>}
              <td className="px-5 py-5"><ScheduleDetails booking={booking} layout="column" /></td>
              <td className="px-5 py-5 text-sm text-ink/60"><MapPin className="mr-1 inline text-pine" size={15} />{booking.court.location || "—"}</td>
              <td className="px-5 py-5"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusTone(booking.status)}`}>{statusLabel(booking.status)}</span>{!isOperations && booking.status === "PENDING" && <p className="mt-2 max-w-36 text-xs leading-4 text-amber-700">Awaiting payment confirmation</p>}{!isOperations && <AccessNotice booking={booking} />}{checkedInRescheduleNotice(booking) && <p className={`mt-2 max-w-40 text-xs leading-4 ${booking.canReschedule ? "text-pine" : "text-ink/40"}`}>{checkedInRescheduleNotice(booking)}</p>}</td>
              <td className="px-5 py-5 text-right font-semibold">{money(booking.total)}</td>
              <td className="px-5 py-5"><BookingActions booking={booking} isOperations={isOperations} handlers={handlers} compact qrExpanded={expandedQrId === booking.id} /></td>
            </tr>
            {!isOperations && booking.qrToken && expandedQrId === booking.id && <tr><td colSpan={columnCount} className="bg-sand/50 px-5 py-5"><div className="mx-auto max-w-sm"><BookingQr token={booking.qrToken} /></div></td></tr>}
          </Fragment>)}
        </tbody>
      </table>
    </div>
  </div>;
}

export function Bookings() {
  const { user } = useAuth();
  const isOperations = user?.roles.some((role) => ["SUPER_ADMIN", "ADMIN", "STAFF"].includes(role)) ?? false;
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [expandedQrId, setExpandedQrId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["bookings", search, status, page],
    queryFn: () => apiFetch<{ bookings: Booking[]; pagination: { page: number; limit: number; total: number; pages: number } }>(`/api/bookings?page=${page}&limit=20${search ? `&search=${encodeURIComponent(search)}` : ""}${status ? `&status=${status}` : ""}`),
    refetchInterval: 30_000
  });
  const cancel = useMutation({ mutationFn: (id: string) => apiFetch<{ booking: Booking }>(`/api/bookings/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason: isOperations ? "Cancelled by staff" : "Cancelled by customer" }) }), onSuccess: () => client.invalidateQueries({ queryKey: ["bookings"] }) });
  const statusUpdate = useMutation({ mutationFn: ({ id, action }: { id: string; action: BookingAction }) => apiFetch<{ booking: Booking }>(`/api/bookings/${id}/${action}`, { method: "POST" }), onSuccess: () => { client.invalidateQueries({ queryKey: ["bookings"] }); client.invalidateQueries({ queryKey: ["payments"] }); } });
  const reschedule = useMutation({ mutationFn: ({ id, date, startTime }: { id: string; date: string; startTime: string }) => apiFetch<{ booking: Booking }>(`/api/bookings/${id}/reschedule`, { method: "POST", body: JSON.stringify({ date, startTime }) }), onSuccess: () => client.invalidateQueries({ queryKey: ["bookings"] }) });

  async function run(action: () => Promise<unknown>) {
    setError("");
    try { await action(); } catch (exception) { setError(exception instanceof ApiError ? exception.message : "Unable to update booking."); }
  }

  async function rescheduleBooking(booking: Booking) {
    const nextDate = window.prompt("New date (YYYY-MM-DD)", new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(booking.startsAt)));
    if (!nextDate) return;
    const nextTime = window.prompt("New start time (HH:mm)", new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(booking.startsAt)));
    if (nextTime) await run(() => reschedule.mutateAsync({ id: booking.id, date: nextDate, startTime: nextTime }));
  }

  const handlers: ActionHandlers = {
    onCancel: (booking) => { if (window.confirm("Cancel this booking?")) void run(() => cancel.mutateAsync(booking.id)); },
    onReschedule: (booking) => { void rescheduleBooking(booking); },
    onStatus: (booking, action) => { void run(() => statusUpdate.mutateAsync({ id: booking.id, action })); },
    onToggleQr: (bookingId) => setExpandedQrId((current) => current === bookingId ? null : bookingId)
  };

  const bookings = query.data?.bookings ?? [];
  const pagination = query.data?.pagination;

  return <div>
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-sm font-bold uppercase tracking-[.18em] text-pine">{isOperations ? "Operations" : "Your reservations"}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Bookings</h1><p className="mt-2 text-ink/55">{isOperations ? "Search reservations and manage their lifecycle." : "Keep track of upcoming games and past rallies."}</p></div>
      <Link to="/app/book" className="rounded-xl bg-pine px-4 py-3 text-center text-sm font-semibold text-white">Book another court</Link>
    </div>
    {!isOperations && <div className="mt-5 rounded-2xl bg-lime/40 px-4 py-3 text-sm text-pine">Your booking is not confirmed until staff verifies payment. The QR code appears only after payment confirmation.</div>}
    {error && <div className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

    <div className="mt-8 grid gap-3 rounded-3xl bg-white p-4 shadow-sm sm:grid-cols-[1fr_190px_auto]">
      <label className="relative block"><span className="sr-only">Search bookings</span><Search className="absolute left-3 top-3.5 text-ink/35" size={17} /><input className="w-full rounded-xl border border-black/10 py-3 pl-10 pr-3 text-sm" placeholder={isOperations ? "Reference, court, or customer" : "Search booking reference"} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
      <label><span className="sr-only">Filter by booking status</span><select className="w-full rounded-xl border border-black/10 bg-white px-3 py-3 text-sm" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW", "REFUNDED"].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
      <Button variant="ghost" onClick={() => { setSearch(""); setStatus(""); setPage(1); }}>Clear</Button>
    </div>

    <div className="mt-4 flex items-center justify-between text-sm text-ink/50">
      <span>{pagination?.total ?? 0} booking{pagination?.total === 1 ? "" : "s"}</span>
      {pagination && pagination.pages > 1 && <div className="flex items-center gap-2"><button aria-label="Previous page" className="rounded-lg bg-white p-2 shadow-sm disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></button><span>Page {page} of {pagination.pages}</span><button aria-label="Next page" className="rounded-lg bg-white p-2 shadow-sm disabled:opacity-40" disabled={page >= pagination.pages} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></button></div>}
    </div>

    <div className="mt-4">
      {query.isLoading ? <div className="grid min-h-64 place-items-center rounded-3xl bg-white text-ink/50 shadow-sm">Loading bookings…</div>
        : query.isError ? <div className="rounded-3xl bg-red-50 p-10 text-center text-red-700"><p className="font-semibold">Unable to load bookings</p><Button variant="ghost" className="mt-3 text-red-700" onClick={() => void query.refetch()}>Try again</Button></div>
          : bookings.length ? <>
            <DesktopBookingsTable bookings={bookings} isOperations={isOperations} expandedQrId={expandedQrId} handlers={handlers} />
            <div className="space-y-4 md:hidden">{bookings.map((booking) => <MobileBookingCard key={booking.id} booking={booking} isOperations={isOperations} handlers={handlers} />)}</div>
          </>
            : <div className="rounded-3xl bg-white p-10 text-center shadow-sm"><p className="text-lg font-semibold">No matching bookings</p><p className="mt-2 text-sm text-ink/50">Try clearing your filters or choose another booking date.</p></div>}
    </div>
  </div>;
}
