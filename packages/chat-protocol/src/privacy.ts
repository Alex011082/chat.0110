export const PRIVACY_CATEGORIES = ["SECRET", "EMAIL", "PHONE", "DOCUMENT", "CARD", "BANK_ACCOUNT", "PERSON", "ADDRESS"] as const;
export type PrivacyCategory = (typeof PRIVACY_CATEGORIES)[number];
export interface PrivacyResult { text: string; counts: Partial<Record<PrivacyCategory, number>> }

/** Маркеры остаются в Git, поэтому отметка работает и после перезагрузки. */
export function privacyCounts(text: string): PrivacyResult["counts"] {
  const counts: PrivacyResult["counts"] = {};
  for (const match of text.matchAll(/\[(SECRET|EMAIL|PHONE|DOCUMENT|CARD|BANK_ACCOUNT|PERSON|ADDRESS)_\d+\]/g)) {
    const category = match[1] as PrivacyCategory;
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
}
