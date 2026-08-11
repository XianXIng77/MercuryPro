export type FolderId =
  | 'inbox'
  | 'starred'
  | 'sent'
  | 'drafts'
  | 'archive'
  | 'trash'
  | 'spam'
  | string;

export interface Folder {
  id: FolderId;
  name: string;
  icon: string;
  type: 'system' | 'custom';
  unreadCount: number;
  color?: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string; // Tailwind color name e.g. 'red', 'emerald', 'purple', 'blue', 'amber', 'slate'
  bgClass: string;
  textClass: string;
  borderClass: string;
}

export interface Attachment {
  id: string;
  name: string;
  size: string;
  type: 'pdf' | 'doc' | 'image' | 'zip' | 'other';
  url?: string;
}

export interface Email {
  id: string;
  senderName: string;
  senderEmail: string;
  senderAvatar?: string;
  recipient: string;
  subject: string;
  snippet: string;
  body: string;
  bodyContentType?: 'text' | 'html';
  date: string;
  timestamp: number;
  isRead: boolean;
  isStarred: boolean;
  folderId: FolderId;
  tags: string[]; // Tag names or IDs
  urgency: 'high' | 'normal' | 'low';
  attachments?: Attachment[];
  aiSummary?: string;
  aiKeyPoints?: string[];
}

export interface AutoTagRule {
  id: string;
  name: string;
  enabled: boolean;
  conditionType: 'subject_contains' | 'sender_contains' | 'body_contains' | 'has_attachment';
  conditionValue: string;
  applyTags: string[];
  targetFolderId?: FolderId;
  markStarred?: boolean;
}

export type StylePresetId = 'dark-eye-care' | 'dark-obsidian' | 'muted-gray' | 'soft-light-gray' | string;

export interface StylePreset {
  id: StylePresetId;
  name: string;
  description: string;
  mode: 'light' | 'dark';
  preview: [string, string, string];
  themeClasses: {
    appBg: string;
    navBg: string;
    sidebarBg: string;
    cardBg: string;
    textPrimary: string;
    textSecondary: string;
    border: string;
    accentBg: string;
    accentText: string;
    activeItemBg: string;
    shadow: string;
    radius: string;
  };
}

export type NavTab = 'email' | 'register' | 'calendar' | 'contacts' | 'analytics' | 'tickets' | 'settings';

export interface MailAccount {
  id: string;
  accountId?: number | string;
  accountName: string;
  emailAddress: string;
  protocol: 'IMAP' | 'POP3' | 'Exchange';
  serverHost: string;
  status: 'active' | 'syncing' | 'error' | 'idle';
  unreadCount: number;
  totalMails: number;
  lastSyncTime: string;
  tags: string[];
  department?: string;
  clientId?: string;
  refreshToken?: string;
  accessToken?: string;
  scope?: string;
  grantType?: string;
  backendStatus?: string;
  usageStatus: '未用' | '使用中' | '已用';
  registrationUseCount?: number;
  registrationUseLimit?: number;
  grokRegistrationUseCount?: number;
  grokRegistrationUseLimit?: number;
  openaiRegistrationUseCount?: number;
  openaiRegistrationUseLimit?: number;
  openaiRegistrationUsed?: boolean;
  openaiRegistrationFailed?: boolean;
  openaiRegistrationFailureReason?: string;
  createdTime: string;
  refreshResult: '未刷新' | '刷新成功' | '刷新失败';
  messages: Email[];
}
