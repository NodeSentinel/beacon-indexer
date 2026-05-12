import type { ValidatorSearchResult } from './use-validator-search';

export type ValidatorItem = {
  id: string;
  type: 'withdrawal' | 'pubkey' | 'index';
  value: string;
  index: number;
  displayName: string;
  withdrawalAddress: string | null;
};

interface MissingValidatorItemsParams {
  currentValidators: ValidatorItem[];
  idPrefix: string;
  searchResults: ValidatorSearchResult[];
}

/** Sorts validator items by index from highest to lowest. */
export function sortValidatorsDescending(validators: ValidatorItem[]): ValidatorItem[] {
  return [...validators].sort((a, b) => b.index - a.index);
}

/** Builds validator items for search results that are not already in the cluster. */
export function getMissingValidatorItems({
  currentValidators,
  idPrefix,
  searchResults,
}: MissingValidatorItemsParams): ValidatorItem[] {
  const currentIndexes = new Set(currentValidators.map((validator) => validator.index));

  return sortValidatorsDescending(
    searchResults
      .filter((result) => !currentIndexes.has(result.index))
      .map((result, index) => ({
        id: `${idPrefix}-${index}`,
        type: 'index' as const,
        value: result.index.toString(),
        index: result.index,
        displayName: `Validator #${result.index}`,
        withdrawalAddress: result.withdrawalAddress,
      })),
  );
}
