'use client';

import { VirtualizedChipList } from './virtualized-chip-list';
import { WithdrawalAddressCard } from './withdrawal-address-card';

import { Label } from '@/components/ui/label';
import type { ValidatorItem } from '@/hooks/use-validator-input';

interface ValidatorsListProps {
  validators: ValidatorItem[];
  allWithdrawalAddresses: string[];
  validatorsByAddress: Record<string, ValidatorItem[]>;
  missingValidatorsByAddress: Record<string, ValidatorItem[]>;
  isEditMode: boolean;
  onRemoveValidator: (id: string) => void;
  onRemoveByWithdrawal: (address: string) => void;
  onAddMissingValidators: (address: string) => void;
}

export function ValidatorsList({
  validators,
  allWithdrawalAddresses,
  validatorsByAddress,
  missingValidatorsByAddress,
  isEditMode: _isEditMode,
  onRemoveValidator,
  onRemoveByWithdrawal,
  onAddMissingValidators,
}: ValidatorsListProps) {
  if (validators.length === 0) {
    return null;
  }

  // Sort validators descending by index for flat list view
  const sortedValidators = [...validators].sort((a, b) => b.index - a.index);

  // Show grouped view when in edit mode OR when we have multiple addresses
  const showGroupedByAddress = allWithdrawalAddresses.length > 0;

  return (
    <div className="space-y-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
      <div className="flex items-center justify-between">
        <Label className="text-primary">Validators ({validators.length})</Label>
      </div>

      {showGroupedByAddress ? (
        <div className="space-y-3">
          {allWithdrawalAddresses.map((address) => {
            const lowerAddr = address.toLowerCase();
            const addressValidators = validatorsByAddress[lowerAddr] || [];
            const missingCount = missingValidatorsByAddress[lowerAddr]?.length || 0;
            const totalCount = addressValidators.length + missingCount;

            if (addressValidators.length === 0) {
              return null;
            }

            return (
              <WithdrawalAddressCard
                key={address}
                address={address}
                validators={addressValidators}
                totalCount={totalCount}
                missingCount={missingCount}
                onRemoveAddress={() => onRemoveByWithdrawal(address)}
                onRemoveValidator={onRemoveValidator}
                onAddMissing={() => onAddMissingValidators(address)}
              />
            );
          })}
        </div>
      ) : (
        <VirtualizedChipList
          validators={sortedValidators}
          onRemoveValidator={onRemoveValidator}
          maxHeight={192}
        />
      )}
    </div>
  );
}
