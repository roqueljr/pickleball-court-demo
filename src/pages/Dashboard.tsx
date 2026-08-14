import { ArrowUpRight, CalendarDays, CheckCircle2, Clock3, Crown, Users, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { apiFetch } from "../lib/api";
import { primaryRole } from "../lib/roles";
import type { AdminDashboard, Booking, CoachingSession, Membership } from "../types";

function bookingTime(value: string) {
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function money(value: number) {
  return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) return `${remainingMinutes} minutes`;
  return `${hours} hour${hours === 1 ? "" : "s"}${remainingMinutes ? ` ${remainingMinutes} minutes` : ""}`;
}

export function Dashboard() {
  const { user } = useAuth();
  const role = primaryRole(user);
  const isOperations = ["SUPER_ADMIN", "ADMIN", "STAFF"].includes(role);
  const isCoach = role === "COACH";
  const isCustomer = role === "CUSTOMER";
  const bookingsQuery = useQuery({ queryKey: ["bookings"], queryFn: () => apiFetch<{ bookings: Booking[] }>("/api/bookings"), enabled: isCustomer });
  const membershipQuery = useQuery({ queryKey: ["memberships", "me"], queryFn: () => apiFetch<{ memberships: Membership[] }>("/api/memberships/me"), enabled: isCustomer });
  const operationsQuery = useQuery({ queryKey: ["operations-dashboard"], queryFn: () => apiFetch<AdminDashboard>("/api/admin/dashboard"), enabled: isOperations, refetchInterval: 30_000 });
  const coachQuery = useQuery({ queryKey: ["coaching-sessions"], queryFn: () => apiFetch<{ sessions: CoachingSession[] }>("/api/coaching/sessions"), enabled: isCoach, refetchInterval: 30_000 });
  const now = Date.now();
  const upcomingBookings = (bookingsQuery.data?.bookings ?? []).filter((booking) => ["PENDING", "CONFIRMED", "CHECKED_IN"].includes(booking.status) && new Date(booking.startsAt).getTime() > now).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const coachSessions = coachQuery.data?.sessions ?? [];
  const upcomingSessions = coachSessions.filter((session) => ["PENDING", "CONFIRMED"].includes(session.status) && new Date(session.startsAt).getTime() > now).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const selectedMembership = membershipQuery.data?.memberships.find((membership) => ["ACTIVE", "PENDING"].includes(membership.status));
  const activeMembership = selectedMembership?.status === "ACTIVE";
  const nextBooking = upcomingBookings[0];
  const nextSession = upcomingSessions[0];
  const recentBooking = operationsQuery.data?.recentBookings[0];
  const activeQuery = isOperations ? operationsQuery : isCoach ? coachQuery : bookingsQuery;

  const stats = isOperations ? [
    { label: "Today's bookings", value: operationsQuery.data ? String(operationsQuery.data.stats.bookings) : "—", note: `${operationsQuery.data?.stats.cancelled ?? 0} cancelled today`, icon: CalendarDays },
    { label: "Today's revenue", value: operationsQuery.data ? money(operationsQuery.data.stats.revenue) : "—", note: "Confirmed paid transactions", icon: WalletCards },
    { label: "Active customers", value: operationsQuery.data ? String(operationsQuery.data.stats.customers) : "—", note: "Available customer profiles", icon: Users },
    { label: "Courts in use", value: operationsQuery.data ? `${operationsQuery.data.stats.occupiedCourts}/${operationsQuery.data.courts.length}` : "—", note: `${operationsQuery.data?.stats.availableCourts ?? 0} available now`, icon: CheckCircle2 }
  ] : isCoach ? [
    { label: "Upcoming sessions", value: String(upcomingSessions.length), note: "Pending and confirmed", icon: CalendarDays },
    { label: "Confirmed", value: String(coachSessions.filter((session) => session.status === "CONFIRMED").length), note: "Ready for coaching", icon: CheckCircle2 },
    { label: "Completed", value: String(coachSessions.filter((session) => session.status === "COMPLETED").length), note: "Sessions delivered", icon: Clock3 },
    { label: "Assigned customers", value: String(new Set(coachSessions.map((session) => session.customer.user.email)).size), note: "Unique players", icon: Users }
  ] : [
    { label: "Upcoming bookings", value: String(upcomingBookings.length), note: upcomingBookings.length ? "Your active schedule" : "No upcoming bookings", icon: CalendarDays },
    { label: "Membership", value: selectedMembership?.plan.name ?? "None", note: activeMembership ? `${selectedMembership?.plan.discountPercent ?? 0}% booking discount` : selectedMembership ? "Awaiting payment" : "Choose a plan", icon: Crown },
    { label: "Membership status", value: selectedMembership?.status ?? "NONE", note: activeMembership ? "Benefits apply automatically" : "Explore your benefits", icon: CheckCircle2 },
    { label: "Next session", value: nextBooking ? bookingTime(nextBooking.startsAt) : "—", note: nextBooking?.court.name ?? "Book your next court", icon: Clock3 }
  ];

  const heading = isOperations ? "Operations at a glance." : isCoach ? `Welcome, Coach ${user?.firstName}.` : `Ready to rally, ${user?.firstName}?`;
  const subheading = isOperations ? "Monitor today’s bookings, payments, customers, and court activity." : isCoach ? "Your assigned coaching schedule and players are ready below." : "Your next great game starts here.";
  const action = isCoach ? { to: "/app/coaching", label: "Open my schedule" } : { to: "/app/book", label: isOperations ? "Create booking" : "Book a court" };

  return <div>
    <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="text-sm font-medium text-pine">{isOperations ? new Intl.DateTimeFormat("en-PH", { dateStyle: "full" }).format(new Date()) : isCoach ? "Coach workspace" : "Member overview"}</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">{heading}</h1><p className="mt-2 text-ink/55">{subheading}</p></div><Link to={action.to} className="rounded-xl bg-pine px-4 py-3 text-center text-sm font-semibold text-white">{action.label} <ArrowUpRight className="ml-1 inline" size={16} /></Link></div>
    {activeQuery.isError && <div className="mt-6 rounded-2xl bg-red-50 p-5 text-sm text-red-700"><p className="font-semibold">Dashboard data could not be loaded.</p><button type="button" className="mt-2 underline" onClick={() => void activeQuery.refetch()}>Try again</button></div>}
    <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{stats.map(({ label, value, note, icon: Icon }) => <div key={label} className="rounded-2xl bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm text-ink/55">{label}</span><Icon className="text-pine" size={19} /></div><p className="mt-5 truncate text-2xl font-semibold tracking-tight">{activeQuery.isLoading ? "…" : value}</p><p className="mt-1 text-xs text-ink/45">{note}</p></div>)}</div>

    {isCustomer && selectedMembership && <section className="mt-6 rounded-3xl bg-white p-6 shadow-sm"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2"><Crown className="text-pine" size={19} /><p className="text-sm font-bold uppercase tracking-[.16em] text-pine">Your selected membership</p></div><h2 className="mt-2 text-2xl font-semibold">{selectedMembership.plan.name}</h2><p className="mt-1 text-sm text-ink/55">{activeMembership ? "Active benefits are applied automatically when you book." : "Your plan will activate after payment confirmation."}</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${activeMembership ? "bg-lime text-pine" : "bg-amber-50 text-amber-700"}`}>{selectedMembership.status}</span></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{selectedMembership.plan.benefits.slice(0, 4).map((benefit) => <div key={benefit} className="rounded-xl bg-sand px-3 py-3 text-sm text-ink/65"><CheckCircle2 className="mr-2 inline text-pine" size={15} />{benefit}</div>)}</div><Link className="mt-5 inline-block text-sm font-semibold text-pine" to="/app/memberships">View membership details <ArrowUpRight className="ml-1 inline" size={15} /></Link></section>}
    {isCustomer && !selectedMembership && <section className="mt-6 rounded-3xl bg-pine p-6 text-white"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="text-sm text-white/60">Play more, save more</p><h2 className="mt-1 text-2xl font-semibold">Choose a membership plan</h2><p className="mt-2 text-sm text-white/65">Unlock discounts and club benefits for your next rallies.</p></div><Link className="rounded-xl bg-lime px-4 py-3 text-sm font-bold text-pine" to="/app/memberships">Explore plans</Link></div></section>}

    <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_.7fr]"><div className="rounded-3xl bg-pine p-6 text-white"><div className="flex items-start justify-between gap-4"><div><p className="text-sm text-white/60">{isOperations ? "Most recent booking" : isCoach ? "Next coaching session" : "Next booking"}</p><h2 className="mt-1 text-2xl font-semibold">{isOperations ? recentBooking ? `${recentBooking.court.name} · ${recentBooking.reference}` : "No recent bookings" : isCoach ? nextSession ? `${nextSession.customer.user.firstName} ${nextSession.customer.user.lastName}` : "No upcoming sessions" : nextBooking ? `${nextBooking.court.name} · ${nextBooking.reference}` : "No upcoming booking"}</h2></div><span className="rounded-full bg-lime px-3 py-1 text-xs font-bold text-pine">{(isOperations ? recentBooking?.status : isCoach ? nextSession?.status : nextBooking?.status)?.replaceAll("_", " ") ?? "OPEN"}</span></div><div className="mt-12 flex flex-wrap gap-8 text-sm"><div><p className="text-white/55">Date</p><p className="mt-1 font-medium">{isOperations && recentBooking ? new Date(recentBooking.startsAt).toLocaleDateString("en-PH") : isCoach && nextSession ? new Date(nextSession.startsAt).toLocaleDateString("en-PH") : nextBooking ? new Date(nextBooking.startsAt).toLocaleDateString("en-PH") : "—"}</p></div><div><p className="text-white/55">Time</p><p className="mt-1 font-medium">{isOperations && recentBooking ? bookingTime(recentBooking.startsAt) : isCoach && nextSession ? `${bookingTime(nextSession.startsAt)}–${bookingTime(nextSession.endsAt)}` : nextBooking ? `${bookingTime(nextBooking.startsAt)}–${bookingTime(nextBooking.endsAt)}` : "—"}</p></div>{nextBooking && !isOperations && !isCoach && <div><p className="text-white/55">Duration</p><p className="mt-1 font-medium">{durationLabel(nextBooking.durationMinutes)}</p></div>}</div></div>
      <div className="rounded-3xl bg-white p-6 shadow-sm"><p className="text-sm text-ink/55">Quick actions</p><div className="mt-4 space-y-2">{isOperations ? <><Link className="flex items-center justify-between rounded-xl bg-sand px-4 py-3 text-sm font-medium" to="/app/payments">Confirm payments <ArrowUpRight size={16} /></Link><Link className="flex items-center justify-between rounded-xl bg-sand px-4 py-3 text-sm font-medium" to="/app/check-in">Customer check-in <ArrowUpRight size={16} /></Link><Link className="flex items-center justify-between rounded-xl bg-sand px-4 py-3 text-sm font-medium" to="/app/calendar">Open calendar <ArrowUpRight size={16} /></Link></> : isCoach ? <><Link className="flex items-center justify-between rounded-xl bg-sand px-4 py-3 text-sm font-medium" to="/app/coaching">Manage sessions <ArrowUpRight size={16} /></Link><Link className="flex items-center justify-between rounded-xl bg-sand px-4 py-3 text-sm font-medium" to="/app/profile">Update profile <ArrowUpRight size={16} /></Link></> : <><Link className="flex items-center justify-between rounded-xl bg-sand px-4 py-3 text-sm font-medium" to="/app/bookings">View bookings <ArrowUpRight size={16} /></Link><Link className="flex items-center justify-between rounded-xl bg-sand px-4 py-3 text-sm font-medium" to="/app/profile">Update profile <ArrowUpRight size={16} /></Link></>}</div></div>
    </div>
  </div>;
}
