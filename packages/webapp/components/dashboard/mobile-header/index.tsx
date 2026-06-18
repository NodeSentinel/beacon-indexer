import * as React from 'react';

import MobileNotifications from '@/components/dashboard/notifications/mobile-notifications';
import BellIcon from '@/components/icons/bell';
import MonkeyIcon from '@/components/icons/monkey';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import type { MockData } from '@/types/dashboard';

interface MobileHeaderProps {
  mockData: MockData;
}

export function MobileHeader({ mockData }: MobileHeaderProps) {
  const unreadCount = mockData.notifications.filter((n) => !n.read).length;

  return (
    <div className="lg:hidden h-header-mobile sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
      <div className="flex items-center justify-between px-4 py-3">
        {/* Left: Sidebar Menu */}
        <Button variant="outline" size="icon" aria-label="Open sidebar" />

        {/* Center: Monkey Logo + Time */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-16 bg-primary rounded flex items-center justify-center">
              <MonkeyIcon className="size-6 text-primary-foreground" />
            </div>
          </div>
        </div>

        <Sheet>
          {/* Right: Notifications Menu */}
          <SheetTrigger asChild>
            <Button variant="secondary" size="icon" className="relative">
              {unreadCount > 0 && (
                <Badge className="absolute border-2 border-background -top-1 -left-2 h-5 w-5 text-xs p-0 flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Badge>
              )}
              <BellIcon className="size-4" />
            </Button>
          </SheetTrigger>

          {/* Notifications Sheet */}
          <SheetContent closeButton={false} side="right" className="w-[80%] max-w-md p-0">
            <MobileNotifications initialNotifications={mockData.notifications} />
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
