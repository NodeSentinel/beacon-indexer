'use client';

import React from 'react';

import { Button } from '../ui/button';

import { ChatStatusIndicator } from './chat-status-indicator';
import { MobileChatContent } from './mobile-chat-content';
import { useChatState } from './use-chat-state';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';

export function MobileChat() {
  const { totalUnreadCount, chatState, setChatState } = useChatState();
  const isMobile = useIsMobile();
  const hasNewMessages = totalUnreadCount > 0;

  // Sheet should be open for both "expanded" and "conversation" states
  const isOpen = chatState.state === 'expanded' || chatState.state === 'conversation';

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Only close if not in a conversation, or if we want to force close
      setChatState({ state: 'collapsed' });
    } else {
      setChatState({ state: 'expanded' });
    }
  };

  // Don't render at all on desktop screens
  if (!isMobile) {
    return null;
  }

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange} defaultOpen={false}>
      {/* Floating CTA Button - Styled like collapsed desktop chat */}
      <SheetTrigger asChild>
        <Button size="xl" className="pl-3 fixed gap-4 bottom-4 right-4 z-40 md:hidden">
          {/* Status Indicator */}
          <ChatStatusIndicator
            isExpanded={false}
            hasUnreadMessages={hasNewMessages}
            unreadCount={totalUnreadCount}
          />

          {/* Title */}
          <span>{hasNewMessages ? `New Message${totalUnreadCount > 1 ? 's' : ''}` : 'Chat'}</span>
        </Button>
      </SheetTrigger>

      {/* Chat Drawer */}
      <SheetContent side="bottom" className="h-[85vh] p-0 md:hidden" closeButton={false}>
        <SheetHeader className="sr-only">
          <SheetTitle>Chat</SheetTitle>
        </SheetHeader>

        <MobileChatContent />
      </SheetContent>
    </Sheet>
  );
}
