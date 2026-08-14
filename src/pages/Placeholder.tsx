import { Link, useLocation } from "react-router-dom";

export function Placeholder() {
  const location = useLocation(); const name = location.pathname.split("/").filter(Boolean).at(-1)?.replaceAll("-", " ") ?? "module";
  return <div className="rounded-3xl bg-white p-8 shadow-sm"><p className="text-sm font-bold uppercase tracking-[.18em] text-pine">Phase 1 foundation</p><h1 className="mt-2 text-3xl font-semibold capitalize">{name}</h1><p className="mt-3 max-w-2xl text-ink/55">This route is wired into the role-aware application shell. Its database-backed workflow will be delivered in the corresponding implementation phase.</p><Link className="mt-6 inline-block rounded-xl bg-pine px-4 py-3 text-sm font-semibold text-white" to="/app">Return to overview</Link></div>;
}
