import Image from 'next/image';

import { formatDate } from './utils';

import { Badge } from '@/components/ui/badge';
import type { ChatConversation, ChatUser } from '@/types/chat';

interface ChatContactProps {
  conversation: ChatConversation;
  otherUser: ChatUser;
  onOpenConversation: (conversationId: string) => void;
}

export default function ChatContact({
  conversation,
  otherUser,
  onOpenConversation,
}: ChatContactProps) {
  return (
    <div
      className="flex items-center gap-3 p-4 hover:bg-gray-800 cursor-pointer border-b border-gray-800"
      onClick={() => onOpenConversation(conversation.id)}
    >
      {conversation.unreadCount > 0 && (
        <Badge className="bg-blue-600 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center p-0">
          {conversation.unreadCount}
        </Badge>
      )}

      <div className="relative">
        <Image
          src={otherUser.avatar}
          alt={otherUser.name}
          width={40}
          height={40}
          className="rounded-lg"
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm">{otherUser.name}</h3>
          <span className="text-xs text-gray-400">
            {formatDate(conversation.lastMessage.timestamp)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">{otherUser.username}</p>
        </div>
        <p className="text-xs text-gray-300 truncate mt-1">{conversation.lastMessage.content}</p>
      </div>
    </div>
  );
}
