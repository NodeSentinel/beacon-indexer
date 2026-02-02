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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TooltipContent, TooltipTrigger, Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import {
  useCreateCluster,
  useUpdateCluster,
  useDeleteCluster,
  useAddValidators,
  useRemoveValidator,
} from '@/hooks/use-clusters';
import { useMediaQuery } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';
import {
  useSearchByIndex,
  useSearchByPubkey,
  useSearchByWithdrawalAddress,
} from '@/hooks/use-validator-search';
import type { Cluster } from '@/types/validator';

interface ClusterFormProps {
  cluster: Cluster | null;
  onClose: () => void;
  onSaved?: () => void;
}

type ValidatorItem = {
  id: string;
  type: 'withdrawal' | 'pubkey' | 'index';
  value: string;
  index: number;
  displayName: string;
};

type ValidationState = 'idle' | 'validating' | 'valid' | 'invalid';

type BulkAction = {
  action: 'add' | 'remove';
  withdrawalAddress: string;
  validatorCount: number;
  validators: ValidatorItem[];
} | null;

export default function ClusterForm({ cluster, onClose, onSaved }: ClusterFormProps) {
  const [name, setName] = useState(cluster?.name || '');
  const [visibility, setVisibility] = useState<'private' | 'shared'>(
    cluster?.visibility || 'private',
  );
  const [feeRecipient, setFeeRecipient] = useState(cluster?.feeRecipientAddress || '');
  const [validators, setValidators] = useState<ValidatorItem[]>(
    cluster
      ? cluster.validatorIndices.map((idx, i) => ({
          id: `i-${i}`,
          type: 'index' as const,
          value: idx.toString(),
          index: idx,
          displayName: `Validator #${idx}`,
        }))
      : [],
  );

  const [inputValue, setInputValue] = useState('');
  const [validationState, setValidationState] = useState<ValidationState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { toast } = useToast();
  const [bulkAction, setBulkAction] = useState<BulkAction>(null);
  const [removeInputValue, setRemoveInputValue] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const searchByIndex = useSearchByIndex();
  const searchByPubkey = useSearchByPubkey();
  const searchByWithdrawal = useSearchByWithdrawalAddress();

  const createCluster = useCreateCluster();
  const updateCluster = useUpdateCluster();
  const deleteCluster = useDeleteCluster();
  const addValidators = useAddValidators();
  const removeValidatorMutation = useRemoveValidator();

  const handleAddValidator = async () => {
    if (!inputValue.trim()) return;

    setValidationState('validating');
    setErrorMessage('');

    const trimmed = inputValue.trim();

    try {
      // Check if it's a validator index (number)
      if (/^\d+$/.test(trimmed)) {
        const index = Number.parseInt(trimmed);
        const result = await searchByIndex.mutateAsync(index);

        if (result) {
          const newValidator: ValidatorItem = {
            id: Date.now().toString(),
            type: 'index',
            value: trimmed,
            index: result.index,
            displayName: `Validator #${result.index}`,
          };

          if (validators.some((v) => v.index === result.index)) {
            setValidationState('invalid');
            setErrorMessage('Validator already added');
            return;
          }

          setValidators([...validators, newValidator]);
          setValidationState('valid');
          setInputValue('');
          toast({ title: 'Validator added', description: `Validator #${result.index}` });
          setTimeout(() => setValidationState('idle'), 1000);
        } else {
          setValidationState('invalid');
          setErrorMessage('Validator index not found');
        }
        return;
      }

      // Check if it's a pubkey (0x + 96 hex chars)
      if (/^0x[0-9a-fA-F]{96}$/.test(trimmed)) {
        const result = await searchByPubkey.mutateAsync(trimmed);

        if (result) {
          const newValidator: ValidatorItem = {
            id: Date.now().toString(),
            type: 'pubkey',
            value: trimmed,
            index: result.index,
            displayName: `Validator #${result.index}`,
          };

          if (validators.some((v) => v.index === result.index)) {
            setValidationState('invalid');
            setErrorMessage('Validator already added');
            return;
          }

          setValidators([...validators, newValidator]);
          setValidationState('valid');
          setInputValue('');
          toast({ title: 'Validator added', description: `Validator #${result.index}` });
          setTimeout(() => setValidationState('idle'), 1000);
        } else {
          setValidationState('invalid');
          setErrorMessage('Validator pubkey not found');
        }
        return;
      }

      // Check if it's a withdrawal address (0x + 40 hex chars)
      if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
        const results = await searchByWithdrawal.mutateAsync(trimmed);

        if (results.length === 0) {
          setValidationState('invalid');
          setErrorMessage('No validators found for this withdrawal address');
          return;
        }

        const existingIndexes = new Set(validators.map((v) => v.index));
        const newValidators = results
          .filter((r) => !existingIndexes.has(r.index))
          .map((r, i) => ({
            id: `${Date.now()}-${i}`,
            type: 'index' as const,
            value: r.index.toString(),
            index: r.index,
            displayName: `Validator #${r.index}`,
          }));

        if (newValidators.length === 0) {
          setValidationState('invalid');
          setErrorMessage('All validators from this address are already added');
          return;
        }

        if (newValidators.length > 1) {
          setBulkAction({
            action: 'add',
            withdrawalAddress: trimmed,
            validatorCount: newValidators.length,
            validators: newValidators,
          });
          setValidationState('valid');
          return;
        }

        setValidators([...validators, ...newValidators]);
        setValidationState('valid');
        setInputValue('');
        toast({ title: 'Validator added', description: `Validator #${newValidators[0].index}` });
        setTimeout(() => setValidationState('idle'), 1000);
        return;
      }

      setValidationState('invalid');
      setErrorMessage('Invalid format. Enter validator index, public key, or withdrawal address');
    } catch {
      setValidationState('invalid');
      setErrorMessage('Failed to search validator');
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

    try {
      const results = await searchByWithdrawal.mutateAsync(trimmed);

      if (results.length === 0) {
        toast({
          title: 'No validators found',
          description: 'No validators are associated with this withdrawal address',
          variant: 'destructive',
        });
        setValidationState('idle');
        return;
      }

      const resultIndexes = new Set(results.map((r) => r.index));
      const validatorsToRemove = validators.filter((v) => resultIndexes.has(v.index));

      if (validatorsToRemove.length === 0) {
        toast({
          title: 'No validators to remove',
          description: 'None of these validators are in your cluster',
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
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to search validators',
        variant: 'destructive',
      });
      setValidationState('idle');
    }
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const validatorIndexes = validators.map((v) => v.index);

      if (cluster) {
        // Update existing cluster
        await updateCluster.mutateAsync({
          id: cluster.id,
          name,
          visibility,
          feeRecipientAddress: feeRecipient || null,
        });

        // Calculate validators to add/remove
        const existingIndexes = new Set(cluster.validatorIndices);
        const newIndexes = new Set(validatorIndexes);

        const toAdd = validatorIndexes.filter((idx) => !existingIndexes.has(idx));
        const toRemove = cluster.validatorIndices.filter((idx) => !newIndexes.has(idx));

        if (toAdd.length > 0) {
          await addValidators.mutateAsync({ clusterId: cluster.id, validatorIndexes: toAdd });
        }

        // Remove validators that were deleted from the list
        for (const validatorIndex of toRemove) {
          await removeValidatorMutation.mutateAsync({ clusterId: cluster.id, validatorIndex });
        }

        toast({ title: 'Cluster updated', description: `${name} has been updated` });
      } else {
        // Create new cluster
        const newCluster = await createCluster.mutateAsync({
          name,
          visibility,
          feeRecipientAddress: feeRecipient || null,
        });

        if (newCluster && validatorIndexes.length > 0) {
          await addValidators.mutateAsync({ clusterId: newCluster.id, validatorIndexes });
        }

        toast({ title: 'Cluster created', description: `${name} has been created` });
      }

      onSaved?.();
      onClose();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save cluster',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!cluster) return;

    try {
      await deleteCluster.mutateAsync(cluster.id);
      toast({ title: 'Cluster deleted', description: `${cluster.name} has been deleted` });
      onSaved?.();
      onClose();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete cluster',
        variant: 'destructive',
      });
    }
    setDeleteDialogOpen(false);
  };

  const HelpContent = () => (
    <div className="space-y-2 text-xs">
      <p className="font-semibold">You can add validators using:</p>
      <ul className="space-y-1 list-disc pl-4">
        <li>
          <strong>Validator Index:</strong> Single number (e.g., 12345)
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

  const isSearching =
    searchByIndex.isPending || searchByPubkey.isPending || searchByWithdrawal.isPending;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl sm:text-2xl font-display">
          {cluster ? 'Manage Cluster' : 'Add Cluster'}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <DashboardCard title="BASIC INFORMATION" intent="default">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Cluster Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., My Validators"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="visibility">Visibility</Label>
              <Select
                value={visibility}
                onValueChange={(v) => setVisibility(v as typeof visibility)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select visibility" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private</SelectItem>
                  <SelectItem value="shared">Shared</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="feeRecipient">Execution Rewards Fee Recipient Address</Label>
              <Input
                id="feeRecipient"
                value={feeRecipient}
                onChange={(e) => setFeeRecipient(e.target.value)}
                placeholder="0x..."
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
                  {(validationState === 'validating' || isSearching) && (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  )}
                  {validationState === 'valid' && !isSearching && (
                    <Check className="size-4 text-green-500" />
                  )}
                  {validationState === 'invalid' && <X className="size-4 text-destructive" />}
                </div>
              </div>

              {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

              <Button
                type="button"
                onClick={handleAddValidator}
                disabled={!inputValue.trim() || validationState === 'validating' || isSearching}
                className="w-full bg-transparent"
                variant="outline"
              >
                {validationState === 'validating' || isSearching
                  ? 'Validating...'
                  : 'Add Validator'}
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
                      disabled={
                        !removeInputValue.trim() || validationState === 'validating' || isSearching
                      }
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
          <Button type="submit" className="w-full" disabled={!name.trim() || isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : cluster ? (
              'Save Changes'
            ) : (
              'Create Cluster'
            )}
          </Button>
        </div>

        {cluster && (
          <div className="border border-destructive/30 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1 flex-1">
                <h3 className="font-semibold text-destructive">Danger Zone</h3>
                <p className="text-sm text-muted-foreground">
                  Deleting this cluster will remove all validators and settings. You can recreate
                  the cluster at any time.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setDeleteDialogOpen(true)}
              className="w-full"
              disabled={deleteCluster.isPending}
            >
              <Trash2 className="size-4 mr-2" />
              Delete Cluster
            </Button>
          </div>
        )}
      </form>

      {/* Delete Cluster Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive" />
              Delete Cluster
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this cluster? All validators and settings will be
              removed. You can recreate the cluster at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteCluster.isPending}
            >
              {deleteCluster.isPending ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                    ? `This withdrawal address has ${bulkAction?.validatorCount} validators. Do you want to add all of them to your cluster?`
                    : `This will remove ${bulkAction?.validatorCount} validators from your cluster. This action cannot be undone.`}
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
