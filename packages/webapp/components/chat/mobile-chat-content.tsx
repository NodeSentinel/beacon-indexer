'use client';

import { motion, AnimatePresence } from 'motion/react';
import React from 'react';

import PlusIcon from '../icons/plus';

import ChatConversation from './chat-conversation';
import { ChatHeader } from './chat-header';
import ChatPreview from './chat-preview';
import { useChatState } from './use-chat-state';

import { Button } from '@/components/ui/button';

export function MobileChatContent() {
  const {
    chatState,
    conversations,
    newMessage,
    setNewMessage,
    activeConversation,
    handleSendMessage,
    openConversation,
    goBack,
  } = useChatState();

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <ChatHeader
        variant="mobile"
        showBackButton={chatState.state === 'conversation'}
        onBackClick={goBack}
        className="rounded-none border-b border-border"
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-background">
        <AnimatePresence mode="wait">
          {chatState.state === 'conversation' && activeConversation ? (
            <ChatConversation
              key="conversation"
              activeConversation={activeConversation!}
              newMessage={newMessage}
              setNewMessage={setNewMessage}
              onSendMessage={handleSendMessage}
            />
          ) : (
            <motion.div
              key="expanded"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="h-full flex flex-col"
            >
              {/* Conversations List */}
              <div className="flex-1 flex flex-col overflow-y-auto">
                {conversations.map((conversation) => (
                  <ChatPreview
                    key={conversation.id}
                    conversation={conversation}
                    onOpenConversation={openConversation}
                  />
                ))}

                {/* Footer */}
                <div className="mt-auto flex justify-end p-4 sticky bottom-0 bg-gradient-to-t from-background via-background/80 to-black/0">
                  <Button size="lg" variant="secondary" className="pl-0 py-0 gap-4 overflow-clip">
                    <div className="bg-primary text-primary-foreground h-full aspect-square border-r-2 border-background flex items-center justify-center">
                      <PlusIcon className="size-4" />
                    </div>
                    New Chat
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
