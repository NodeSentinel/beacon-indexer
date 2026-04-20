'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Search } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import ValidatorDetails from '@/components/validator/validator-details';
import ValidatorRewardsList from '@/components/validator/validator-rewards-list';
import { orpc } from '@/lib/orpc';

export default function ValidatorDetailPage() {
  const params = useParams();
  const id = params?.id as string | undefined;

  const {
    data: response,
    isLoading,
    error,
    refetch,
  } = useQuery({
    ...orpc.validator.getValidator.queryOptions({ input: { id: id! } }),
    enabled: !!id,
  });

  const validatorData = response?.success ? response.data : null;
  const apiError = response && !response.success ? response.error : null;

  if (!id) {
    return (
      <div className="py-3 md:py-8 space-y-4 md:space-y-6">
        <Link
          href="/validator"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back to Validator Lookup
        </Link>
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
          <p className="text-destructive font-medium">Missing validator id</p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-3 md:py-8 space-y-4 md:space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back to Dashboard
        </Link>
        <span className="text-muted-foreground">/</span>
        <Link
          href="/validator"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Search className="size-4" />
          Validator Lookup
        </Link>
      </div>

      {isLoading && <ValidatorPageSkeleton />}

      {(error || apiError) && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
          <p className="text-destructive font-medium">
            {apiError?.message || error?.message || 'Failed to fetch validator data'}
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {validatorData && !isLoading && (
        <div className="space-y-4 md:space-y-6">
          <ValidatorDetails info={validatorData.validatorInfo} />
          <ValidatorRewardsList epochs={validatorData.epochs} />
        </div>
      )}
    </div>
  );
}

function ValidatorPageSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6">
      <div className="bg-card border border-border rounded-lg p-4 md:p-6">
        <div className="flex items-center gap-3 mb-4">
          <Skeleton className="size-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4 md:p-6">
        <Skeleton className="h-5 w-40 mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4 md:p-6">
        <Skeleton className="h-5 w-32 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="border border-border/50 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-4 w-32" />
              </div>
              <div className="grid grid-cols-4 gap-2 mt-2">
                {[1, 2, 3, 4].map((j) => (
                  <Skeleton key={j} className="h-4 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
