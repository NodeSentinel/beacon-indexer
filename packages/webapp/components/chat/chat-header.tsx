'use client';

import { motion, AnimatePresence } from 'motion/react';
import React from 'react';

import ArrowLeftIcon from '../icons/arrow-left';
import MinusIcon from '../icons/minus';
import PlusIcon from '../icons/plus';

import { ChatStatusIndicator } from './chat-status-indicator';
import { useChatState } from './use-chat-state';

import { Button } from '@/components/ui/button';
import { mockChatData } from '@/data/chat-mock';
import { cn } from '@/lib/utils';
import { useIsV0 } from '@/lib/v0-context';

interface ChatHeaderProps {
  onClick?: () => void;
  showBackButton?: boolean;
  onBackClick?: () => void;
  variant?: 'desktop' | 'mobile';
  className?: string;
}

export function ChatHeader({
  onClick,
  showBackButton = false,
  onBackClick,
  variant = 'desktop',
  className,
}: ChatHeaderProps) {
  const { chatState, totalUnreadCount, activeConversation, goBack, toggleExpanded } =
    useChatState();

  const isV0 = useIsV0();

  const hasNewMessages = totalUnreadCount > 0;
  const shouldHighlightUnreadMessages =
    variant === 'mobile' ? false : chatState.state === 'collapsed' && hasNewMessages;
  const otherUser = activeConversation?.participants.find(
    (p) => p.id !== mockChatData.currentUser.id,
  );

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (variant === 'desktop') {
      toggleExpanded();
    }
  };

  const handleBackClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onBackClick) {
      onBackClick();
    } else {
      goBack();
    }
  };

  return (
    <motion.div
      layout
      className={cn(
        'cursor-pointer flex items-center gap-3 transition-all duration-300',
        shouldHighlightUnreadMessages
          ? 'w-full h-14 bg-primary text-primary-foreground rounded-t-lg px-4 py-3'
          : 'w-full h-14 bg-background text-foreground rounded-t-lg px-4 py-3',
        className,
      )}
      onClick={handleClick}
    >
      <AnimatePresence mode={isV0 ? 'wait' : 'popLayout'}>
        {(showBackButton || chatState.state === 'conversation') && (
          <motion.div
            key="back"
            initial={{ opacity: 0, scale: 0.8, translateX: '-100%' }}
            animate={{ opacity: 1, scale: 1, translateX: 0 }}
            exit={{ opacity: 0, scale: 0.8, translateX: '-100%' }}
            transition={{ ease: 'backInOut', duration: 0.4 }}
            className="flex items-center gap-1 group/back"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackClick}
              className="text-foreground/50 p-1 pr-3"
            >
              <ArrowLeftIcon className="size-5" />
            </Button>
            <div
              role="separator"
              aria-orientation="vertical"
              className="bg-border w-px !h-6 group-hover/back:opacity-0 transition-opacity duration-300"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header Content */}
      <motion.div layout className="flex items-center gap-2 flex-1">
        {/* Status Indicator */}
        <ChatStatusIndicator
          isExpanded={chatState.state === 'expanded' || chatState.state === 'conversation'}
          hasUnreadMessages={shouldHighlightUnreadMessages}
          unreadCount={totalUnreadCount}
        />

        {/* Dynamic Title */}
        <span className="text-sm font-medium uppercase">
          {(() => {
            // Mobile variant
            if (variant === 'mobile') {
              if (chatState.state === 'conversation') {
                return otherUser?.name || 'CONVERSATION';
              }
              return 'ONLINE';
            }

            // Desktop variant
            if (chatState.state === 'collapsed') {
              return shouldHighlightUnreadMessages
                ? `${totalUnreadCount} New Message${totalUnreadCount > 1 ? 's' : ''}`
                : 'Chat';
            }

            if (chatState.state === 'conversation') {
              return otherUser?.name || 'CONVERSATION';
            }

            return 'ONLINE';
          })()}
        </span>
      </motion.div>

      {/* Action Buttons */}
      {variant === 'desktop' && (
        <AnimatePresence mode={isV0 ? 'wait' : 'popLayout'} initial={false}>
          <motion.div
            key={chatState.state}
            initial={{ opacity: 0, scale: 0.8, rotate: -90 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.8, rotate: 90 }}
          >
            {chatState.state === 'collapsed' ? (
              <PlusIcon className="size-4" />
            ) : (
              <MinusIcon className="size-4" />
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </motion.div>
  );
}
