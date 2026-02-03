'use client';

import DashboardCard from '@/components/dashboard/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Node } from '@/types/validator';

interface NodeCardProps {
  node: Node;
  onClick: () => void;
}

export default function NodeCard({ node, onClick }: NodeCardProps) {
  const _activeValidators = node.validators.filter((v) => v.status === 'active').length;
  const inactiveValidators = node.validators.filter((v) => v.status === 'inactive').length;

  return (
    <DashboardCard
      title={node.name}
      intent={node.performance >= 98 ? 'success' : 'default'}
      className="cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
      onClick={onClick}
    >
      <div className="section-spacing">
        <div className="grid grid-cols-2 grid-spacing">
          <div>
            <p className="label-primary mb-1">VALIDATORS</p>
            <div className="flex items-center gap-2">
              <span className="value-secondary">{node.validators.length}</span>
              {inactiveValidators > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {inactiveValidators} inactive
                </Badge>
              )}
            </div>
          </div>
          <div>
            <p className="label-primary mb-1">PERFORMANCE</p>
            <span
              className={cn(
                'value-secondary',
                node.performance >= 98
                  ? 'text-success'
                  : node.performance >= 95
                    ? 'text-warning'
                    : 'text-destructive',
              )}
            >
              {node.performance.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 grid-spacing">
          <div>
            <p className="label-primary mb-1">BALANCE</p>
            <span className="value-small">{node.totalBalance.toFixed(2)} GNO</span>
          </div>
          <div>
            <p className="label-primary mb-1">CLAIMABLE</p>
            <span className="value-small text-success">{node.claimableRewards.toFixed(2)} GNO</span>
          </div>
        </div>

        <div className="pt-3 border-t border-border space-y-2">
          <div>
            <p className="label-primary">WITHDRAWAL ADDRESS</p>
            <code className="text-helper font-mono">{node.withdrawalAddresses[0] ?? '-'}</code>
          </div>
          <div>
            <p className="label-primary">FEE ADDRESS</p>
            <code className="text-helper font-mono">{node.feeRecipientAddress}</code>
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}
