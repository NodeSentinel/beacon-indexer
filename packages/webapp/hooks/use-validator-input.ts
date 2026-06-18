'use client';

import { useMemo, useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import {
  getMissingValidatorItems,
  parseSavedLidoCsmOperatorId,
  sortValidatorsDescending,
  type ValidatorItem,
} from '@/hooks/use-validator-input-utils';
import {
  useGetValidatorsFromLidoCsmOperatorId,
  useGetValidatorsFromWithdrawalAddresses,
  useSearchByIndex,
  useSearchByIndexes,
  useSearchByLidoCsmOperatorId,
  useSearchByPubkey,
  useSearchByPubkeys,
  useSearchByWithdrawalAddress,
  useSearchByWithdrawalAddresses,
} from '@/hooks/use-validator-search';
import {
  getDefaultValidatorSearchCategory,
  parseValidatorSearchInput,
  type ValidatorSearchCategory,
} from '@/lib/validator-search-input';

export type { ValidatorItem };

export type ValidationState = 'idle' | 'validating' | 'valid' | 'invalid';

export type BulkAction = {
  action: 'add' | 'remove';
  withdrawalAddress: string;
  validatorCount: number;
  validators: ValidatorItem[];
  lidoCsmOperatorId?: number;
} | null;

const BULK_ADD_THRESHOLD = 10;

interface UseValidatorInputProps {
  chain: 'gnosis' | 'ethereum';
  validators: ValidatorItem[];
  onValidatorsChange: (validators: ValidatorItem[]) => void;
  currentLidoCsmOperatorId?: string | null;
  withdrawalAddresses?: string[];
}

/**
 * Hook for managing validator input and selection.
 *
 * Handles adding validators by index, public key, or withdrawal address.
 * Supports bulk operations with comma-separated values.
 * Groups validators by their actual withdrawal address.
 */
export function useValidatorInput({
  chain,
  currentLidoCsmOperatorId,
  onValidatorsChange,
  validators,
  withdrawalAddresses: knownWithdrawalAddresses = [],
}: UseValidatorInputProps) {
  const { toast } = useToast();

  // Core state
  const [inputValue, setInputValue] = useState('');
  const [validationState, setValidationState] = useState<ValidationState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [bulkAction, setBulkAction] = useState<BulkAction>(null);
  const [lidoCsmOperatorId, setLidoCsmOperatorId] = useState<number | undefined>(undefined);
  const [lidoCsmValidatorIndexes, setLidoCsmValidatorIndexes] = useState<number[]>([]);
  const [selectedSearchCategory, setSelectedSearchCategory] = useState<ValidatorSearchCategory>(
    () => getDefaultValidatorSearchCategory(chain),
  );

  // Track withdrawal addresses discovered when adding validators by index/pubkey
  // These are addresses not in knownWithdrawalAddresses but found from validators added
  const [discoveredWithdrawalAddresses, setDiscoveredWithdrawalAddresses] = useState<string[]>([]);

  // Search hooks (single)
  const searchByIndex = useSearchByIndex();
  const searchByPubkey = useSearchByPubkey();
  const searchByWithdrawal = useSearchByWithdrawalAddress();
  const searchByLidoCsmOperatorId = useSearchByLidoCsmOperatorId();

  // Search hooks (bulk)
  const searchByIndexes = useSearchByIndexes();
  const searchByPubkeys = useSearchByPubkeys();
  const searchByWithdrawalAddresses = useSearchByWithdrawalAddresses();

  const savedLidoCsmOperatorId = parseSavedLidoCsmOperatorId(currentLidoCsmOperatorId);
  const trackedLidoCsmOperatorId = lidoCsmOperatorId ?? savedLidoCsmOperatorId;

  const { validators: validatorsByLidoCsmOperator } =
    useGetValidatorsFromLidoCsmOperatorId(trackedLidoCsmOperatorId);

  // Combine known and discovered withdrawal addresses for fetching all validators
  const allWithdrawalAddressesToFetch = useMemo(() => {
    const combined = new Set([
      ...knownWithdrawalAddresses.map((a) => a.toLowerCase()),
      ...discoveredWithdrawalAddresses.map((a) => a.toLowerCase()),
    ]);
    return [...combined];
  }, [knownWithdrawalAddresses, discoveredWithdrawalAddresses]);

  // Fetch validators for all withdrawal addresses (known + discovered)
  const { validatorsByWithdrawalAddress } = useGetValidatorsFromWithdrawalAddresses(
    allWithdrawalAddressesToFetch,
  );

  // Compute all unique withdrawal addresses from current validators
  const allWithdrawalAddresses = useMemo(() => {
    const addresses = new Set<string>();
    for (const v of validators) {
      if (v.withdrawalAddress) {
        addresses.add(v.withdrawalAddress.toLowerCase());
      }
    }
    return [...addresses].sort();
  }, [validators]);

  // Compute validatorsByAddress and missingValidatorsByAddress
  const { missingValidatorsByAddress, validatorsByAddress } = useMemo(() => {
    const byAddress: Record<string, ValidatorItem[]> = {};
    const missing: Record<string, ValidatorItem[]> = {};

    // Group current validators by their withdrawal address
    for (const validator of validators) {
      const addr = validator.withdrawalAddress?.toLowerCase();
      if (addr) {
        if (!byAddress[addr]) {
          byAddress[addr] = [];
        }
        byAddress[addr].push(validator);
      }
    }

    // Sort each group descending
    for (const addr of Object.keys(byAddress)) {
      byAddress[addr] = sortValidatorsDescending(byAddress[addr]);
    }

    // Calculate missing validators for all known + discovered addresses
    for (const address of allWithdrawalAddressesToFetch) {
      const lowerAddr = address.toLowerCase();
      const results = validatorsByWithdrawalAddress[address] || [];

      const missingForAddress = getMissingValidatorItems({
        currentValidators: validators,
        idPrefix: `missing-${lowerAddr}`,
        searchResults: results,
      });

      if (missingForAddress.length > 0) {
        missing[lowerAddr] = sortValidatorsDescending(missingForAddress);
      }
    }

    return { validatorsByAddress: byAddress, missingValidatorsByAddress: missing };
  }, [validatorsByWithdrawalAddress, validators, allWithdrawalAddressesToFetch]);

  const missingLidoCsmValidators = useMemo(() => {
    if (trackedLidoCsmOperatorId === undefined) {
      return [];
    }

    return getMissingValidatorItems({
      currentValidators: validators,
      idPrefix: `missing-lido-csm-${trackedLidoCsmOperatorId}`,
      searchResults: validatorsByLidoCsmOperator,
    });
  }, [trackedLidoCsmOperatorId, validators, validatorsByLidoCsmOperator]);

  const currentLidoCsmValidatorCount = useMemo(() => {
    const currentIndexes = new Set(validators.map((validator) => validator.index));
    return validatorsByLidoCsmOperator.filter((validator) => currentIndexes.has(validator.index))
      .length;
  }, [validators, validatorsByLidoCsmOperator]);

  const isSearching =
    searchByIndex.isPending ||
    searchByIndexes.isPending ||
    searchByPubkey.isPending ||
    searchByPubkeys.isPending ||
    searchByWithdrawal.isPending ||
    searchByWithdrawalAddresses.isPending ||
    searchByLidoCsmOperatorId.isPending;

  const handleAddValidator = async () => {
    if (!inputValue.trim()) return;

    setValidationState('validating');
    setErrorMessage('');

    const trimmed = inputValue.trim();

    try {
      // Parse input according to the selected search category.
      const parsed = parseValidatorSearchInput(trimmed, selectedSearchCategory);

      if (!parsed) {
        setValidationState('invalid');
        setErrorMessage('Enter a validator search value');
        return;
      }

      // Reject invalid values before making any API request.
      if (parsed.invalidValues.length > 0) {
        setValidationState('invalid');
        setErrorMessage(`Invalid values: ${parsed.invalidValues.join(', ')}`);
        return;
      }

      const existingIndexes = new Set(validators.map((v) => v.index));
      let foundValidators: Array<{
        index: number;
        pubkey: string | null;
        withdrawalAddress: string | null;
      }> = [];
      let notFoundCount = 0;
      let foundLidoCsmOperatorId: number | undefined;

      // Handle indexes
      if (parsed.type === 'index') {
        const indexes = parsed.values.map((v) => parseInt(v, 10));

        if (indexes.length === 1) {
          const result = await searchByIndex.mutateAsync(indexes[0]);
          if (result) {
            foundValidators = [result];
          } else {
            notFoundCount = 1;
          }
        } else {
          const results = await searchByIndexes.mutateAsync(indexes);
          const foundIndexes = new Set(results.map((r) => r.index));
          notFoundCount = indexes.filter((i) => !foundIndexes.has(i)).length;
          foundValidators = results;
        }
      }

      // Handle pubkeys
      if (parsed.type === 'pubkey') {
        if (parsed.values.length === 1) {
          const result = await searchByPubkey.mutateAsync(parsed.values[0]);
          if (result) {
            foundValidators = [result];
          } else {
            notFoundCount = 1;
          }
        } else {
          const results = await searchByPubkeys.mutateAsync(parsed.values);
          const foundPubkeys = new Set(results.map((r) => r.pubkey));
          notFoundCount = parsed.values.filter((p) => !foundPubkeys.has(p)).length;
          foundValidators = results;
        }
      }

      // Handle withdrawal addresses
      if (parsed.type === 'withdrawalAddress') {
        if (parsed.values.length === 1) {
          foundValidators = await searchByWithdrawal.mutateAsync(parsed.values[0]);
        } else {
          foundValidators = await searchByWithdrawalAddresses.mutateAsync(parsed.values);
        }

        if (foundValidators.length === 0) {
          setValidationState('invalid');
          setErrorMessage('No validators found for the provided address(es)');
          return;
        }
      }

      // Handle Lido CSM operator ids
      if (parsed.type === 'lidoCsm') {
        const operatorId = parseInt(parsed.values[0], 10);
        foundValidators = await searchByLidoCsmOperatorId.mutateAsync(operatorId);
        foundLidoCsmOperatorId = operatorId;

        if (foundValidators.length === 0) {
          setValidationState('invalid');
          setErrorMessage('No validators found for the provided Lido CSM operator');
          return;
        }
      }

      // Filter out already existing validators (silently, no error)
      const newValidators = foundValidators
        .filter((r) => !existingIndexes.has(r.index))
        .map((r, i) => ({
          id: `${Date.now()}-${i}`,
          type: 'index' as const,
          value: r.index.toString(),
          index: r.index,
          displayName: `Validator #${r.index}`,
          withdrawalAddress: r.withdrawalAddress,
        }));

      const skippedCount = foundValidators.length - newValidators.length;

      // Check if we have new validators to add
      if (newValidators.length === 0) {
        if (notFoundCount > 0 && skippedCount === 0) {
          setValidationState('invalid');
          setErrorMessage('No validators found');
          return;
        }
        // All validators already exist - show friendly message, not error
        if (foundLidoCsmOperatorId !== undefined) {
          setLidoCsmOperatorId(foundLidoCsmOperatorId);
          setLidoCsmValidatorIndexes(foundValidators.map((validator) => validator.index));
        }
        setValidationState('valid');
        setInputValue('');
        toast({
          title: 'Already added',
          description:
            skippedCount === 1
              ? 'This validator is already in your cluster'
              : `All ${skippedCount} validators are already in your cluster`,
        });
        setTimeout(() => setValidationState('idle'), 1000);
        return;
      }

      // For bulk add with many validators, show confirmation dialog
      if (newValidators.length > BULK_ADD_THRESHOLD) {
        setBulkAction({
          action: 'add',
          withdrawalAddress: parsed.type === 'withdrawalAddress' ? parsed.values[0] : '',
          validatorCount: newValidators.length,
          validators: sortValidatorsDescending(newValidators),
          lidoCsmOperatorId: foundLidoCsmOperatorId,
        });
        setValidationState('valid');
        return;
      }

      // Add validators
      onValidatorsChange(sortValidatorsDescending([...validators, ...newValidators]));
      if (foundLidoCsmOperatorId !== undefined) {
        setLidoCsmOperatorId(foundLidoCsmOperatorId);
        setLidoCsmValidatorIndexes(foundValidators.map((validator) => validator.index));
      }
      setValidationState('valid');
      setInputValue('');

      // Track discovered withdrawal addresses (for index/pubkey inputs)
      // so we can fetch all validators for those addresses
      if (parsed.type !== 'withdrawalAddress') {
        const newAddresses = newValidators
          .map((v) => v.withdrawalAddress?.toLowerCase())
          .filter((addr): addr is string => !!addr);

        if (newAddresses.length > 0) {
          setDiscoveredWithdrawalAddresses((prev) => {
            const existing = new Set(prev.map((a) => a.toLowerCase()));
            const knownSet = new Set(knownWithdrawalAddresses.map((a) => a.toLowerCase()));
            const toAdd = newAddresses.filter((a) => !existing.has(a) && !knownSet.has(a));
            return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
          });
        }
      }

      // Build friendly description
      let description: string;
      if (newValidators.length === 1 && skippedCount === 0 && notFoundCount === 0) {
        description = `Validator #${newValidators[0].index}`;
      } else {
        const parts: string[] = [];
        parts.push(`Added ${newValidators.length}`);
        if (skippedCount > 0) {
          parts.push(`${skippedCount} already added`);
        }
        if (notFoundCount > 0) {
          parts.push(`${notFoundCount} not found`);
        }
        description = parts.join(', ');
      }

      toast({
        title: newValidators.length === 1 ? 'Validator added' : 'Validators added',
        description,
      });
      setTimeout(() => setValidationState('idle'), 1000);
    } catch (error) {
      setValidationState('invalid');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to search validators');
    }
  };

  const handleConfirmBulkAdd = () => {
    if (!bulkAction || bulkAction.action !== 'add') return;

    onValidatorsChange(sortValidatorsDescending([...validators, ...bulkAction.validators]));
    if (bulkAction.lidoCsmOperatorId !== undefined) {
      setLidoCsmOperatorId(bulkAction.lidoCsmOperatorId);
      setLidoCsmValidatorIndexes(bulkAction.validators.map((validator) => validator.index));
    }

    // Track discovered withdrawal addresses if not already known
    const newAddresses = bulkAction.validators
      .map((v) => v.withdrawalAddress?.toLowerCase())
      .filter((addr): addr is string => !!addr);

    if (newAddresses.length > 0) {
      setDiscoveredWithdrawalAddresses((prev) => {
        const existing = new Set(prev.map((a) => a.toLowerCase()));
        const knownSet = new Set(knownWithdrawalAddresses.map((a) => a.toLowerCase()));
        const toAdd = [...new Set(newAddresses)].filter(
          (a) => !existing.has(a) && !knownSet.has(a),
        );
        return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
      });
    }

    toast({
      title: 'Validators added',
      description: `Successfully added ${bulkAction.validatorCount} validators`,
    });

    setInputValue('');
    setValidationState('idle');
    setBulkAction(null);
  };

  const handleRemoveByWithdrawal = async (addressToRemove: string) => {
    if (!addressToRemove) return;

    const lowerAddr = addressToRemove.toLowerCase();
    const validatorsToRemove = validators.filter(
      (v) => v.withdrawalAddress?.toLowerCase() === lowerAddr,
    );

    if (validatorsToRemove.length === 0) {
      toast({
        title: 'No validators to remove',
        description: 'No validators with this withdrawal address in your cluster',
        variant: 'destructive',
      });
      return;
    }

    if (validatorsToRemove.length === 1) {
      // Just remove directly
      onValidatorsChange(
        sortValidatorsDescending(
          validators.filter((v) => v.withdrawalAddress?.toLowerCase() !== lowerAddr),
        ),
      );
      toast({
        title: 'Validator removed',
        description: `Removed validator #${validatorsToRemove[0].index}`,
      });
      return;
    }

    setBulkAction({
      action: 'remove',
      withdrawalAddress: addressToRemove,
      validatorCount: validatorsToRemove.length,
      validators: validatorsToRemove,
    });
  };

  const handleConfirmBulkRemove = () => {
    if (!bulkAction || bulkAction.action !== 'remove') return;

    const indexesToRemove = new Set(bulkAction.validators.map((v) => v.index));
    onValidatorsChange(
      sortValidatorsDescending(validators.filter((v) => !indexesToRemove.has(v.index))),
    );

    toast({
      title: 'Validators removed',
      description: `Successfully removed ${bulkAction.validatorCount} validators`,
    });

    setBulkAction(null);
  };

  const removeValidator = (id: string) => {
    onValidatorsChange(sortValidatorsDescending(validators.filter((v) => v.id !== id)));
  };

  const addMissingValidators = (address: string) => {
    const lowerAddr = address.toLowerCase();
    const missing = missingValidatorsByAddress[lowerAddr];
    if (!missing || missing.length === 0) return;

    onValidatorsChange(sortValidatorsDescending([...validators, ...missing]));
    toast({
      title: 'Validators added',
      description: `Added ${missing.length} validators from ${address.slice(0, 10)}...`,
    });
  };

  const addMissingLidoCsmValidators = () => {
    if (missingLidoCsmValidators.length === 0) return;

    onValidatorsChange(sortValidatorsDescending([...validators, ...missingLidoCsmValidators]));
    setLidoCsmValidatorIndexes((currentIndexes) => [
      ...new Set([
        ...currentIndexes,
        ...missingLidoCsmValidators.map((validator) => validator.index),
      ]),
    ]);
    toast({
      title: 'Validators added',
      description: `Added ${missingLidoCsmValidators.length} Lido CSM validators`,
    });
  };

  const handleInputChange = (value: string) => {
    setInputValue(value);
    setValidationState('idle');
    setErrorMessage('');
  };

  const handleCategoryChange = (category: ValidatorSearchCategory) => {
    setSelectedSearchCategory(category);
    setInputValue('');
    setValidationState('idle');
    setErrorMessage('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddValidator();
    }
  };

  const closeBulkAction = () => setBulkAction(null);

  const clearLidoCsmSelection = () => {
    setLidoCsmOperatorId(undefined);
    setLidoCsmValidatorIndexes([]);
    setInputValue('');
    setValidationState('idle');
    setErrorMessage('');
  };

  return {
    // State
    validators,
    inputValue,
    selectedSearchCategory,
    validationState,
    errorMessage,
    bulkAction,
    isSearching,
    allWithdrawalAddresses,
    validatorsByAddress,
    missingValidatorsByAddress,
    missingLidoCsmValidators,
    currentLidoCsmValidatorCount,
    lidoCsmOperatorId,
    lidoCsmValidatorIndexes,

    // Actions
    handleAddValidator,
    handleConfirmBulkAdd,
    handleRemoveByWithdrawal,
    handleConfirmBulkRemove,
    removeValidator,
    addMissingValidators,
    addMissingLidoCsmValidators,
    handleInputChange,
    handleCategoryChange,
    handleKeyDown,
    closeBulkAction,
    clearLidoCsmSelection,
  };
}
