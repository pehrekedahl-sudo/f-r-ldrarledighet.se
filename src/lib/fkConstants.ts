/**
 * Försäkringskassan (FK) constants for Swedish parental leave benefits.
 * Based on 2025 values.
 */
export const FK = {
  prisbasbelopp: 58800,         // 2025
  sgiTakArslon: 588000,         // 10 × prisbasbelopp (2025)
  ersattningsniva: 0.776,       // 77.6%
  workingDaysPerWeek: 5,
};

/** Keep old name as alias for backwards compat in tests etc. */
export const FK_CONSTANTS = {
  prisbasbelopp: FK.prisbasbelopp,
  sgiTakMultiplier: 10,
  sgiTakPerYear: FK.sgiTakArslon,
  sgiTakPerMonth: Math.round(FK.sgiTakArslon / 12),
  replacementRate: FK.ersattningsniva,
  workingDaysPerYear: 260,
};

export type ParentBenefitInfo = {
  parentId: string;
  annualIncome: number;
  dailySGI: number;
  dailySGICapped: number;
  dailyBenefit: number;
  monthlyBenefitEquivalent: number;
  isAboveTak: boolean;
};

/** Compute FK benefit info for a parent given their monthly income. */
export function computeParentBenefit(parentId: string, monthlyIncomeFixed: number): ParentBenefitInfo {
  const annualIncome = monthlyIncomeFixed * 12;
  const dailySGI = annualIncome / 365;
  const dailySGICapped = Math.min(dailySGI, FK.sgiTakArslon / 365);
  const dailyBenefit = dailySGICapped * FK.ersattningsniva;
  const monthlyBenefitEquivalent = dailyBenefit * (365 / 12);
  const isAboveTak = annualIncome > FK.sgiTakArslon;

  return {
    parentId,
    annualIncome,
    dailySGI,
    dailySGICapped,
    dailyBenefit,
    monthlyBenefitEquivalent,
    isAboveTak,
  };
}

/**
 * Compute per-block monthly FK benefit.
 * Monthly = dailyBenefit × daysPerWeek × (52.18 / 12)
 */
export function computeBlockMonthlyBenefit(monthlyIncomeFixed: number, daysPerWeek: number): number {
  const annualIncome = monthlyIncomeFixed * 12;
  const sgiCapped = Math.min(annualIncome, FK.sgiTakArslon);
  const dailyBenefit = (sgiCapped / 365) * FK.ersattningsniva;
  return dailyBenefit * daysPerWeek * (52.18 / 12);
}
