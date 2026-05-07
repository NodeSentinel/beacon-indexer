'use client';

import { Check, HelpCircle, Loader2, X } from 'lucide-react';

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

type ValidationState = 'idle' | 'validating' | 'valid' | 'invalid';

interface ValidatorInputFieldProps {
  inputValue: string;
  validationState: ValidationState;
  errorMessage: string;
  isSearching: boolean;
  isMobile: boolean;
  helpDialogOpen: boolean;
  onHelpDialogChange: (open: boolean) => void;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onAdd: () => void;
}

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
  errorMessage,
  helpDialogOpen,
  inputValue,
  isMobile,
  isSearching,
  onAdd,
  onHelpDialogChange,
  onInputChange,
  onKeyDown,
  validationState,
}: ValidatorInputFieldProps) {
  const hasInput = inputValue.trim().length > 0;
  const isLoading = hasInput && (validationState === 'validating' || isSearching);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor="validator-input">Validators</Label>
        <HelpButton isMobile={isMobile} open={helpDialogOpen} onOpenChange={onHelpDialogChange} />
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id="validator-input"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Index, public key, or withdrawal address"
            className={`pr-10 ${
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
          onClick={onAdd}
          disabled={!inputValue.trim() || isLoading}
          variant="secondary"
        >
          {isLoading ? 'Adding...' : 'Add'}
        </Button>
      </div>
      {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
    </div>
  );
}
