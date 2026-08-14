import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarCheck2, ShieldCheck, Sparkles, Trophy, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api";
import type { Tournament } from "../types";
import { usePublicSettings } from "../hooks/usePublicSettings";

export function Home() {
  const settings = usePublicSettings().data;
  const businessName = settings?.businessName ?? "Rally Court Club";
  const featured = useQuery({
    queryKey: ["featured-tournament"],
    queryFn: () => apiFetch<{ tournament: Tournament | null }>("/api/tournaments/featured"),
  });
  const tournament = featured.data?.tournament;

  return (
    <main>
      <section className="overflow-hidden bg-sand">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:px-8 lg:py-28">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-lime/60 px-3 py-1.5 text-xs font-bold uppercase tracking-[.18em] text-pine">
              <Sparkles size={14} /> Your next rally
            </div>
            <h1 className="max-w-2xl text-5xl font-semibold leading-[.98] tracking-[-.05em] text-ink sm:text-6xl lg:text-7xl">
              Play sharper.<br /><span className="text-pine">Stay longer.</span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-ink/60">
              {businessName} is built for early-morning games, after-work rallies, and the community in between.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link className="rounded-xl bg-pine px-5 py-3 font-semibold text-white" to="/register">
                Start playing <ArrowRight className="ml-1 inline" size={17} />
              </Link>
              <Link className="rounded-xl border border-ink/10 bg-white px-5 py-3 font-semibold text-ink" to="/courts">
                Explore courts
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap gap-6 text-sm text-ink/60">
              <span><ShieldCheck className="mr-2 inline text-pine" size={17} />Secure bookings</span>
              <span><CalendarCheck2 className="mr-2 inline text-pine" size={17} />Real-time availability</span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-lime/60 blur-3xl" />
            <div className="relative overflow-hidden rounded-[2rem] bg-pine p-3 shadow-soft">
              <img
                className="h-[420px] w-full rounded-[1.5rem] object-cover object-center"
                src="/images/pickleball-hero-incoming-v4.webp"
                alt="Back-facing pickleball player preparing to return an incoming ball on a premium indoor court"
                width={1536}
                height={1024}
                fetchPriority="high"
                decoding="async"
              />
              <div className="absolute bottom-8 left-8 rounded-2xl bg-white/95 p-4 shadow-soft">
                <p className="text-xs uppercase tracking-[.18em] text-ink/50">Open today</p>
                <p className="mt-1 text-xl font-semibold">{settings?.businessHours ?? "Daily 6:00 AM–10:00 PM"}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {tournament && (
        <section className="mx-auto max-w-7xl px-5 py-10 lg:px-8">
          <div className="overflow-hidden rounded-[2rem] bg-pine text-white shadow-soft">
            <div className="grid gap-8 p-7 sm:p-10 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-lime px-3 py-1.5 text-xs font-bold uppercase tracking-[.16em] text-pine">
                  <Trophy size={14} /> Featured tournament
                </div>
                <h2 className="mt-5 max-w-2xl text-3xl font-semibold sm:text-4xl">{tournament.title}</h2>
                <p className="mt-3 max-w-2xl leading-7 text-white/70">{tournament.description}</p>
                <div className="mt-5 flex flex-wrap gap-5 text-sm text-white/75">
                  <span>
                    <CalendarCheck2 className="mr-2 inline text-lime" size={16} />
                    {new Date(tournament.startsAt).toLocaleDateString("en-PH", { dateStyle: "medium" })}
                  </span>
                  <span><Users className="mr-2 inline text-lime" size={16} />Register solo or as a team</span>
                </div>
              </div>
              <Link
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-lime px-5 py-3 font-bold text-pine"
                to={`/events/${tournament.slug}`}
              >
                Register now <ArrowRight size={17} />
              </Link>
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-16 md:grid-cols-3 lg:px-8">
        <div className="rounded-3xl bg-pine p-7 text-white">
          <p className="text-4xl font-semibold">4</p>
          <p className="mt-2 text-white/70">Pro-grade courts</p>
        </div>
        <div className="rounded-3xl bg-lime p-7 text-pine">
          <p className="text-4xl font-semibold">6AM</p>
          <p className="mt-2 text-pine/70">First serve every day</p>
        </div>
        <div className="rounded-3xl bg-sand p-7">
          <p className="text-4xl font-semibold">1 club</p>
          <p className="mt-2 text-ink/60">Built around your game</p>
        </div>
      </section>
    </main>
  );
}
