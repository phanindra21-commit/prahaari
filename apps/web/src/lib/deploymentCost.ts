/**
 * Deployment cost model for the Seva First Innovation Challenge submission
 * ("What is the estimated cost of your solution?").
 *
 * Every number here is an ASSUMPTION the team can edit on the Deployment page,
 * not a quote or a measured value. The defaults reproduce the figures written
 * in the submission: Rs 1.2 lakh hosting + Rs 3 lakh analyst + Rs 4.5 lakh
 * field validation (3 districts) = Rs 8.7 lakh in year one.
 */

export interface CostAssumptions {
  /** Districts covered in the pilot. */
  districts: number;
  /** Cloud hosting, Rs per month for the whole deployment. */
  hostingPerMonth: number;
  /** Part-time GIS / data analyst, Rs per month. */
  analystPerMonth: number;
  /** Months the analyst is engaged in year one. */
  analystMonths: number;
  /** Field validation and survey travel, Rs per district (one-time, year one). */
  fieldValidationPerDistrict: number;
  /** Data refresh + hosting share per district per year after the pilot. */
  recurringPerDistrictPerYear: number;
}

export const DEFAULT_ASSUMPTIONS: CostAssumptions = {
  districts: 3,
  hostingPerMonth: 10_000,
  analystPerMonth: 25_000,
  analystMonths: 12,
  fieldValidationPerDistrict: 150_000,
  recurringPerDistrictPerYear: 150_000,
};

export interface CostBreakdown {
  hosting: number;
  analyst: number;
  fieldValidation: number;
  yearOneTotal: number;
  /** Steady-state yearly cost after the pilot year. */
  recurringPerYear: number;
}

export function computeCost(a: CostAssumptions): CostBreakdown {
  const hosting = a.hostingPerMonth * 12;
  const analyst = a.analystPerMonth * a.analystMonths;
  const fieldValidation = a.fieldValidationPerDistrict * a.districts;
  return {
    hosting,
    analyst,
    fieldValidation,
    yearOneTotal: hosting + analyst + fieldValidation,
    recurringPerYear: a.recurringPerDistrictPerYear * a.districts,
  };
}

/** Indian-style money formatting: Rs 8.7 lakh, Rs 1.2 crore, Rs 4,500. */
export function formatRupees(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  const abs = Math.abs(amount);
  if (abs >= 10_000_000) return `₹${trim(amount / 10_000_000)} crore`;
  if (abs >= 100_000) return `₹${trim(amount / 100_000)} lakh`;
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function trim(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, "");
}
