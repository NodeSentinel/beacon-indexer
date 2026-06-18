'use client';

import { Users } from 'lucide-react';

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

interface BulkAction {
  action: 'add' | 'remove';
  withdrawalAddress: string;
  validatorCount: number;
  lidoCsmOperatorId?: number;
}

interface BulkActionDialogCopy {
  description: string;
  sourceValue?: string;
}

interface BulkActionDialogProps {
  bulkAction: BulkAction | null;
  onClose: () => void;
  onConfirmAdd: () => void;
  onConfirmRemove: () => void;
}

/** Builds the confirmation copy for bulk validator changes. */
export function getBulkActionDialogCopy(bulkAction: BulkAction): BulkActionDialogCopy {
  if (bulkAction.action === 'remove') {
    return {
      description: `This will remove ${bulkAction.validatorCount} validators from your cluster. This action cannot be undone.`,
      sourceValue: bulkAction.withdrawalAddress,
    };
  }

  if (bulkAction.lidoCsmOperatorId !== undefined) {
    return {
      description: `Lido CSM operator ${bulkAction.lidoCsmOperatorId} has ${bulkAction.validatorCount} validators. Do you want to add all of them to your cluster?`,
    };
  }

  return {
    description: `This withdrawal address has ${bulkAction.validatorCount} validators. Do you want to add all of them to your cluster?`,
    sourceValue: bulkAction.withdrawalAddress,
  };
}

/** Renders the confirmation dialog for bulk validator add and remove actions. */
export function BulkActionDialog({
  bulkAction,
  onClose,
  onConfirmAdd,
  onConfirmRemove,
}: BulkActionDialogProps) {
  const isAdd = bulkAction?.action === 'add';
  const copy = bulkAction ? getBulkActionDialogCopy(bulkAction) : null;

  return (
    <AlertDialog open={bulkAction !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Users className="size-5" />
            {isAdd ? 'Add Multiple Validators' : 'Remove Multiple Validators'}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <div>{copy?.description}</div>
              {copy?.sourceValue && (
                <code className="block bg-muted px-3 py-2 rounded text-xs break-all font-mono">
                  {copy.sourceValue}
                </code>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={isAdd ? onConfirmAdd : onConfirmRemove}
            className={!isAdd ? 'bg-destructive hover:bg-destructive/90' : ''}
          >
            {isAdd
              ? `Add ${bulkAction?.validatorCount} Validators`
              : `Remove ${bulkAction?.validatorCount} Validators`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
