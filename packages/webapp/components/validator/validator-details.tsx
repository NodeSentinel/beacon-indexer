'use client';

import { Check, Copy, ExternalLink, User } from 'lucide-react';
import { useState } from 'react';

import DashboardCard from '@/components/dashboard/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatNumber } from '@/lib/utils';

interface ValidatorInfo {
  id: number;
  pubkey: string | null;
  withdrawalAddress: string | null;
  status: { id: number; value: string } | null;
  balance: string;
  effectiveBalance: string | null;
}

interface ValidatorDetailsProps {
  info: ValidatorInfo;
}

/** Badge variant by Beacon API status value (from API) */
const STATUS_VARIANT: Partial<
  Record<string, 'outline-success' | 'outline-warning' | 'outline-destructive' | 'outline'>
> = {
  active_ongoing: 'outline-success',
  active_exiting: 'outline-warning',
  active_slashed: 'outline-destructive',
  exited_slashed: 'outline-destructive',
};

function formatStatusLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

function truncateAddress(address: string, startChars = 10, endChars = 8): string {
  if (address.length <= startChars + endChars) return address;
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

export default function ValidatorDetails({ info }: ValidatorDetailsProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const statusValue = info.status?.value;
  const statusVariant = statusValue ? (STATUS_VARIANT[statusValue] ?? 'outline') : 'outline';
  const statusLabel = statusValue ? formatStatusLabel(statusValue) : 'Unknown';

  return (
    <DashboardCard
      title={
        <div className="flex items-center gap-2">
          <span>Validator Details</span>
          <Badge variant={statusVariant}>{statusLabel}</Badge>
        </div>
      }
      intent={statusVariant === 'outline-success' ? 'success' : 'default'}
    >
      <div className="space-y-4">
        {/* Validator Index and Pubkey */}
        <div className="flex flex-col md:flex-row md:items-center gap-3 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 rounded-lg">
              <User className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Index</p>
              <p className="text-xl font-display font-bold">#{formatNumber(info.id)}</p>
            </div>
          </div>

          {info.pubkey && (
            <div className="flex-1 md:ml-6">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Pubkey</p>
              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <code className="text-sm font-mono bg-muted/50 px-2 py-1 rounded cursor-pointer hover:bg-muted transition-colors">
                        {truncateAddress(info.pubkey, 12, 10)}
                      </code>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-md">
                      <code className="text-xs break-all">{info.pubkey}</code>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => copyToClipboard(info.pubkey!, 'pubkey')}
                >
                  {copiedField === 'pubkey' ? (
                    <Check className="size-3.5 text-success" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Balances and Withdrawal Address */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="label-primary mb-1">BALANCE</p>
            <p className="text-lg md:text-xl font-display font-bold">
              {formatNumber(info.balance, 5)}
            </p>
          </div>

          {info.effectiveBalance && (
            <div>
              <p className="label-primary mb-1">EFFECTIVE BALANCE</p>
              <p className="text-lg md:text-xl font-display font-bold">
                {formatNumber(info.effectiveBalance, 5)}
              </p>
            </div>
          )}

          <div className="col-span-2">
            <p className="label-primary mb-1">WITHDRAWAL ADDRESS</p>
            {info.withdrawalAddress ? (
              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <code className="text-sm font-mono bg-muted/50 px-2 py-1 rounded cursor-pointer hover:bg-muted transition-colors">
                        {truncateAddress(info.withdrawalAddress)}
                      </code>
                    </TooltipTrigger>
                    <TooltipContent>
                      <code className="text-xs">{info.withdrawalAddress}</code>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => copyToClipboard(info.withdrawalAddress!, 'withdrawal')}
                >
                  {copiedField === 'withdrawal' ? (
                    <Check className="size-3.5 text-success" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </Button>
                <Button variant="ghost" size="icon-sm" asChild>
                  <a
                    href={`https://etherscan.io/address/${info.withdrawalAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Not set</p>
            )}
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}
