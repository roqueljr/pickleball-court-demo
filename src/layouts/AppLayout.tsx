import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Bell, Box, Building2, CalendarDays, CircleUserRound, CreditCard, Crown, History, LayoutDashboard, LogOut, Menu, PackageCheck, Receipt, ScanLine, Settings, ShoppingBag, Sparkles, Tag, Trophy, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "../components/Logo";
import { Button } from "../components/Button";
import { useAuth } from "../auth/AuthProvider";
import { cn } from "../lib/cn";
import { apiFetch } from "../lib/api";
import { primaryRole } from "../lib/roles";
import type { Notification } from "../types";
import { usePublicSettings } from "../hooks/usePublicSettings";

type NavigationItem = { to: string; label: string; icon: typeof LayoutDashboard };
type NavigationSection = { label: string; items: NavigationItem[] };

function navigationFor(role: string): NavigationSection[] {
  if (role === "SUPER_ADMIN" || role === "ADMIN") return [
    { label: "Workspace", items: [{ to: "/app", label: "Overview", icon: LayoutDashboard }, { to: "/app/book", label: "New booking", icon: ShoppingBag }, { to: "/app/bookings", label: "Bookings", icon: CalendarDays }, { to: "/app/calendar", label: "Calendar", icon: CalendarDays }, { to: "/app/check-in", label: "Check-in", icon: ScanLine }] },
    { label: "Club operations", items: [{ to: "/app/courts", label: "Courts", icon: Building2 }, { to: "/app/customers", label: "Customers", icon: Users }, { to: "/app/coaches", label: "Coaches", icon: Users }, { to: "/app/coaching", label: "Coaching schedule", icon: CalendarDays }, { to: "/app/equipment-inventory", label: "Equipment", icon: Box }, { to: "/app/pos", label: "POS", icon: ShoppingBag }] },
    { label: "Finance & growth", items: [{ to: "/app/growth", label: "Growth center", icon: Sparkles }, { to: "/app/memberships", label: "Membership plans", icon: Crown }, { to: "/app/payments", label: "Payments", icon: CreditCard }, { to: "/app/promotions", label: "Promotions", icon: Tag }, { to: "/app/products", label: "Products", icon: PackageCheck }, { to: "/app/expenses", label: "Expenses", icon: Receipt }, { to: "/app/reports", label: "Reports", icon: BarChart3 }, { to: "/app/tournaments", label: "Tournaments", icon: Trophy }] },
    { label: "Administration", items: [{ to: "/app/users", label: "Users", icon: Users }, { to: "/app/audit-logs", label: "Audit logs", icon: History }, { to: "/app/settings", label: "Settings", icon: Settings }] },
    { label: "Account", items: [{ to: "/app/profile", label: "Profile", icon: CircleUserRound }] }
  ];
  if (role === "STAFF") return [
    { label: "Front desk", items: [{ to: "/app", label: "Overview", icon: LayoutDashboard }, { to: "/app/book", label: "New booking", icon: ShoppingBag }, { to: "/app/bookings", label: "Bookings", icon: CalendarDays }, { to: "/app/calendar", label: "Calendar", icon: CalendarDays }, { to: "/app/check-in", label: "Check-in", icon: ScanLine }] },
    { label: "Operations", items: [{ to: "/app/growth", label: "Growth center", icon: Sparkles }, { to: "/app/customers", label: "Customers", icon: Users }, { to: "/app/coaching", label: "Coaching schedule", icon: CalendarDays }, { to: "/app/equipment-inventory", label: "Equipment", icon: Box }, { to: "/app/pos", label: "POS", icon: ShoppingBag }, { to: "/app/payments", label: "Payments", icon: CreditCard }] },
    { label: "Account", items: [{ to: "/app/profile", label: "Profile", icon: CircleUserRound }] }
  ];
  if (role === "COACH") return [
    { label: "Coach workspace", items: [{ to: "/app", label: "Overview", icon: LayoutDashboard }, { to: "/app/coaching", label: "My schedule", icon: CalendarDays }] },
    { label: "Account", items: [{ to: "/app/profile", label: "Profile", icon: CircleUserRound }] }
  ];
  return [
    { label: "My club", items: [{ to: "/app", label: "Overview", icon: LayoutDashboard }, { to: "/app/book", label: "Book a court", icon: ShoppingBag }, { to: "/app/bookings", label: "My bookings", icon: CalendarDays }] },
    { label: "Play", items: [{ to: "/app/growth", label: "Play & rewards", icon: Sparkles }, { to: "/app/coaching", label: "Coaching", icon: Users }, { to: "/app/equipment", label: "Equipment rental", icon: Box }] },
    { label: "Membership & billing", items: [{ to: "/app/memberships", label: "Membership", icon: Crown }, { to: "/app/payments", label: "Payment history", icon: CreditCard }] },
    { label: "Account", items: [{ to: "/app/profile", label: "Profile", icon: CircleUserRound }] }
  ];
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const branding = usePublicSettings().data;
  const businessName = branding?.businessName ?? "Rally Court Club";
  const role = primaryRole(user);
  const isOperations = ["SUPER_ADMIN", "ADMIN", "STAFF"].includes(role);
  const canBook = isOperations || role === "CUSTOMER";
  const workspaceLabel = role === "STAFF" ? "Front desk" : role === "COACH" ? "Coach workspace" : isOperations ? "Operations center" : "Member space";
  const sections = navigationFor(role);
  const notificationQuery = useQuery({ queryKey: ["notifications"], queryFn: () => apiFetch<{ notifications: Notification[]; unreadCount: number }>("/api/notifications"), enabled: Boolean(user), refetchInterval: 30_000 });
  const readNotification = useMutation({ mutationFn: (id: string) => apiFetch(`/api/notifications/${id}/read`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["notifications"] }) });
  const notifications = notificationQuery.data?.notifications ?? [];
  const unreadCount = notificationQuery.data?.unreadCount ?? notifications.filter((notification) => !notification.readAt).length;

  useEffect(() => { document.title = businessName; }, [businessName]);

  async function signOut() {
    navigate("/login", { replace: true });
    await logout();
  }

  async function openNotification(notification: Notification) {
    if (!notification.readAt) await readNotification.mutateAsync(notification.id);
    setNotificationsOpen(false);
    navigate(notification.actionUrl ?? "/app/notifications");
  }

  return <div className="min-h-screen bg-sand text-ink">
    <aside className={cn("fixed inset-y-0 left-0 z-30 flex h-dvh w-72 flex-col overflow-hidden border-r border-black/5 bg-white p-5 transition-transform lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex shrink-0 items-center justify-between"><Link to="/app" onClick={() => setOpen(false)}><Logo businessName={businessName} logoUrl={branding?.logoUrl} /></Link><button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X size={20} /></button></div>
      <nav className="min-h-0 flex-1 overflow-y-auto py-8 pr-1" aria-label="Main navigation">{sections.map((section) => <div key={section.label} className="mb-7 last:mb-0"><p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-ink/35">{section.label}</p><div className="space-y-1">{section.items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === "/app"} onClick={() => setOpen(false)} className={({ isActive }) => cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium", isActive ? "bg-pine text-white" : "text-ink/60 hover:bg-sand hover:text-ink")}><Icon size={18} />{label}</NavLink>)}</div></div>)}</nav>
      <div className="mt-4 shrink-0 border-t border-black/5 pt-4"><div className="rounded-2xl bg-sand p-3"><div className="mb-3 flex items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-coral text-sm font-bold text-white">{user?.firstName.slice(0, 1)}</div><div className="min-w-0"><p className="truncate text-sm font-semibold">{user?.firstName} {user?.lastName}</p><p className="text-xs text-ink/50">{role.split("_").join(" ")}</p></div></div><Button variant="ghost" className="flex w-full items-center justify-start gap-2 px-2" onClick={() => void signOut()}><LogOut size={16} /> Sign out</Button></div></div>
    </aside>
    <div className="lg:pl-72">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-black/5 bg-sand/90 px-5 py-4 backdrop-blur lg:px-8"><div className="flex min-w-0 items-center gap-3"><button className="shrink-0 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></button><Link className="min-w-0 lg:hidden" to="/app"><Logo businessName={businessName} logoUrl={branding?.logoUrl} /></Link><p className="hidden text-sm text-ink/50 lg:block">{workspaceLabel}</p></div><div className="flex shrink-0 items-center gap-3">{canBook && <Link to="/app/book" className="hidden rounded-xl bg-lime px-4 py-2 text-sm font-bold text-pine sm:block"><ShoppingBag size={16} className="mr-2 inline" />{isOperations ? "New booking" : "Book a court"}</Link>}
        <div className="static sm:relative"><button type="button" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={notificationsOpen} aria-haspopup="menu" onClick={() => setNotificationsOpen((value) => !value)} className="relative grid h-10 w-10 place-items-center rounded-full text-ink/65 hover:bg-white"><Bell size={19} />{unreadCount > 0 && <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-coral px-1 text-[10px] font-bold text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}</button>
          {notificationsOpen && <div className="absolute inset-x-4 top-[calc(100%+0.5rem)] z-50 flex max-h-[calc(100dvh-5.5rem)] flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-soft sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[340px]"><div className="flex shrink-0 items-center justify-between gap-4 border-b border-black/5 px-4 py-3"><div className="min-w-0"><p className="font-semibold">Notifications</p><p className="text-xs text-ink/45">{unreadCount ? `${unreadCount} unread` : "All caught up"}</p></div><Link to="/app/notifications" onClick={() => setNotificationsOpen(false)} className="shrink-0 text-xs font-semibold text-pine">View all</Link></div><div className="min-h-0 overflow-y-auto sm:max-h-96">{notifications.length ? notifications.slice(0, 6).map((notification) => <button type="button" key={notification.id} onClick={() => void openNotification(notification)} className={`flex w-full items-start gap-3 border-b border-black/5 px-4 py-3 text-left last:border-b-0 hover:bg-sand ${notification.readAt ? "bg-white" : "bg-lime/20"}`}><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${notification.readAt ? "bg-black/10" : "bg-coral"}`} /><span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold leading-5">{notification.title}</span><span className="mt-1 block break-words text-xs leading-5 text-ink/55">{notification.message}</span><span className="mt-1 block text-[10px] text-ink/35">{new Date(notification.createdAt).toLocaleString()}</span></span></button>) : <p className="px-4 py-8 text-center text-sm text-ink/45">No notifications yet.</p>}</div></div>}
        </div><div className="grid h-9 w-9 place-items-center rounded-full bg-pine text-sm font-bold text-white">{user?.firstName.slice(0, 1)}</div></div></header>
      <main className="mx-auto max-w-7xl px-5 py-8 lg:px-8"><Outlet /></main>
    </div>
  </div>;
}
