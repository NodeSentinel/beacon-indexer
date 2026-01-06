import { motion } from 'motion/react';

import ChatContact from './chat-contact';

import { Button } from '@/components/ui/button';
import { mockChatData } from '@/data/chat-mock';
import type { ChatConversation } from '@/types/chat';

interface ChatExpandedProps {
  conversations: ChatConversation[];
  onOpenConversation: (conversationId: string) => void;
  onGoBack: () => void;
}

export default function ChatExpanded({
  conversations,
  onOpenConversation,
  onGoBack,
}: ChatExpandedProps) {
  return (
    <motion.div
      key="expanded"
      initial={{ opacity: 0, y: 20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.9 }}
      className="bg-black text-white rounded-lg shadow-xl w-80 max-h-96 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
          <span className="text-sm font-medium uppercase">ONLINE</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onGoBack}
          className="text-white hover:bg-gray-800 h-8 w-8 p-0"
        >
          −
        </Button>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto max-h-80">
        {conversations.map((conversation) => {
          const otherUser = conversation.participants.find(
            (p) => p.id !== mockChatData.currentUser.id,
          );
          if (!otherUser) return null;

          return (
            <ChatContact
              key={conversation.id}
              conversation={conversation}
              otherUser={otherUser}
              onOpenConversation={onOpenConversation}
            />
          );
        })}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span>+</span>
          <span>NEW CHAT</span>
        </div>
      </div>
    </motion.div>
  );
}
