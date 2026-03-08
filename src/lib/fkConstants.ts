/**
 * Försäkringskassan (FK) constants for Swedish parental leave benefits.
 * Based on 2025 values.
 */
export const FK_CONSTANTS = {
  prisbasbelopp: 57300,
  sgiTakMultiplier: 10,
  sgiTakPerYear: 573000,       // 10 × 57 300
  sgiTakPerMonth: 47750,       // 573 000 / 12
  replacementRate: 0.776,      // 77.6% of daily SGI
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
  const dailySGICapped = Math.min(dailySGI, FK_CONSTANTS.sgiTakPerYear / 365);
  const dailyBenefit = dailySGICapped * FK_CONSTANTS.replacementRate;
  const monthlyBenefitEquivalent = dailyBenefit * (365 / 12);
  const isAboveTak = annualIncome > FK_CONSTANTS.sgiTakPerYear;

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
