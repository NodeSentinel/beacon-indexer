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
}

interface BulkActionDialogProps {
  bulkAction: BulkAction | null;
  onClose: () => void;
  onConfirmAdd: () => void;
  onConfirmRemove: () => void;
}

export function BulkActionDialog({
  bulkAction,
  onClose,
  onConfirmAdd,
  onConfirmRemove,
}: BulkActionDialogProps) {
  const isAdd = bulkAction?.action === 'add';

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
              <div>
                {isAdd
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
