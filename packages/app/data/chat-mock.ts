import type { ChatData, ChatConversation, ChatUser } from '@/types/chat';

// Current user (JOYBOY based on the screenshot)
const currentUser: ChatUser = {
  id: 'joyboy',
  name: 'JOYBOY',
  username: '@JOYBOY',
  avatar: '/avatars/user_joyboy.png',
  isOnline: true,
};

// Other users
const users: Record<string, ChatUser> = {
  krimson: {
    id: 'krimson',
    name: 'KRIMSON',
    username: '@KRIMSON',
    avatar: '/avatars/user_krimson.png',
    isOnline: true,
  },
  mati: {
    id: 'mati',
    name: 'MATI',
    username: '@MATI',
    avatar: '/avatars/user_mati.png',
    isOnline: false,
  },
  pek: {
    id: 'pek',
    name: 'PEK',
    username: '@KRIMSON',
    avatar: '/avatars/user_pek.png',
    isOnline: true,
  },
  v0: {
    id: 'v0',
    name: 'V0',
    username: '@KRIMSON',
    avatar: '/avatars/user_krimson.png',
    isOnline: false,
  },
  rampant: {
    id: 'rampant',
    name: 'RAMPANT',
    username: '@RAMPANT.WORKS',
    avatar: '/avatars/user_mati.png',
    isOnline: false,
  },
};

// Mock conversations
const conversations: ChatConversation[] = [
  {
    id: 'conv-krimson',
    participants: [currentUser, users.krimson],
    unreadCount: 1,
    lastMessage: {
      id: 'msg-krimson-1',
      content: '💪💪💪💪💪',
      timestamp: '2024-07-10T16:00:00Z',
      senderId: 'krimson',
      isFromCurrentUser: false,
    },
    messages: [
      {
        id: 'msg-krimson-1',
        content: '💪💪💪💪💪',
        timestamp: '2024-07-10T16:00:00Z',
        senderId: 'krimson',
        isFromCurrentUser: false,
      },
    ],
  },
  {
    id: 'conv-mati',
    participants: [currentUser, users.mati],
    unreadCount: 0,
    lastMessage: {
      id: 'msg-mati-1',
      content: 'WE HAVE TO PAY TAXES?! DUDE',
      timestamp: '2024-06-06T14:30:00Z',
      senderId: 'mati',
      isFromCurrentUser: false,
    },
    messages: [
      {
        id: 'msg-mati-1',
        content: 'WE HAVE TO PAY TAXES?! DUDE',
        timestamp: '2024-06-06T14:30:00Z',
        senderId: 'mati',
        isFromCurrentUser: false,
      },
    ],
  },
  {
    id: 'conv-pek',
    participants: [currentUser, users.pek],
    unreadCount: 0,
    lastMessage: {
      id: 'msg-pek-last',
      content: 'JUST SHIP IT',
      timestamp: '2024-06-06T12:15:00Z',
      senderId: 'joyboy',
      isFromCurrentUser: true,
    },
    messages: [
      {
        id: 'msg-pek-1',
        content: 'HEY JOYBOY',
        timestamp: '2024-06-06T12:05:00Z',
        senderId: 'pek',
        isFromCurrentUser: false,
      },
      {
        id: 'msg-pek-2',
        content: 'REMEMBER THE PR I SENT U YD',
        timestamp: '2024-06-06T12:05:00Z',
        senderId: 'pek',
        isFromCurrentUser: false,
      },
      {
        id: 'msg-pek-3',
        content: 'Y',
        timestamp: '2024-06-06T12:08:00Z',
        senderId: 'joyboy',
        isFromCurrentUser: true,
      },
      {
        id: 'msg-pek-4',
        content: 'WHAT ABOUT IT',
        timestamp: '2024-06-06T12:08:00Z',
        senderId: 'joyboy',
        isFromCurrentUser: true,
      },
      {
        id: 'msg-pek-5',
        content: 'CAN U REVIEW',
        timestamp: '2024-06-06T12:11:00Z',
        senderId: 'pek',
        isFromCurrentUser: false,
      },
      {
        id: 'msg-pek-6',
        content: 'PLZ',
        timestamp: '2024-06-06T12:11:00Z',
        senderId: 'pek',
        isFromCurrentUser: false,
      },
      {
        id: 'msg-pek-last',
        content: 'JUST SHIP IT',
        timestamp: '2024-06-06T12:15:00Z',
        senderId: 'joyboy',
        isFromCurrentUser: true,
      },
    ],
  },
  {
    id: 'conv-v0',
    participants: [currentUser, users.v0],
    unreadCount: 0,
    lastMessage: {
      id: 'msg-v0-1',
      content: 'SO WILL YOU DO IT?',
      timestamp: '2024-06-02T10:00:00Z',
      senderId: 'v0',
      isFromCurrentUser: false,
    },
    messages: [
      {
        id: 'msg-v0-1',
        content: 'SO WILL YOU DO IT?',
        timestamp: '2024-06-02T10:00:00Z',
        senderId: 'v0',
        isFromCurrentUser: false,
      },
    ],
  },
  {
    id: 'conv-rampant',
    participants: [currentUser, users.rampant],
    unreadCount: 0,
    lastMessage: {
      id: 'msg-rampant-1',
      content: 'THE CLIENT WANTS THE LOGO BIGGER',
      timestamp: '2024-06-04T09:30:00Z',
      senderId: 'rampant',
      isFromCurrentUser: false,
    },
    messages: [
      {
        id: 'msg-rampant-1',
        content: 'THE CLIENT WANTS THE LOGO BIGGER',
        timestamp: '2024-06-04T09:30:00Z',
        senderId: 'rampant',
        isFromCurrentUser: false,
      },
    ],
  },
];

export const mockChatData: ChatData = {
  currentUser,
  conversations,
};
