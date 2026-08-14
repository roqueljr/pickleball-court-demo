export function manilaDateKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

export function isValidCalendarRange(from: Date, to: Date, maximumDays = 62) {
  const rangeMilliseconds = to.getTime() - from.getTime();
  return rangeMilliseconds > 0 && rangeMilliseconds <= maximumDays * 86_400_000;
}
