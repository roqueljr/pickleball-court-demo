import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { apiFetch } from "../lib/api";
import type { Notification } from "../types";

function destination(notification: Notification) { return notification.actionUrl ?? ({ BOOKING: "/app/bookings", PAYMENT: "/app/payments", MEMBERSHIP: "/app/memberships", PROMOTION: "/app/promotions", SCHEDULE: "/app/calendar", SYSTEM: "/app" }[notification.type] ?? "/app/notifications"); }

export function Notifications() {
  const client = useQueryClient(); const navigate = useNavigate();
  const query = useQuery({ queryKey: ["notifications"], queryFn: () => apiFetch<{ notifications: Notification[]; unreadCount: number }>("/api/notifications") });
  const readAll = useMutation({ mutationFn: () => apiFetch("/api/notifications/read-all", { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["notifications"] }) });
  const read = useMutation({ mutationFn: (id: string) => apiFetch(`/api/notifications/${id}/read`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["notifications"] }) });
  async function openNotification(notification: Notification) { if (!notification.readAt) await read.mutateAsync(notification.id); navigate(destination(notification)); }
  return <div><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-bold uppercase tracking-[.18em] text-pine">Stay in the loop</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Notifications</h1><p className="mt-2 text-ink/55">Booking, payment, membership, and club updates.</p></div><Button variant="ghost" onClick={() => void readAll.mutateAsync()}><Check className="mr-1 inline" size={16} />Mark all read</Button></div><div className="mt-6 space-y-3">{query.data?.notifications.length ? query.data.notifications.map((notification) => <button type="button" key={notification.id} className={`flex w-full items-start gap-4 rounded-2xl p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${notification.readAt ? "bg-white" : "bg-lime/40"}`} onClick={() => void openNotification(notification)}><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-pine text-white"><Bell size={18} /></div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><p className="font-semibold">{notification.title}</p><ChevronRight className="mt-0.5 shrink-0 text-ink/30" size={17} /></div><p className="mt-1 text-sm text-ink/60">{notification.message}</p><p className="mt-2 text-xs text-ink/40">{new Date(notification.createdAt).toLocaleString()} · Tap to open</p></div></button>) : <div className="rounded-3xl bg-white p-10 text-center shadow-sm"><p className="font-semibold">You’re all caught up.</p><p className="mt-2 text-sm text-ink/50">New updates will appear here.</p></div>}</div></div>;
}
