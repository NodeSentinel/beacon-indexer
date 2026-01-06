'use client';

import { Trash2, AlertTriangle, Check, X, Loader2, Users, HelpCircle } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';

import DashboardCard from '@/components/dashboard/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
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
import { TooltipContent, TooltipTrigger, Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { useMediaQuery } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';
import type { Group } from '@/types/validator';

interface GroupFormProps {
  group: Group | null;
  onClose: () => void;
}

type ValidatorItem = {
  id: string;
  type: 'withdrawal' | 'pubkey' | 'index';
  value: string;
  displayName: string;
};

type ValidationState = 'idle' | 'validating' | 'valid' | 'invalid';

type BulkAction = {
  action: 'add' | 'remove';
  withdrawalAddress: string;
  validatorCount: number;
  validators: ValidatorItem[];
} | null;

export default function GroupForm({ group, onClose }: GroupFormProps) {
  const [name, setName] = useState(group?.name || '');
  const [feeRecipient, setFeeRecipient] = useState(group?.feeRecipientAddress || '');
  const [validators, setValidators] = useState<ValidatorItem[]>(
    group
      ? [
          ...group.withdrawalAddresses.map((addr, i) => ({
            id: `w-${i}`,
            type: 'withdrawal' as const,
            value: addr,
            displayName: `${addr.slice(0, 10)}...${addr.slice(-8)}`,
          })),
          ...group.validatorIndices.map((idx, i) => ({
            id: `i-${i}`,
            type: 'index' as const,
            value: idx.toString(),
            displayName: `Validator #${idx}`,
          })),
        ]
      : [],
  );

  const [inputValue, setInputValue] = useState('');
  const [validationState, setValidationState] = useState<ValidationState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { toast } = useToast();
  const [bulkAction, setBulkAction] = useState<BulkAction>(null);
  const [removeInputValue, setRemoveInputValue] = useState('');
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);

  const getValidatorsByWithdrawal = async (
    _withdrawalAddress: string,
  ): Promise<ValidatorItem[]> => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const count = Math.floor(Math.random() * 20) + 5;
    const mockValidators: ValidatorItem[] = [];
    for (let i = 0; i < count; i++) {
      mockValidators.push({
        id: `${Date.now()}-${i}`,
        type: 'index',
        value: (100000 + i).toString(),
        displayName: `Validator #${100000 + i}`,
      });
    }
    return mockValidators;
  };

  const detectAndValidate = async (
    value: string,
  ): Promise<{
    type: string;
    isValid: boolean;
    message: string;
    validators?: ValidatorItem[];
  }> => {
    const trimmed = value.trim();

    if (/^\d+$/.test(trimmed)) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const index = Number.parseInt(trimmed);
      if (index >= 0 && index < 1000000) {
        return { type: 'index', isValid: true, message: `Validator #${index}` };
      }
      return { type: 'index', isValid: false, message: 'Validator index not found' };
    }

    if (/^0x[0-9a-fA-F]{96}$/.test(trimmed)) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return {
        type: 'pubkey',
        isValid: true,
        message: `${trimmed.slice(0, 10)}...${trimmed.slice(-8)}`,
      };
    }

    if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
      const foundValidators = await getValidatorsByWithdrawal(trimmed);
      if (foundValidators.length > 0) {
        return {
          type: 'withdrawal',
          isValid: true,
          message: `${trimmed.slice(0, 10)}...${trimmed.slice(-8)}`,
          validators: foundValidators,
        };
      }
      return {
        type: 'withdrawal',
        isValid: false,
        message: 'No validators found for this withdrawal address',
      };
    }

    return {
      type: 'unknown',
      isValid: false,
      message: 'Invalid format. Enter validator index, public key, or withdrawal address',
    };
  };

  const handleAddValidator = async () => {
    if (!inputValue.trim()) return;

    setValidationState('validating');
    setErrorMessage('');

    const result = await detectAndValidate(inputValue);

    if (result.isValid) {
      if (result.type === 'withdrawal' && result.validators && result.validators.length > 1) {
        setBulkAction({
          action: 'add',
          withdrawalAddress: inputValue.trim(),
          validatorCount: result.validators.length,
          validators: result.validators,
        });
        setValidationState('valid');
        return;
      }

      const newValidator: ValidatorItem = {
        id: Date.now().toString(),
        type: result.type as 'withdrawal' | 'pubkey' | 'index',
        value: inputValue.trim(),
        displayName: result.message,
      };

      setValidators([...validators, newValidator]);
      setValidationState('valid');
      setInputValue('');

      toast({
        title: 'Validator added',
        description: result.message,
      });

      setTimeout(() => setValidationState('idle'), 1000);
    } else {
      setValidationState('invalid');
      setErrorMessage(result.message);
    }
  };

  const handleConfirmBulkAdd = () => {
    if (!bulkAction || bulkAction.action !== 'add') return;

    setValidators([...validators, ...bulkAction.validators]);
    toast({
      title: 'Validators added',
      description: `Successfully added ${bulkAction.validatorCount} validators`,
    });

    setInputValue('');
    setValidationState('idle');
    setBulkAction(null);
  };

  const handleRemoveByWithdrawal = async () => {
    if (!removeInputValue.trim()) return;

    const trimmed = removeInputValue.trim();

    if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
      toast({
        title: 'Invalid address',
        description: 'Please enter a valid withdrawal address',
        variant: 'destructive',
      });
      return;
    }

    setValidationState('validating');

    const foundValidators = await getValidatorsByWithdrawal(trimmed);

    if (foundValidators.length === 0) {
      toast({
        title: 'No validators found',
        description: 'No validators are associated with this withdrawal address',
        variant: 'destructive',
      });
      setValidationState('idle');
      return;
    }

    const validatorsToRemove = validators.filter((v) =>
      foundValidators.some((fv) => fv.value === v.value),
    );

    if (validatorsToRemove.length === 0) {
      toast({
        title: 'No validators to remove',
        description: 'None of these validators are in your group',
        variant: 'destructive',
      });
      setValidationState('idle');
      return;
    }

    setBulkAction({
      action: 'remove',
      withdrawalAddress: trimmed,
      validatorCount: validatorsToRemove.length,
      validators: validatorsToRemove,
    });
    setValidationState('idle');
  };

  const handleConfirmBulkRemove = () => {
    if (!bulkAction || bulkAction.action !== 'remove') return;

    const validatorIdsToRemove = new Set(bulkAction.validators.map((v) => v.id));
    setValidators(validators.filter((v) => !validatorIdsToRemove.has(v.id)));

    toast({
      title: 'Validators removed',
      description: `Successfully removed ${bulkAction.validatorCount} validators`,
    });

    setRemoveInputValue('');
    setBulkAction(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddValidator();
    }
  };

  const removeValidator = (id: string) => {
    setValidators(validators.filter((v) => v.id !== id));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('[v0] Group form submitted:', { name, feeRecipient, validators });
    onClose();
  };

  const handleDelete = () => {
    if (
      confirm(
        'Are you sure you want to delete this group? All validators and settings will be removed. You can recreate the group at any time.',
      )
    ) {
      console.log('[v0] Deleting group:', group?.id);
      onClose();
    }
  };

  const HelpContent = () => (
    <div className="space-y-2 text-xs">
      <p className="font-semibold">You can add validators using:</p>
      <ul className="space-y-1 list-disc pl-4">
        <li>
          <strong>Validator Index:</strong> Single number (e.g., 12345)
        </li>
        <li>
          <strong>Batch Range:</strong> Add multiple validators at once (e.g., 100-150 adds
          validators 100 through 150)
        </li>
        <li>
          <strong>Public Key:</strong> 0x followed by 96 hex characters
        </li>
        <li>
          <strong>Withdrawal Address:</strong> 0x followed by 40 hex characters (adds all associated
          validators)
        </li>
      </ul>
    </div>
  );

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl sm:text-2xl font-display">{group ? 'Manage Group' : 'Add Group'}</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <DashboardCard title="BASIC INFORMATION" intent="default">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Group Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Group Alpha"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="feeRecipient">Execution Rewards Fee Recipient Address</Label>
              <Input
                id="feeRecipient"
                value={feeRecipient}
                onChange={(e) => setFeeRecipient(e.target.value)}
                placeholder="0x..."
                required
              />
            </div>
          </div>
        </DashboardCard>

        <DashboardCard
          title="VALIDATOR MANAGEMENT"
          intent="default"
          action={
            isMobile ? (
              <Dialog open={helpDialogOpen} onOpenChange={setHelpDialogOpen}>
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
            ) : (
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
            )
          }
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="validator-input">Add Validators</Label>
              <div className="relative">
                <Input
                  id="validator-input"
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    setValidationState('idle');
                    setErrorMessage('');
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter validator index, public key (0x...), or withdrawal address"
                  className={`pr-10 ${
                    validationState === 'valid'
                      ? 'border-green-500'
                      : validationState === 'invalid'
                        ? 'border-destructive'
                        : ''
                  }`}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {validationState === 'validating' && (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  )}
                  {validationState === 'valid' && <Check className="size-4 text-green-500" />}
                  {validationState === 'invalid' && <X className="size-4 text-destructive" />}
                </div>
              </div>

              {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

              <Button
                type="button"
                onClick={handleAddValidator}
                disabled={!inputValue.trim() || validationState === 'validating'}
                className="w-full bg-transparent"
                variant="outline"
              >
                {validationState === 'validating' ? 'Validating...' : 'Add Validator'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Withdrawal addresses will add all associated validators
              </p>
            </div>

            {validators.length > 0 && (
              <>
                <div className="pt-4 border-t space-y-2">
                  <Label htmlFor="remove-input">Remove by Withdrawal Address</Label>
                  <div className="flex gap-2">
                    <Input
                      id="remove-input"
                      value={removeInputValue}
                      onChange={(e) => setRemoveInputValue(e.target.value)}
                      placeholder="0x... withdrawal address"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      onClick={handleRemoveByWithdrawal}
                      disabled={!removeInputValue.trim() || validationState === 'validating'}
                      variant="outline"
                    >
                      Remove
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Remove all validators associated with a withdrawal address
                  </p>
                </div>

                <div className="pt-4 border-t space-y-2">
                  <Label className="text-sm">Added Validators ({validators.length})</Label>
                  <div className="border rounded-lg p-3 space-y-2 max-h-60 overflow-y-auto">
                    {validators.map((validator) => (
                      <div
                        key={validator.id}
                        className="flex items-center gap-2 p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                      >
                        <Badge variant="outline" className="shrink-0 text-xs capitalize">
                          {validator.type}
                        </Badge>
                        <span className="text-sm flex-1 truncate">{validator.displayName}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeValidator(validator.id)}
                          className="size-7 shrink-0"
                        >
                          <X className="size-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </DashboardCard>

        <div className="pt-2">
          <Button type="submit" className="w-full" disabled={validators.length === 0}>
            {group ? 'Save Changes' : 'Add Group'}
          </Button>
        </div>

        {group && (
          <div className="border border-destructive/30 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1 flex-1">
                <h3 className="font-semibold text-destructive">Danger Zone</h3>
                <p className="text-sm text-muted-foreground">
                  Deleting this group will remove all validators and settings. You can recreate the
                  group at any time.
                </p>
              </div>
            </div>
            <Button type="button" variant="destructive" onClick={handleDelete} className="w-full">
              <Trash2 className="size-4 mr-2" />
              Delete Group
            </Button>
          </div>
        )}
      </form>

      <AlertDialog open={bulkAction !== null} onOpenChange={(open) => !open && setBulkAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Users className="size-5" />
              {bulkAction?.action === 'add'
                ? 'Add Multiple Validators'
                : 'Remove Multiple Validators'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <div>
                  {bulkAction?.action === 'add'
                    ? `This withdrawal address has ${bulkAction?.validatorCount} validators. Do you want to add all of them to your group?`
                    : `This will remove ${bulkAction?.validatorCount} validators from your group. This action cannot be undone.`}
                </div>
                <code className="block bg-muted px-3 py-2 rounded text-xs break-all font-mono">
                  {bulkAction?.withdrawalAddress}
                </code>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={
                bulkAction?.action === 'add' ? handleConfirmBulkAdd : handleConfirmBulkRemove
              }
              className={
                bulkAction?.action === 'remove' ? 'bg-destructive hover:bg-destructive/90' : ''
              }
            >
              {bulkAction?.action === 'add'
                ? `Add ${bulkAction?.validatorCount} Validators`
                : `Remove ${bulkAction?.validatorCount} Validators`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
