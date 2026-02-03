import { create } from 'zustand';

import { mockChatData } from '@/data/chat-mock';
import type { ChatState, ChatMessage, ChatConversation } from '@/types/chat';

type ChatComponentState = {
  state: ChatState;
  activeConversation?: string;
};

interface ChatStore {
  // State
  chatState: ChatComponentState;
  conversations: ChatConversation[];
  newMessage: string;

  // Actions
  setChatState: (state: ChatComponentState) => void;
  setConversations: (conversations: ChatConversation[]) => void;
  setNewMessage: (message: string) => void;
  handleSendMessage: () => void;
  openConversation: (conversationId: string) => void;
  goBack: () => void;
  toggleExpanded: () => void;
}

const chatStore = create<ChatStore>((set, get) => ({
  // Initial state
  chatState: {
    state: 'collapsed',
  },
  conversations: mockChatData.conversations,
  newMessage: '',

  // Actions
  setChatState: (chatState) => set({ chatState }),

  setConversations: (conversations) => set({ conversations }),

  setNewMessage: (newMessage) => set({ newMessage }),

  handleSendMessage: () => {
    const { newMessage, conversations, chatState } = get();
    const activeConv = conversations.find((conv) => conv.id === chatState.activeConversation);

    if (!newMessage.trim() || !activeConv) return;

    const message: ChatMessage = {
      id: `msg-${Date.now()}`,
      content: newMessage.trim(),
      timestamp: new Date().toISOString(),
      senderId: mockChatData.currentUser.id,
      isFromCurrentUser: true,
    };

    const updatedConversations = conversations.map((conv) =>
      conv.id === activeConv.id
        ? {
            ...conv,
            messages: [...conv.messages, message],
            lastMessage: message,
          }
        : conv,
    );

    set({
      conversations: updatedConversations,
      newMessage: '',
    });
  },

  openConversation: (conversationId) => {
    const { conversations } = get();

    // Update chat state
    set({
      chatState: { state: 'conversation', activeConversation: conversationId },
    });

    // Mark conversation as read
    const updatedConversations = conversations.map((conv) =>
      conv.id === conversationId ? { ...conv, unreadCount: 0 } : conv,
    );

    set({ conversations: updatedConversations });
  },

  goBack: () => {
    const { chatState } = get();
    if (chatState.state === 'conversation') {
      set({ chatState: { state: 'expanded' } });
    } else {
      set({ chatState: { state: 'collapsed' } });
    }
  },

  toggleExpanded: () => {
    const { chatState } = get();
    set({
      chatState: {
        state: chatState.state === 'collapsed' ? 'expanded' : 'collapsed',
      },
    });
  },
}));

// Hook with computed values using selectors
export const useChatState = () => {
  const chatState = chatStore((state) => state.chatState);
  const conversations = chatStore((state) => state.conversations);
  const newMessage = chatStore((state) => state.newMessage);
  const setChatState = chatStore((state) => state.setChatState);
  const setConversations = chatStore((state) => state.setConversations);
  const setNewMessage = chatStore((state) => state.setNewMessage);
  const handleSendMessage = chatStore((state) => state.handleSendMessage);
  const openConversation = chatStore((state) => state.openConversation);
  const goBack = chatStore((state) => state.goBack);
  const toggleExpanded = chatStore((state) => state.toggleExpanded);

  // Computed values
  const totalUnreadCount = conversations.reduce((total, conv) => total + conv.unreadCount, 0);

  const activeConversation = conversations.find((conv) => conv.id === chatState.activeConversation);

  return {
    chatState,
    conversations,
    newMessage,
    totalUnreadCount,
    activeConversation,
    setChatState,
    setConversations,
    setNewMessage,
    handleSendMessage,
    openConversation,
    goBack,
    toggleExpanded,
  };
};
