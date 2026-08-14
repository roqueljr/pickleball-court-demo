import { CircleDot } from "lucide-react";

export function Logo({ businessName = "Rally Court Club", logoUrl = "" }: { businessName?: string; logoUrl?: string }) {
  return <div className="flex items-center gap-2 font-semibold tracking-tight text-ink" title={businessName}>{logoUrl ? <img className="h-9 w-9 shrink-0 rounded-xl object-cover" src={logoUrl} alt="" width={36} height={36} /> : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-lime text-pine"><CircleDot size={20} /></span>}<span className="max-w-28 truncate sm:max-w-56">{businessName}</span></div>;
}
