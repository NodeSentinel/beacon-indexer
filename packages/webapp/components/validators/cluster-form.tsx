'use client';

import { Trash2, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { isAddress } from 'viem';

import type { ValidatorItem } from '@/hooks/use-validator-input';
import type React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DeleteClusterDialog } from '@/components/validators/cluster-form/delete-cluster-dialog';
import { FeeRecipientInput } from '@/components/validators/cluster-form/fee-recipient-input';
import { ValidatorInput } from '@/components/validators/cluster-form/validator-input';
import {
  useCluster,
  useCreateCluster,
  useUpdateCluster,
  useDeleteCluster,
} from '@/hooks/use-clusters';
import { useToast } from '@/hooks/use-toast';

interface ClusterFormProps {
  /** Cluster ID for edit mode, null for create mode */
  clusterId: string | null;
  onClose: () => void;
  onSaved?: () => void | Promise<unknown>;
  onDeleted?: () => void;
}

export default function ClusterForm({ clusterId, onClose, onSaved, onDeleted }: ClusterFormProps) {
  const { toast } = useToast();

  // Fetch full cluster details when in edit mode
  const { data: clusterDetails, isLoading: isLoadingCluster } = useCluster(clusterId);

  // Form state - initialized from clusterDetails when available
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'shared'>('private');
  const [feeRecipient, setFeeRecipient] = useState('');
  const [formInitialized, setFormInitialized] = useState(!clusterId);
  const [feeRecipientError, setFeeRecipientError] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Validators state lives in the form so the save payload always matches the visible chips.
  const [validators, setValidators] = useState<ValidatorItem[]>([]);

  // Get withdrawal addresses from the full cluster details
  const withdrawalAddresses = clusterDetails?.withdrawalAddresses ?? [];

  // Cluster mutations
  const createCluster = useCreateCluster();
  const updateCluster = useUpdateCluster();
  const deleteCluster = useDeleteCluster();

  // Initialize form state from API data when editing an existing cluster.
  // The formInitialized flag ensures this only runs once - subsequent API refetches
  // (e.g., from React Query background updates) won't overwrite user's local edits.
  // User changes via onChange handlers always work regardless of this flag.
  useEffect(() => {
    if (clusterDetails && !formInitialized) {
      setName(clusterDetails.name);
      setVisibility(clusterDetails.visibility);
      setFeeRecipient(clusterDetails.feeRecipientAddress || '');
      setValidators(
        clusterDetails.validators.map((v, i) => ({
          id: `i-${i}`,
          type: 'index' as const,
          value: v.validatorIndex.toString(),
          index: v.validatorIndex,
          displayName: `Validator #${v.validatorIndex}`,
          withdrawalAddress: v.withdrawalAddress,
        })),
      );

      setFormInitialized(true);
    }
  }, [clusterDetails, formInitialized]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const validatorIndexes = validators.map((v) => v.index);

      if (clusterId) {
        // Update existing cluster and sync the final validator list in the same save request.
        await updateCluster.mutateAsync({
          id: clusterId,
          name,
          visibility,
          feeRecipientAddress: feeRecipient || null,
          validatorIndexes,
        });

        toast({ title: 'Cluster updated', description: `${name} has been updated` });
      } else {
        // Create new cluster with validators
        await createCluster.mutateAsync({
          name,
          validatorIndexes,
          visibility,
          feeRecipientAddress: feeRecipient || null,
        });

        toast({ title: 'Cluster created', description: `${name} has been created` });
      }

      // Waits for the parent refresh flow so the home list is updated before the sheet closes.
      await onSaved?.();
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
    if (!clusterId) return;

    try {
      await deleteCluster.mutateAsync(clusterId);
      toast({
        title: 'Cluster deleted',
        description: `${clusterDetails?.name || 'Cluster'} has been deleted`,
      });
      onDeleted?.();
      await onSaved?.();
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

  const handleFeeRecipientChange = (value: string) => {
    setFeeRecipient(value);
    if (value && !isAddress(value)) {
      setFeeRecipientError('Invalid Ethereum address');
    } else {
      setFeeRecipientError('');
    }
  };

  // Show loading state while fetching cluster details in edit mode
  if (clusterId && isLoadingCluster) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        <h2 className="text-xl sm:text-2xl font-display">Manage Cluster</h2>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <h2 className="text-xl sm:text-2xl font-display">
        {clusterId ? 'Manage Cluster' : 'Add Cluster'}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Cluster Settings */}
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
            <Select value={visibility} onValueChange={(v) => setVisibility(v as typeof visibility)}>
              <SelectTrigger>
                <SelectValue placeholder="Select visibility" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="shared">Shared</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <FeeRecipientInput
            value={feeRecipient}
            onChange={handleFeeRecipientChange}
            error={feeRecipientError}
          />
        </div>

        {/* Validators */}
        <ValidatorInput
          validators={validators}
          withdrawalAddresses={withdrawalAddresses}
          isEditMode={!!clusterId}
          onValidatorsChange={setValidators}
        />

        {/* Actions */}
        <div className="space-y-2 pt-2">
          <Button
            type="submit"
            className="w-full"
            disabled={
              !name.trim() ||
              isSaving ||
              !!feeRecipientError ||
              (!clusterId && validators.length === 0)
            }
          >
            {isSaving ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : clusterId ? (
              'Save Changes'
            ) : (
              'Create Cluster'
            )}
          </Button>

          {clusterId && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteDialogOpen(true)}
              className="w-full text-destructive border-destructive/50 hover:text-destructive hover:bg-destructive/10 hover:border-destructive"
              disabled={deleteCluster.isPending}
            >
              <Trash2 className="size-4 mr-2" />
              Delete Cluster
            </Button>
          )}
        </div>
      </form>

      <DeleteClusterDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDelete}
        isDeleting={deleteCluster.isPending}
      />
    </div>
  );
}
