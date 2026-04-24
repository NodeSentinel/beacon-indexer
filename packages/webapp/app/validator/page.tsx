'use client';

import { ArrowLeft, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ValidatorPage() {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchInput.trim();
    if (trimmed) {
      router.push(`/validator/${encodeURIComponent(trimmed)}`);
    }
  };

  return (
    <div className="py-3 md:py-8 space-y-4 md:space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-4" />
        Back to Dashboard
      </Link>

      <div className="space-y-2">
        <h1 className="text-xl md:text-2xl font-display font-bold">Validator Lookup</h1>
        <p className="text-sm text-muted-foreground">
          Enter a validator index or pubkey to view details
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Validator index or pubkey (0x...)"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-10 h-11"
          />
        </div>
        <Button type="submit" size="lg" disabled={!searchInput.trim()}>
          Search
        </Button>
      </form>

      <div className="text-center py-12 text-muted-foreground">
        <Search className="size-12 mx-auto mb-4 opacity-50" />
        <p>Enter a validator index or pubkey to get started</p>
      </div>
    </div>
  );
}
