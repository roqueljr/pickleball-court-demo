import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function Button({ className, variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return <button className={cn("rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50", variant === "primary" && "bg-pine text-white hover:bg-ink", variant === "secondary" && "bg-lime text-pine hover:bg-[#cbed3f]", variant === "ghost" && "text-ink hover:bg-sand", className)} {...props} />;
}
