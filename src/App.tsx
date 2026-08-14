import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { PublicLayout } from "./layouts/PublicLayout";
import { AppLayout } from "./layouts/AppLayout";
import type { Role } from "./types";
import { CUSTOMER_BOOKING_ROLES } from "./lib/roles";

const Home = lazy(() => import("./pages/Home").then((module) => ({ default: module.Home })));
const Login = lazy(() => import("./pages/Login").then((module) => ({ default: module.Login })));
const Register = lazy(() => import("./pages/Register").then((module) => ({ default: module.Register })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((module) => ({ default: module.Dashboard })));
const Courts = lazy(() => import("./pages/Courts").then((module) => ({ default: module.Courts })));
const BookCourt = lazy(() => import("./pages/BookCourt").then((module) => ({ default: module.BookCourt })));
const Bookings = lazy(() => import("./pages/Bookings").then((module) => ({ default: module.Bookings })));
const CourtManagement = lazy(() => import("./pages/CourtManagement").then((module) => ({ default: module.CourtManagement })));
const Customers = lazy(() => import("./pages/Customers").then((module) => ({ default: module.Customers })));
const Payments = lazy(() => import("./pages/Payments").then((module) => ({ default: module.Payments })));
const Memberships = lazy(() => import("./pages/Memberships").then((module) => ({ default: module.Memberships })));
const Promotions = lazy(() => import("./pages/Promotions").then((module) => ({ default: module.Promotions })));
const Calendar = lazy(() => import("./pages/Calendar").then((module) => ({ default: module.Calendar })));
const Coaching = lazy(() => import("./pages/Coaching").then((module) => ({ default: module.Coaching })));
const Equipment = lazy(() => import("./pages/Equipment").then((module) => ({ default: module.Equipment })));
const Products = lazy(() => import("./pages/Products").then((module) => ({ default: module.Products })));
const Expenses = lazy(() => import("./pages/Expenses").then((module) => ({ default: module.Expenses })));
const Reports = lazy(() => import("./pages/Reports").then((module) => ({ default: module.Reports })));
const Notifications = lazy(() => import("./pages/Notifications").then((module) => ({ default: module.Notifications })));
const CheckIn = lazy(() => import("./pages/CheckIn").then((module) => ({ default: module.CheckIn })));
const UserManagement = lazy(() => import("./pages/UserManagement").then((module) => ({ default: module.UserManagement })));
const Settings = lazy(() => import("./pages/Settings").then((module) => ({ default: module.Settings })));
const AuditLogs = lazy(() => import("./pages/AuditLogs").then((module) => ({ default: module.AuditLogs })));
const Profile = lazy(() => import("./pages/Profile").then((module) => ({ default: module.Profile })));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword").then((module) => ({ default: module.ForgotPassword })));
const ResetPassword = lazy(() => import("./pages/ResetPassword").then((module) => ({ default: module.ResetPassword })));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail").then((module) => ({ default: module.VerifyEmail })));
const About = lazy(() => import("./pages/PublicInfo").then((module) => ({ default: module.About })));
const Contact = lazy(() => import("./pages/PublicInfo").then((module) => ({ default: module.Contact })));
const FAQ = lazy(() => import("./pages/PublicInfo").then((module) => ({ default: module.FAQ })));
const PublicCoaches = lazy(() => import("./pages/PublicInfo").then((module) => ({ default: module.PublicCoaches })));
const CoachManagement = lazy(() => import("./pages/CoachManagement").then((module) => ({ default: module.CoachManagement })));
const EquipmentManagement = lazy(() => import("./pages/EquipmentManagement").then((module) => ({ default: module.EquipmentManagement })));
const ProductManagement = lazy(() => import("./pages/ProductManagement").then((module) => ({ default: module.ProductManagement })));
const Events = lazy(() => import("./pages/Events").then((module) => ({ default: module.Events })));
const TournamentDetails = lazy(() => import("./pages/Events").then((module) => ({ default: module.TournamentDetails })));
const TournamentManagement = lazy(() => import("./pages/TournamentManagement").then((module) => ({ default: module.TournamentManagement })));
const Growth = lazy(() => import("./pages/Growth").then((module) => ({ default: module.Growth })));
const PublicPlay = lazy(() => import("./pages/PublicPlay").then((module) => ({ default: module.PublicPlay })));
const GuestBooking = lazy(() => import("./pages/GuestBooking").then((module) => ({ default: module.GuestBooking })));

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

function Protected() { const { user, isLoading } = useAuth(); const location = useLocation(); if (isLoading) return <div className="grid min-h-screen place-items-center bg-sand text-ink/50">Loading Rally…</div>; return user ? <Outlet /> : <Navigate to="/login" replace state={{ from: location.pathname }} />; }

function VerifiedEmailRequired() { const { user, refreshAuth } = useAuth(); const [checking, setChecking] = useState(false); const isCustomer = Boolean(user && user.roles.includes("CUSTOMER") && !user.roles.some((role) => ["SUPER_ADMIN", "ADMIN", "STAFF", "COACH"].includes(role))); useEffect(() => { if (!isCustomer || user?.emailVerified) return; setChecking(true); void refreshAuth().finally(() => setChecking(false)); }, [isCustomer, refreshAuth, user?.emailVerified]); if (!user || !isCustomer || user.emailVerified) return <Outlet />; if (checking) return <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 text-center text-sm text-ink/55 shadow-sm sm:p-12">Checking your email verification status…</div>; return <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 text-center shadow-sm sm:p-12"><div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-lime text-pine">✉</div><p className="mt-6 text-sm font-bold uppercase tracking-[.18em] text-pine">Email verification required</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Verify your email before booking</h1><p className="mx-auto mt-3 max-w-lg text-ink/55">Please verify your email address first. We use it to send booking confirmations, changes, and payment updates.</p><Link className="mt-7 inline-block rounded-xl bg-pine px-5 py-3 text-sm font-semibold text-white" to="/app/profile">Go to email verification</Link></div>; }

function RoleRequired({ allowed }: { allowed: Role[] }) {
  const { user } = useAuth();
  if (user?.roles.some((role) => allowed.includes(role))) return <Outlet />;
  return <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 text-center shadow-sm sm:p-12"><p className="text-sm font-bold uppercase tracking-[.18em] text-pine">Access restricted</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">This page is not part of your workspace.</h1><p className="mx-auto mt-3 max-w-lg text-ink/55">Your account is active, but this feature belongs to another role. Return to your overview to continue.</p><Link className="mt-7 inline-block rounded-xl bg-pine px-5 py-3 text-sm font-semibold text-white" to="/app">Back to overview</Link></div>;
}

export default function App() {
  return <QueryClientProvider client={queryClient}><AuthProvider><BrowserRouter><Suspense fallback={<div className="grid min-h-screen place-items-center bg-sand text-sm text-ink/50">Loading Rally…</div>}><Routes>
    <Route element={<PublicLayout />}>
      <Route path="/" element={<Home />} /><Route path="/play" element={<PublicPlay />} /><Route path="/guest-book" element={<GuestBooking />} /><Route path="/events" element={<Events />} /><Route path="/events/:slug" element={<TournamentDetails />} />
      <Route path="/about" element={<About />} /><Route path="/courts" element={<Courts />} /><Route path="/memberships" element={<Memberships />} /><Route path="/coaches" element={<PublicCoaches />} /><Route path="/contact" element={<Contact />} /><Route path="/faq" element={<FAQ />} /><Route path="/login" element={<Login />} /><Route path="/register" element={<Register />} /><Route path="/forgot-password" element={<ForgotPassword />} /><Route path="/reset-password" element={<ResetPassword />} /><Route path="/verify-email" element={<VerifyEmail />} />
    </Route>
    <Route element={<Protected />}><Route path="/app" element={<AppLayout />}>
      <Route index element={<Dashboard />} />
      <Route element={<RoleRequired allowed={CUSTOMER_BOOKING_ROLES} />}><Route element={<VerifiedEmailRequired />}><Route path="book" element={<BookCourt />} /><Route path="bookings" element={<Bookings />} /></Route></Route>
      <Route element={<RoleRequired allowed={["SUPER_ADMIN", "ADMIN", "STAFF", "CUSTOMER"]} />}><Route element={<VerifiedEmailRequired />}><Route path="growth" element={<Growth />} /></Route></Route>
      <Route element={<RoleRequired allowed={["SUPER_ADMIN", "ADMIN", "STAFF"]} />}><Route path="customers" element={<Customers />} /><Route path="calendar" element={<Calendar />} /><Route path="equipment-inventory" element={<EquipmentManagement />} /><Route path="pos" element={<Products />} /><Route path="check-in" element={<CheckIn />} /></Route>
      <Route element={<RoleRequired allowed={["SUPER_ADMIN", "ADMIN"]} />}><Route path="courts" element={<CourtManagement />} /><Route path="coaches" element={<CoachManagement />} /><Route path="promotions" element={<Promotions />} /><Route path="reports" element={<Reports />} /><Route path="expenses" element={<Expenses />} /><Route path="products" element={<ProductManagement />} /><Route path="users" element={<UserManagement />} /><Route path="audit-logs" element={<AuditLogs />} /><Route path="settings" element={<Settings />} /><Route path="tournaments" element={<TournamentManagement />} /></Route>
      <Route element={<RoleRequired allowed={["SUPER_ADMIN", "ADMIN", "CUSTOMER"]} />}><Route path="memberships" element={<Memberships />} /></Route>
      <Route element={<RoleRequired allowed={["SUPER_ADMIN", "ADMIN", "STAFF", "CUSTOMER"]} />}><Route path="payments" element={<Payments />} /></Route>
      <Route element={<RoleRequired allowed={["CUSTOMER"]} />}><Route path="equipment" element={<Equipment />} /></Route>
      <Route element={<RoleRequired allowed={["CUSTOMER", "SUPER_ADMIN", "ADMIN", "STAFF", "COACH"]} />}><Route path="coaching" element={<Coaching />} /><Route path="notifications" element={<Notifications />} /><Route path="profile" element={<Profile />} /></Route>
    </Route></Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense></BrowserRouter></AuthProvider></QueryClientProvider>;
}
