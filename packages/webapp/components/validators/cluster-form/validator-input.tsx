'use client';

import { useState, useEffect } from 'react';

import { BulkActionDialog } from './bulk-action-dialog';
import { ValidatorInputField } from './validator-input-field';
import { ValidatorsList } from './validators-list';

import { useMediaQuery } from '@/hooks/use-mobile';
import { useValidatorInput, type ValidatorItem } from '@/hooks/use-validator-input';

interface ValidatorInputProps {
  initialValidators: ValidatorItem[];
  withdrawalAddresses: string[];
  isEditMode: boolean;
  onValidatorsChange: (validators: ValidatorItem[]) => void;
}

export function ValidatorInput({
  initialValidators,
  withdrawalAddresses,
  isEditMode,
  onValidatorsChange,
}: ValidatorInputProps) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);

  const {
    validators,
    inputValue,
    validationState,
    errorMessage,
    bulkAction,
    isSearching,
    allWithdrawalAddresses,
    validatorsByAddress,
    missingValidatorsByAddress,
    handleAddValidator,
    handleConfirmBulkAdd,
    handleRemoveByWithdrawal,
    handleConfirmBulkRemove,
    removeValidator,
    addMissingValidators,
    handleInputChange,
    handleKeyDown,
    closeBulkAction,
  } = useValidatorInput({
    initialValidators,
    withdrawalAddresses,
  });

  // Notify parent when validators change
  useEffect(() => {
    onValidatorsChange(validators);
  }, [validators, onValidatorsChange]);

  return (
    <div className="space-y-4">
      <ValidatorInputField
        inputValue={inputValue}
        validationState={validationState}
        errorMessage={errorMessage}
        isSearching={isSearching}
        isMobile={isMobile}
        helpDialogOpen={helpDialogOpen}
        onHelpDialogChange={setHelpDialogOpen}
        onInputChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onAdd={handleAddValidator}
      />

      <ValidatorsList
        validators={validators}
        allWithdrawalAddresses={allWithdrawalAddresses}
        validatorsByAddress={validatorsByAddress}
        missingValidatorsByAddress={missingValidatorsByAddress}
        isEditMode={isEditMode}
        onRemoveValidator={removeValidator}
        onRemoveByWithdrawal={handleRemoveByWithdrawal}
        onAddMissingValidators={addMissingValidators}
      />

      <BulkActionDialog
        bulkAction={bulkAction}
        onClose={closeBulkAction}
        onConfirmAdd={handleConfirmBulkAdd}
        onConfirmRemove={handleConfirmBulkRemove}
      />
    </div>
  );
}
