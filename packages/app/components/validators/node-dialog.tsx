'use client';

import ValidatorList from './validator-list';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Node } from '@/types/validator';

interface NodeDialogProps {
  node: Node | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function NodeDialog({ node, open, onOpenChange }: NodeDialogProps) {
  const isEditing = node !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {isEditing ? node.name : 'Add New Node'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Manage your node settings and validators'
              : 'Create a new node to monitor validators'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-4">
            <div>
              <Label htmlFor="node-name">Node Name</Label>
              <Input id="node-name" defaultValue={node?.name} placeholder="Enter node name" />
            </div>

            <div>
              <Label htmlFor="withdrawal-address">Withdrawal Address</Label>
              <Input
                id="withdrawal-address"
                defaultValue={node?.withdrawalAddresses?.[0]}
                placeholder="0x..."
                className="font-mono text-sm"
              />
            </div>

            <div>
              <Label htmlFor="fee-address">Fee Address</Label>
              <Input
                id="fee-address"
                defaultValue={node?.feeRecipientAddress}
                placeholder="0x..."
                className="font-mono text-sm"
              />
            </div>
          </div>

          {isEditing && node && (
            <>
              <div role="separator" className="h-px w-full bg-border" />

              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="font-display text-lg">VALIDATORS</h3>
                    <Badge variant="secondary">{node.validators.length}</Badge>
                  </div>
                  <Button size="sm" variant="outline">
                    Add Validator
                  </Button>
                </div>

                <ValidatorList validators={node.validators} />
              </div>

              <div role="separator" className="h-px w-full bg-border" />

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Claimable Rewards</p>
                  <p className="text-2xl font-display text-success">
                    {node.claimableRewards.toFixed(4)} GNO
                  </p>
                </div>
                <Button variant="default">Claim Rewards</Button>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button>{isEditing ? 'Save Changes' : 'Create Node'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
