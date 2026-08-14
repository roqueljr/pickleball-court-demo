import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../components/Button";
import { apiFetch, ApiError } from "../lib/api";

export function VerifyEmail() {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const [token, setToken] = useState(params.get("token") ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const verify = useCallback(async (value: string) => {
    setError("");
    try {
      const data = await apiFetch<{ message: string }>("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token: value }) });
      setMessage(data.message);
      setToken("");
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      window.history.replaceState({}, "", "/verify-email");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Unable to verify email.");
    }
  }, [queryClient]);

  useEffect(() => {
    if (token) void verify(token);
  }, [token, verify]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await verify(token);
  }

  return <div className="grid min-h-[calc(100vh-76px)] place-items-center bg-sand px-5 py-14"><div className="w-full max-w-md rounded-3xl bg-white p-7 text-center shadow-soft sm:p-9"><div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-lime text-pine"><CheckCircle2 /></div><h1 className="mt-5 text-3xl font-semibold tracking-tight">Verify your email</h1><p className="mt-2 text-sm text-ink/55">Use the secure link in your email to activate this email address.</p>{!message && !error && token && <div className="mt-5 rounded-xl bg-sand px-4 py-3 text-sm text-ink/60">Verifying your email…</div>}{message && <div className="mt-5 rounded-xl bg-lime/50 px-4 py-3 text-sm text-pine">{message}</div>}{error && <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}{!message && !token && <form className="mt-6 space-y-4" onSubmit={submit}><p className="text-left text-xs text-ink/45">Open the latest verification link from your email to continue.</p><Button className="w-full" disabled>Verify email</Button></form>}<Link className="mt-6 inline-block text-sm font-semibold text-pine" to="/login">Back to sign in</Link></div></div>;
}
