import { isAddress, isHex, size } from 'viem';

export type ValidatorSearchCategory = 'index' | 'pubkey' | 'withdrawalAddress' | 'lidoCsm';

export interface ParsedValidatorSearchInput {
  type: ValidatorSearchCategory;
  values: string[];
  invalidValues: string[];
}

/** Checks whether a value is valid for the selected validator search category. */
function isValidForCategory(value: string, category: ValidatorSearchCategory): boolean {
  if (category === 'index' || category === 'lidoCsm') {
    return /^\d+$/.test(value);
  }

  if (category === 'pubkey') {
    return isHex(value, { strict: true }) && size(value) === 48;
  }

  return isAddress(value);
}

/** Parses comma-separated validator search values for the selected category. */
export function parseValidatorSearchInput(
  input: string,
  category: ValidatorSearchCategory,
): ParsedValidatorSearchInput | null {
  const parts = input
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (parts.length === 0) {
    return null;
  }

  // Only one CMS Lido ID is allowed
  if (category === 'lidoCsm' && parts.length !== 1) {
    return {
      type: category,
      values: [],
      invalidValues: parts,
    };
  }

  return {
    type: category,
    values: parts.filter((value) => isValidForCategory(value, category)),
    invalidValues: parts.filter((value) => !isValidForCategory(value, category)),
  };
}
