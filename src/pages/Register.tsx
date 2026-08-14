import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/Button";
import { usePublicSettings } from "../hooks/usePublicSettings";

export function Register() {
  const { register } = useAuth(); const navigate = useNavigate(); const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "", phone: "" }); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const businessName = usePublicSettings().data?.businessName ?? "Rally Court Club";
  function update(field: keyof typeof form, value: string) { setForm((current) => ({ ...current, [field]: value })); }
  async function submit(event: React.FormEvent) { event.preventDefault(); setError(""); setBusy(true); try { await register(form); navigate("/app"); } catch (e) { setError(e instanceof Error ? e.message : "Unable to create account."); } finally { setBusy(false); } }
  return <div className="grid min-h-[calc(100vh-76px)] place-items-center bg-sand px-5 py-14"><div className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-soft sm:p-9"><p className="text-sm font-bold uppercase tracking-[.18em] text-pine">Become a member</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">Create your {businessName} account</h1>{error && <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}<form className="mt-7 grid gap-4 sm:grid-cols-2" onSubmit={submit}>{([['firstName','First name','text'],['lastName','Last name','text'],['email','Email','email'],['phone','Phone','tel'],['password','Password','password']] as const).map(([field,label,type]) => <label key={field} className={field === 'password' ? 'block text-sm font-medium sm:col-span-2' : 'block text-sm font-medium'}>{label}<input className="mt-1.5 w-full rounded-xl border border-black/10 px-3.5 py-3 outline-none focus:border-pine" type={type} value={form[field]} onChange={(e) => update(field, e.target.value)} required={field !== 'phone'} minLength={field === 'password' ? 8 : undefined} /></label>)}<Button className="mt-2 sm:col-span-2" disabled={busy}>{busy ? "Creating account…" : "Create account"}</Button></form><p className="mt-6 text-center text-sm text-ink/55">Already have an account? <Link className="font-semibold text-pine" to="/login">Sign in</Link></p></div></div>;
}
