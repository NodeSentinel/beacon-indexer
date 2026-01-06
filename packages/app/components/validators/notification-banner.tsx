'use client';

import { X, AlertTriangle, Info, AlertCircle, CheckCircle } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

export type NotificationType = 'warning' | 'info' | 'error' | 'success';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
}

interface NotificationBannerProps {
  notifications: Notification[];
  onDismiss?: (id: string) => void;
}

const notificationConfig = {
  warning: {
    icon: AlertTriangle,
    bgColor: 'bg-warning/10',
    borderColor: 'border-warning/30',
    iconColor: 'text-warning',
    textColor: 'text-warning-foreground',
  },
  info: {
    icon: Info,
    bgColor: 'bg-primary/10',
    borderColor: 'border-primary/30',
    iconColor: 'text-primary',
    textColor: 'text-foreground',
  },
  error: {
    icon: AlertCircle,
    bgColor: 'bg-destructive/10',
    borderColor: 'border-destructive/30',
    iconColor: 'text-destructive',
    textColor: 'text-destructive-foreground',
  },
  success: {
    icon: CheckCircle,
    bgColor: 'bg-chart-2/10',
    borderColor: 'border-chart-2/30',
    iconColor: 'text-chart-2',
    textColor: 'text-foreground',
  },
};

export default function NotificationBanner({ notifications, onDismiss }: NotificationBannerProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const handleDismiss = (id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id));
    onDismiss?.(id);
  };

  const visibleNotifications = notifications.filter((n) => !dismissedIds.has(n.id));

  if (visibleNotifications.length === 0) return null;

  return (
    <div className="space-y-2">
      {visibleNotifications.map((notification) => {
        const config = notificationConfig[notification.type];
        const Icon = config.icon;

        return (
          <div
            key={notification.id}
            className={cn(
              'flex items-start gap-3 p-4 rounded-lg border-l-4 transition-all',
              config.bgColor,
              config.borderColor,
              config.textColor,
            )}
          >
            <Icon className={cn('w-5 h-5 flex-shrink-0 mt-0.5', config.iconColor)} />
            <p className="flex-1 text-sm leading-relaxed">{notification.message}</p>
            <button
              onClick={() => handleDismiss(notification.id)}
              className="flex-shrink-0 p-1 hover:bg-background/50 rounded transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
