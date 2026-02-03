import type React from 'react';

import { Bullet } from '@/components/ui/bullet';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

interface DashboardCardProps extends Omit<React.ComponentProps<typeof Card>, 'title'> {
  title: React.ReactNode;
  addon?: React.ReactNode;
  action?: React.ReactNode;
  intent?: 'default' | 'success';
  children: React.ReactNode;
}

export default function DashboardCard({
  title,
  addon,
  action,
  intent = 'default',
  children,
  className,
  ...props
}: DashboardCardProps) {
  return (
    <Card className={className} {...props}>
      <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-0 relative pb-3 md:pb-4 min-h-[52px]">
        <CardTitle className="card-title flex items-center justify-center md:justify-start gap-2.5 flex-wrap md:flex-1">
          <Bullet variant={intent} />
          <span className="leading-tight">{title}</span>
        </CardTitle>
        {action && <div className="flex justify-center md:justify-end shrink-0">{action}</div>}
        {addon && (
          <div className="md:absolute md:right-4 md:top-1/2 md:-translate-y-1/2 flex justify-center">
            {addon}
          </div>
        )}
      </CardHeader>

      <CardContent className="flex-1 relative p-3 md:p-4">{children}</CardContent>
    </Card>
  );
}
