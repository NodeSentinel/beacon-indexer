'use client';

import { Server, Bell, Settings, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import AlertConfiguration from './alert-configuration';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import type { ValidatorData } from '@/types/validator';
import validatorMockJson from '@/validator-mock.json';

const validatorData = validatorMockJson as ValidatorData;

export default function ValidatorHeader() {
  const [alertsOpen, setAlertsOpen] = React.useState(false);

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="h-9 w-9 bg-primary rounded flex items-center justify-center">
                <Server className="size-5 text-primary-foreground" />
              </div>
              <span className="font-display text-xl hidden sm:inline-block">Validator Monitor</span>
            </Link>

            <nav className="hidden md:flex items-center gap-2">
              <Button variant="ghost" size="sm" asChild>
                <a
                  href="https://forms.gle/vEEjdjCELesrsEvLA"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageSquare className="size-4 mr-2" />
                  Feedback
                </a>
              </Button>

              <Button variant="ghost" size="sm" onClick={() => setAlertsOpen(true)}>
                <Bell className="size-4 mr-2" />
                Configure Alerts
              </Button>
            </nav>

            <div className="flex md:hidden items-center gap-2">
              <Button variant="ghost" size="icon" asChild>
                <a
                  href="https://forms.gle/vEEjdjCELesrsEvLA"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageSquare className="size-5" />
                </a>
              </Button>

              <Button variant="ghost" size="icon" onClick={() => setAlertsOpen(true)}>
                <Settings className="size-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <Sheet open={alertsOpen} onOpenChange={setAlertsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <div className="mt-6">
            <AlertConfiguration config={validatorData.alertConfig} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
