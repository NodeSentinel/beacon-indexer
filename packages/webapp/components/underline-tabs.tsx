'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';

import { cn } from '@/lib/utils';

function UnderlineTabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="underline-tabs"
      className={cn('flex flex-col gap-2 w-full', className)}
      {...props}
    />
  );
}

function UnderlineTabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <div className="overflow-x-auto -mx-1 px-1 scrollbar-thin">
      <TabsPrimitive.List
        data-slot="underline-tabs-list"
        className={cn(
          'inline-flex w-auto min-w-full md:w-full bg-transparent p-0 h-auto border-b border-border/50 rounded-none gap-0',
          className,
        )}
        {...props}
      />
    </div>
  );
}

function UnderlineTabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="underline-tabs-trigger"
      className={cn(
        'h-9 flex-shrink-0 inline-flex items-center gap-1 whitespace-nowrap px-3 md:px-4 rounded-none border-b-2 border-transparent',
        'data-[state=active]:border-b-primary data-[state=active]:bg-transparent',
        'text-xs text-muted-foreground uppercase tracking-wider font-medium',
        'data-[state=active]:text-foreground',
        'transition-colors duration-200',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

function UnderlineTabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="underline-tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  );
}

export { UnderlineTabs, UnderlineTabsList, UnderlineTabsTrigger, UnderlineTabsContent };
