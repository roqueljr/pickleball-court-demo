import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/Button";
import { usePublicSettings } from "../hooks/usePublicSettings";

export function Login() {
  const { login } = useAuth(); const navigate = useNavigate(); const location = useLocation();
  const businessName = usePublicSettings().data?.businessName ?? "Rally Court Club";
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); setError(""); setBusy(true); try { await login({ email, password }); navigate((location.state as { from?: string } | null)?.from ?? "/app"); } catch (e) { setError(e instanceof Error ? e.message : "Unable to sign in."); } finally { setBusy(false); } }
  return <div className="grid min-h-[calc(100vh-76px)] place-items-center bg-sand px-5 py-14"><div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-soft sm:p-9"><p className="text-sm font-bold uppercase tracking-[.18em] text-pine">Welcome back</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">Sign in to {businessName}</h1><p className="mt-2 text-sm text-ink/55">Manage bookings, memberships, and your next game.</p>{error && <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}<form className="mt-7 space-y-4" onSubmit={submit}><label className="block text-sm font-medium">Email<input className="mt-1.5 w-full rounded-xl border border-black/10 px-3.5 py-3 outline-none focus:border-pine" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><label className="block text-sm font-medium">Password<input className="mt-1.5 w-full rounded-xl border border-black/10 px-3.5 py-3 outline-none focus:border-pine" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label><div className="text-right"><Link className="text-xs font-semibold text-pine" to="/forgot-password">Forgot password?</Link></div><Button className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button></form><p className="mt-6 text-center text-sm text-ink/55">New to {businessName}? <Link className="font-semibold text-pine" to="/register">Create an account</Link></p></div></div>;
}
