export const paymentMethods = ["GCASH", "BANK_TRANSFER", "CARD", "ONLINE_PAYMENT", "CASH"] as const;
export const paymentLabel = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
export const money = (value: number) => `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
export const dateTime = (value: string) => new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
export const statusLabel = (value: string) => value.replaceAll("_", " ");
export function Status({ value }: { value: string }) { return <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${["ACTIVE", "PAID", "CONFIRMED", "CLAIMED", "COMPLETED"].includes(value) ? "bg-lime/70 text-pine" : ["CANCELLED", "EXPIRED", "PAUSED", "FAILED"].includes(value) ? "bg-red-50 text-red-700" : "bg-sand text-ink/55"}`}>{statusLabel(value)}</span>; }
