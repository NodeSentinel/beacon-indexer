import { cva, type VariantProps } from 'class-variance-authority';
import Image from 'next/image';

import DashboardCard from '@/components/dashboard/card';
import { Badge } from '@/components/ui/badge';
import { Bullet } from '@/components/ui/bullet';
import { cn } from '@/lib/utils';
import type { SecurityStatus as SecurityStatusType } from '@/types/dashboard';

const securityStatusItemVariants = cva('border rounded-md ring-4', {
  variants: {
    variant: {
      success: 'border-success bg-success/5 text-success ring-success/3',
      warning: 'border-warning bg-warning/5 text-warning ring-warning/3',
      destructive: 'border-destructive bg-destructive/5 text-destructive ring-destructive/3',
    },
  },
  defaultVariants: {
    variant: 'success',
  },
});

interface SecurityStatusItemProps extends VariantProps<typeof securityStatusItemVariants> {
  title: string;
  value: string;
  status: string;
  className?: string;
}

function SecurityStatusItem({ title, value, status, variant, className }: SecurityStatusItemProps) {
  return (
    <div className={cn(securityStatusItemVariants({ variant }), className)}>
      <div className="flex items-center gap-2 py-1.5 px-2.5 border-b border-current">
        <Bullet size="sm" variant={variant} />
        <span className="card-title">{title}</span>
      </div>
      <div className="py-2 px-2.5">
        <div className="value-secondary mb-1">{value}</div>
        <div className="text-helper">{status}</div>
      </div>
    </div>
  );
}

interface SecurityStatusProps {
  statuses: SecurityStatusType[];
}

export default function SecurityStatus({ statuses }: SecurityStatusProps) {
  return (
    <DashboardCard
      title="SECURITY STATUS"
      intent="success"
      addon={<Badge variant="outline-success">ONLINE</Badge>}
    >
      <div className="flex flex-col">
        <div className="max-md:order-1 grid grid-cols:3 md:grid-cols-1 gap-4 py-2 px-1 md:max-w-max">
          {statuses.map((item, index) => (
            <SecurityStatusItem
              key={index}
              title={item.title}
              value={item.value}
              status={item.status}
              variant={item.variant}
            />
          ))}
        </div>
        <picture className="md:absolute md:top-0 md:right-0 w-full md:w-auto md:h-full aspect-square min-[2160px]:right-[10%]">
          <Image
            src="/assets/bot_greenprint.gif"
            alt="Security Status"
            width={1000}
            height={1000}
            quality={90}
            className="size-full object-contain"
          />
        </picture>
      </div>
    </DashboardCard>
  );
}
