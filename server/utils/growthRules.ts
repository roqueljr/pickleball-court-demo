export type PricingRuleCandidate = {
  courtId: string | null;
  adjustmentPercent: unknown;
  minimumLeadHours: number | null;
  maximumLeadHours: number | null;
};

export function selectPricingRule<T extends PricingRuleCandidate>(rules: T[], leadHours: number) {
  return rules
    .filter((rule) => (rule.minimumLeadHours === null || leadHours >= rule.minimumLeadHours) && (rule.maximumLeadHours === null || leadHours <= rule.maximumLeadHours))
    .sort((left, right) => Number(Boolean(right.courtId)) - Number(Boolean(left.courtId)) || Math.abs(Number(right.adjustmentPercent)) - Math.abs(Number(left.adjustmentPercent)))[0] ?? null;
}

export function calculateCreditCheckout(total: number, walletBalance: number, requestedWallet: number, hasPackageCredit: boolean) {
  if (hasPackageCredit) return { walletApplied: 0, amountDue: 0 };
  const walletApplied = Math.min(Math.max(0, requestedWallet), Math.max(0, walletBalance), Math.max(0, total));
  const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  return { walletApplied: roundMoney(walletApplied), amountDue: roundMoney(Math.max(0, total - walletApplied)) };
}

export function calculateLocalRatingUpdate(homeRating: number, awayRating: number, homeWon: boolean) {
  const expectedHome = 1 / (1 + 10 ** ((awayRating - homeRating) / 1.5));
  const change = 0.12 * ((homeWon ? 1 : 0) - expectedHome);
  return {
    home: Math.min(8, Math.max(1, homeRating + change)),
    away: Math.min(8, Math.max(1, awayRating - change))
  };
}
