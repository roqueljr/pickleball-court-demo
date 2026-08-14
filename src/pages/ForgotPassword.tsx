import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { apiFetch, ApiError } from "../lib/api";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const data = await apiFetch<{ message: string }>("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
      setMessage(data.message);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Unable to request password reset.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid min-h-[calc(100vh-76px)] place-items-center bg-sand px-5 py-14"><div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-soft sm:p-9"><p className="text-sm font-bold uppercase tracking-[.18em] text-pine">Account recovery</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">Reset your password</h1><p className="mt-2 text-sm text-ink/55">Enter your account email and we&apos;ll generate a reset link.</p>{message && <div className="mt-5 rounded-xl bg-lime/50 px-4 py-3 text-sm text-pine">{message}</div>}{error && <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}<form className="mt-7 space-y-4" onSubmit={submit}><label className="block text-sm font-medium">Email<input className="mt-1.5 w-full rounded-xl border border-black/10 px-3.5 py-3" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><Button className="w-full" disabled={busy}>{busy ? "Sending…" : "Request reset"}</Button></form><p className="mt-4 text-center text-xs text-ink/45">If the account exists, a reset link will be sent to its email address.</p><p className="mt-6 text-center text-sm text-ink/55"><Link className="font-semibold text-pine" to="/login">Back to sign in</Link></p></div></div>;
}
