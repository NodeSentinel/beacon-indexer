'use client';

import { Check, Hash, HelpCircle, KeyRound, Loader2, SquareArrowRight, X } from 'lucide-react';
import Image from 'next/image';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ValidatorSearchCategory } from '@/lib/validator-search-input';

type ValidationState = 'idle' | 'validating' | 'valid' | 'invalid';

interface ValidatorInputFieldProps {
  inputValue: string;
  selectedCategory: ValidatorSearchCategory;
  validationState: ValidationState;
  chain: 'ethereum' | 'gnosis';
  errorMessage: string;
  isSearching: boolean;
  isMobile: boolean;
  helpDialogOpen: boolean;
  onCategoryChange: (category: ValidatorSearchCategory) => void;
  onHelpDialogChange: (open: boolean) => void;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onAdd: () => void;
  currentLidoCsmOperatorId?: string | null;
  isDeletingLidoCsmOperator?: boolean;
  onDeleteLidoCsmOperator?: () => void;
}

type CategoryIcon = React.ComponentType<{ className?: string }>;

const BASE_CATEGORY_OPTIONS: Array<{
  value: ValidatorSearchCategory;
  label: string;
  placeholder: string;
  icon: CategoryIcon;
}> = [
  {
    value: 'index',
    label: 'Index',
    placeholder: 'Enter validator index (e.g., 1631439)',
    icon: Hash,
  },
  {
    value: 'pubkey',
    label: 'Pub Key',
    placeholder: 'Enter validator public key',
    icon: KeyRound,
  },
  {
    value: 'withdrawalAddress',
    label: 'Withdrawal',
    placeholder: 'Enter withdrawal address',
    icon: SquareArrowRight,
  },
];

/** Renders the Lido CSM logo used in the validator category tab. */
function LidoCsmIcon({ className }: { className?: string }) {
  return (
    <Image
      src="/assets/lido-csm.svg"
      alt=""
      width={20}
      height={20}
      className={className}
      aria-hidden="true"
    />
  );
}

const LIDO_CSM_CATEGORY = {
  value: 'lidoCsm',
  label: 'Lido CSM',
  placeholder: 'Enter Lido CSM operator id',
  icon: LidoCsmIcon,
} satisfies {
  value: ValidatorSearchCategory;
  label: string;
  placeholder: string;
  icon: CategoryIcon;
};

function HelpContent() {
  return (
    <div className="space-y-2 text-xs">
      <p className="font-semibold">You can add validators using:</p>
      <ul className="space-y-1 list-disc pl-4">
        <li>
          <strong>Validator Indexes:</strong> Numbers separated by commas (e.g., 123, 456, 789)
        </li>
        <li>
          <strong>Public Keys:</strong> 0x followed by 96 hex characters, comma-separated for
          multiple
        </li>
        <li>
          <strong>Withdrawal Addresses:</strong> 0x followed by 40 hex characters, comma-separated
          for multiple (adds all associated validators)
        </li>
      </ul>
      <p className="text-muted-foreground mt-2">
        Note: You cannot mix different types in a single input.
      </p>
    </div>
  );
}

function HelpButton({
  isMobile,
  onOpenChange,
  open,
}: {
  isMobile: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <HelpCircle className="size-4" />
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>How to Add Validators</DialogTitle>
            <DialogDescription asChild>
              <div className="pt-2">
                <HelpContent />
              </div>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <HelpCircle className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <HelpContent />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ValidatorInputField({
  chain,
  currentLidoCsmOperatorId,
  errorMessage,
  helpDialogOpen,
  inputValue,
  isDeletingLidoCsmOperator = false,
  isMobile,
  isSearching,
  onAdd,
  onCategoryChange,
  onDeleteLidoCsmOperator,
  onHelpDialogChange,
  onInputChange,
  onKeyDown,
  selectedCategory,
  validationState,
}: ValidatorInputFieldProps) {
  const categoryOptions =
    chain === 'ethereum' ? [LIDO_CSM_CATEGORY, ...BASE_CATEGORY_OPTIONS] : BASE_CATEGORY_OPTIONS;
  const hasCurrentLidoCsmOperator =
    selectedCategory === 'lidoCsm' &&
    currentLidoCsmOperatorId !== null &&
    currentLidoCsmOperatorId !== undefined;
  const displayedInputValue = hasCurrentLidoCsmOperator ? currentLidoCsmOperatorId : inputValue;
  const hasInput = displayedInputValue.trim().length > 0;
  const isLoading = hasInput && (validationState === 'validating' || isSearching);
  const activeCategory = categoryOptions.find((category) => category.value === selectedCategory);
  const ActiveIcon = activeCategory?.icon ?? Hash;
  const buttonLabel = hasCurrentLidoCsmOperator
    ? isDeletingLidoCsmOperator
      ? 'Deleting...'
      : 'Delete'
    : isLoading
      ? 'Adding...'
      : 'Add';

  useEffect(() => {
    if (chain !== 'ethereum' && selectedCategory === 'lidoCsm') {
      onCategoryChange('index');
    }
  }, [chain, onCategoryChange, selectedCategory]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Label htmlFor="validator-input" className="text-lg font-bold">
          Validators
        </Label>
        <HelpButton isMobile={isMobile} open={helpDialogOpen} onOpenChange={onHelpDialogChange} />
      </div>

      <div className="overflow-x-auto sm:overflow-visible">
        <div
          className="flex w-max gap-1 rounded-xl bg-muted p-1 sm:grid sm:w-full"
          style={{ gridTemplateColumns: `repeat(${categoryOptions.length}, minmax(0, 1fr))` }}
        >
          {categoryOptions.map((category) => {
            const Icon = category.icon;
            const isSelected = selectedCategory === category.value;

            return (
              <button
                key={category.value}
                type="button"
                onClick={() => onCategoryChange(category.value)}
                className={cn(
                  'flex h-12 w-32 shrink-0 items-center justify-center gap-2 rounded-lg px-2 text-sm font-bold transition-colors sm:w-auto sm:text-base',
                  isSelected
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                aria-pressed={isSelected}
              >
                <Icon className="size-5" />
                <span>{category.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <ActiveIcon className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="validator-input"
            value={displayedInputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={hasCurrentLidoCsmOperator}
            placeholder={
              hasCurrentLidoCsmOperator
                ? 'Current Lido CSM operator id'
                : activeCategory?.placeholder
            }
            className={`h-14 rounded-xl pl-12 pr-10 text-base shadow-sm ${
              validationState === 'valid'
                ? 'border-green-500'
                : validationState === 'invalid'
                  ? 'border-destructive'
                  : ''
            }`}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            {validationState === 'valid' && !isSearching && (
              <Check className="size-4 text-green-500" />
            )}
            {validationState === 'invalid' && <X className="size-4 text-destructive" />}
          </div>
        </div>
        <Button
          type="button"
          onClick={hasCurrentLidoCsmOperator ? onDeleteLidoCsmOperator : onAdd}
          disabled={
            hasCurrentLidoCsmOperator ? isDeletingLidoCsmOperator : !inputValue.trim() || isLoading
          }
          variant={hasCurrentLidoCsmOperator ? 'destructive' : 'secondary'}
          className="h-14 rounded-xl px-6 text-base normal-case"
        >
          {buttonLabel}
        </Button>
      </div>
      {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
    </div>
  );
}
