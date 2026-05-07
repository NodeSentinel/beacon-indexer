'use client';

import { X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface FeeRecipientInputProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function FeeRecipientInput({ error, onChange, value }: FeeRecipientInputProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="feeRecipient">Fee Recipient Address (Execution Rewards)</Label>
      <div className="relative">
        <Input
          id="feeRecipient"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0x..."
          aria-invalid={!!error}
          className={`pr-10 ${error ? 'border-destructive' : ''}`}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear fee recipient address"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
