'use client';

import { motion, AnimatePresence } from 'motion/react';

import { cn } from '@/lib/utils';

interface ChatStatusIndicatorProps {
  isExpanded?: boolean;
  hasUnreadMessages?: boolean;
  unreadCount?: number;
}

export function ChatStatusIndicator({
  isExpanded = false,
  hasUnreadMessages = false,
  unreadCount = 0,
}: ChatStatusIndicatorProps) {
  return (
    <div
      className={cn(
        'size-3 rounded-[1.5px] transition-[width,height,background-color] duration-300 ease-anticipate',
        hasUnreadMessages
          ? 'bg-primary-foreground text-primary text-center font-bold text-xs flex items-center justify-center'
          : isExpanded
            ? 'bg-success'
            : 'bg-primary',
        hasUnreadMessages ? 'size-6' : 'size-3',
      )}
    >
      <AnimatePresence initial={false}>
        {hasUnreadMessages && (
          <motion.span
            key={unreadCount}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ ease: 'backOut', duration: 0.2 }}
          >
            {unreadCount}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
