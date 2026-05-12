'use client';

import { useEffect, useState } from 'react';

import { BulkActionDialog } from './bulk-action-dialog';
import { ValidatorInputField } from './validator-input-field';
import { ValidatorsList } from './validators-list';

import { env } from '@/env';
import { useMediaQuery } from '@/hooks/use-mobile';
import { useValidatorInput, type ValidatorItem } from '@/hooks/use-validator-input';

interface ValidatorInputProps {
  validators: ValidatorItem[];
  withdrawalAddresses: string[];
  isEditMode: boolean;
  onValidatorsChange: (validators: ValidatorItem[]) => void;
  onLidoCsmValidatorIndexesChange?: (validatorIndexes: number[]) => void;
  onLidoCsmOperatorIdChange?: (operatorId: number | undefined) => void;
  currentLidoCsmOperatorId?: string | null;
  isDeletingLidoCsmOperator?: boolean;
  onDeleteLidoCsmOperator?: () => void;
}

export function ValidatorInput({
  currentLidoCsmOperatorId,
  isDeletingLidoCsmOperator,
  isEditMode,
  onDeleteLidoCsmOperator,
  onLidoCsmOperatorIdChange,
  onLidoCsmValidatorIndexesChange,
  onValidatorsChange,
  validators,
  withdrawalAddresses,
}: ValidatorInputProps) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);

  const {
    addMissingLidoCsmValidators,
    addMissingValidators,
    allWithdrawalAddresses,
    bulkAction,
    clearLidoCsmSelection,
    closeBulkAction,
    currentLidoCsmValidatorCount,
    errorMessage,
    handleAddValidator,
    handleCategoryChange,
    handleConfirmBulkAdd,
    handleConfirmBulkRemove,
    handleInputChange,
    handleKeyDown,
    handleRemoveByWithdrawal,
    inputValue,
    isSearching,
    lidoCsmOperatorId,
    lidoCsmValidatorIndexes,
    missingLidoCsmValidators,
    missingValidatorsByAddress,
    removeValidator,
    selectedSearchCategory,
    validationState,
    validatorsByAddress,
  } = useValidatorInput({
    validators,
    onValidatorsChange,
    currentLidoCsmOperatorId,
    withdrawalAddresses,
  });

  // Notifies the parent form when a Lido CSM search selected an operator id.
  useEffect(() => {
    onLidoCsmOperatorIdChange?.(lidoCsmOperatorId);
  }, [lidoCsmOperatorId, onLidoCsmOperatorIdChange]);

  // Notifies the parent form which visible validators came from the Lido CSM operator search.
  useEffect(() => {
    onLidoCsmValidatorIndexesChange?.(lidoCsmValidatorIndexes);
  }, [lidoCsmValidatorIndexes, onLidoCsmValidatorIndexesChange]);

  const visibleLidoCsmOperatorId =
    currentLidoCsmOperatorId ?? lidoCsmOperatorId?.toString() ?? null;

  const handleDeleteLidoCsmOperator = async () => {
    await onDeleteLidoCsmOperator?.();
    clearLidoCsmSelection();
  };

  return (
    <div className="space-y-4">
      <ValidatorInputField
        inputValue={inputValue}
        selectedCategory={selectedSearchCategory}
        validationState={validationState}
        chain={env.NEXT_PUBLIC_CHAIN}
        errorMessage={errorMessage}
        isSearching={isSearching}
        isMobile={isMobile}
        helpDialogOpen={helpDialogOpen}
        currentLidoCsmOperatorId={visibleLidoCsmOperatorId}
        isDeletingLidoCsmOperator={isDeletingLidoCsmOperator}
        onHelpDialogChange={setHelpDialogOpen}
        onCategoryChange={handleCategoryChange}
        onInputChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onAdd={handleAddValidator}
        onDeleteLidoCsmOperator={handleDeleteLidoCsmOperator}
      />

      <ValidatorsList
        validators={validators}
        allWithdrawalAddresses={allWithdrawalAddresses}
        validatorsByAddress={validatorsByAddress}
        missingValidatorsByAddress={missingValidatorsByAddress}
        lidoCsmOperatorId={visibleLidoCsmOperatorId}
        lidoCsmValidatorCount={currentLidoCsmValidatorCount}
        missingLidoCsmValidatorCount={missingLidoCsmValidators.length}
        isEditMode={isEditMode}
        onRemoveValidator={removeValidator}
        onRemoveByWithdrawal={handleRemoveByWithdrawal}
        onAddMissingValidators={addMissingValidators}
        onAddMissingLidoCsmValidators={addMissingLidoCsmValidators}
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
