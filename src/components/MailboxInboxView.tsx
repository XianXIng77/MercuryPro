import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MailAccount, Email, StylePreset } from '../types';
import {
  ArrowLeft,
  RefreshCw,
  Search,
  Star,
  Paperclip,
  CheckCircle2,
  Inbox,
  Mail,
  ChevronLeft,
  Sparkles,
  FileText,
} from 'lucide-react';

interface MailboxInboxViewProps {
  account: MailAccount;
  onBackToAccountList: () => void;
  onSyncSingleAccount: (id: string) => void;
  currentPreset: StylePreset;
}

export const MailboxInboxView: React.FC<MailboxInboxViewProps> = ({
  account,
  onBackToAccountList,
  onSyncSingleAccount,
  currentPreset,
}) => {
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.id.includes('dark');

  const [messages, setMessages] = useState<Email[]>(account.messages || []);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [inboxSearch, setInboxSearch] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'unread'>('all');
  const [isSyncingThisAccount, setIsSyncingThisAccount] = useState<boolean>(false);

  // Sync this specific account messages
  const handleSyncThisAccount = () => {
    setIsSyncingThisAccount(true);
    onSyncSingleAccount(account.id);
    setTimeout(() => {
      setIsSyncingThisAccount(false);
    }, 1000);
  };

  // Toggle starred status
  const handleToggleStar = (msgId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, isStarred: !m.isStarred } : m))
    );
  };

  // Filter messages
  const visibleMessages = messages.filter((msg) => {
    if (filterType === 'unread' && msg.isRead) return false;
    if (inboxSearch.trim()) {
      const q = inboxSearch.toLowerCase();
      const matchSubject = msg.subject.toLowerCase().includes(q);
      const matchSender = msg.senderName.toLowerCase().includes(q);
      const matchEmail = msg.senderEmail.toLowerCase().includes(q);
      const matchSnippet = msg.snippet.toLowerCase().includes(q);
      if (!matchSubject && !matchSender && !matchEmail && !matchSnippet) return false;
    }
    return true;
  });

  const selectedMessage = messages.find((m) => m.id === selectedMessageId);

  const handleSelectMessage = (msg: Email) => {
    setSelectedMessageId(msg.id);
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, isRead: true } : m))
    );
  };

  return (
    <div className={`flex-1 flex flex-col h-full overflow-hidden ${theme.appBg}`}>
      {/* Mailbox Header Bar */}
      <div className={`p-3 border-b flex flex-wrap items-center justify-between gap-3 shrink-0 ${theme.navBg} ${theme.border}`}>
        {/* Return Button + Account Info Header */}
        <div className="flex items-center gap-3">
          {/* Prominent Back Button */}
          <button
            onClick={onBackToAccountList}
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-2 transition-all shadow-xs ${
              isDark 
                ? 'bg-slate-800 text-slate-200 hover:bg-slate-700 border-slate-700' 
                : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-300'
            }`}
            title="返回 100 个邮箱账号数据列表"
          >
            <ArrowLeft className="w-4 h-4 text-blue-600" />
            <span>返回邮箱账号列表</span>
          </button>

          <div className={`h-5 w-px hidden sm:block ${isDark ? 'bg-slate-700' : 'bg-slate-300'}`} />

          {/* Mailbox Details Header */}
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
              <Inbox className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className={`font-bold text-sm truncate ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                  {account.accountName}
                </h2>
                <span className={`px-1.5 py-0.2 rounded border font-mono text-[10px] font-bold ${
                  isDark ? 'bg-indigo-950/80 text-indigo-300 border-indigo-700/60' : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                }`}>
                  {account.protocol}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 font-bold">
                  <CheckCircle2 className="w-3 h-3" />
                  正常接入
                </span>
              </div>
              <p className={`text-xs font-mono truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {account.emailAddress} ({account.serverHost})
              </p>
            </div>
          </div>
        </div>

        {/* Right Actions: Receive Mail Button for this Mailbox Account */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncThisAccount}
            disabled={isSyncingThisAccount}
            className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-all"
            title="向该邮箱所属的POP3/IMAP服务器收取最新信件"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingThisAccount ? 'animate-spin' : ''}`} />
            <span>{isSyncingThisAccount ? '正在收取该邮箱信件...' : '收取该邮箱新信'}</span>
          </button>
        </div>
      </div>

      {/* Main Mailbox Body */}
      <div className="flex-1 flex overflow-hidden relative">
        <AnimatePresence mode="wait">
          {!selectedMessage ? (
            /* Main Column: Received Mail List (Full Width) */
            <motion.div
              key="mail-list"
              initial={{ opacity: 0, y: 10, scale: 0.995 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.995 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="flex-1 flex flex-col w-full h-full overflow-hidden"
            >
            {/* Sub Toolbar */}
            <div className={`p-2.5 border-b flex items-center justify-between gap-2 ${
              isDark ? 'bg-slate-900/60 border-slate-800' : 'bg-slate-100/90 border-slate-300/80'
            }`}>
              {/* Search */}
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  value={inboxSearch}
                  onChange={(e) => setInboxSearch(e.target.value)}
                  placeholder={`在 ${account.accountName} 收到信件中搜索...`}
                  className={`w-full pl-8 pr-3 py-1 text-xs rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                    isDark 
                      ? 'border-slate-700 bg-slate-800 text-slate-100 placeholder-slate-400' 
                      : 'border-slate-300 bg-white text-slate-800 placeholder-slate-400'
                  }`}
                />
              </div>

              {/* Filter Pills */}
              <div className="flex items-center gap-1 text-xs shrink-0">
                <button
                  onClick={() => setFilterType('all')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-colors ${
                    filterType === 'all'
                      ? 'bg-blue-600 text-white'
                      : isDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
                  }`}
                >
                  全部 ({messages.length})
                </button>
                <button
                  onClick={() => setFilterType('unread')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-colors ${
                    filterType === 'unread'
                      ? 'bg-blue-600 text-white'
                      : isDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
                  }`}
                >
                  未读 ({messages.filter((m) => !m.isRead).length})
                </button>
              </div>
            </div>

            {/* Email Messages Items List */}
            <div className={`flex-1 overflow-y-auto divide-y ${isDark ? 'divide-slate-800/80' : 'divide-slate-200'}`}>
              {visibleMessages.length === 0 ? (
                <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                  <Mail className="w-8 h-8 text-slate-400" />
                  <p>该邮箱当前收件箱为空或无符合条件的信件</p>
                </div>
              ) : (
                visibleMessages.map((msg) => {
                  const isSelected = selectedMessageId === msg.id;
                  return (
                    <div
                      key={msg.id}
                      onClick={() => handleSelectMessage(msg)}
                      className={`p-3.5 cursor-pointer transition-all ${
                        isSelected
                          ? isDark 
                            ? 'bg-blue-950/80 text-blue-100 font-medium border-l-4 border-l-blue-500' 
                            : 'bg-blue-50/90 text-blue-950 font-medium border-l-4 border-l-blue-600 shadow-2xs'
                          : msg.isRead
                          ? isDark 
                            ? 'bg-slate-900 text-slate-300 hover:bg-slate-800/60' 
                            : 'bg-white text-slate-700 hover:bg-blue-50/50'
                          : isDark 
                            ? 'bg-slate-900 font-medium text-slate-100 hover:bg-slate-800/60' 
                            : 'bg-white font-bold text-slate-900 hover:bg-blue-50/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`font-bold text-xs truncate ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                            {msg.senderName}
                          </span>
                          <span className={`text-[11px] font-mono truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                            &lt;{msg.senderEmail}&gt;
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={(e) => handleToggleStar(msg.id, e)}
                            className="text-slate-400 hover:text-amber-500 transition-colors"
                          >
                            <Star
                              className={`w-3.5 h-3.5 ${
                                msg.isStarred ? 'text-amber-500 fill-amber-500' : ''
                              }`}
                            />
                          </button>
                          <span className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                            {msg.date}
                          </span>
                        </div>
                      </div>

                      <h3 className={`text-sm mb-1 line-clamp-1 ${
                        msg.isRead 
                          ? isDark ? 'text-slate-300' : 'text-slate-700'
                          : isDark ? 'text-slate-100 font-bold' : 'text-slate-900 font-bold'
                      }`}>
                        {msg.subject}
                      </h3>

                      <p className={`text-xs line-clamp-2 mb-2 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        {msg.snippet}
                      </p>

                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <div className="flex flex-wrap gap-1">
                          {msg.tags.map((tag, idx) => (
                            <span
                              key={idx}
                              className={`px-2 py-0.5 rounded font-medium border ${
                                isDark 
                                  ? 'bg-blue-950 text-blue-300 border-blue-800/80' 
                                  : 'bg-blue-50 text-blue-700 border-blue-200'
                              }`}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>

                        {msg.attachments && msg.attachments.length > 0 && (
                          <span className={`inline-flex items-center gap-1 font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                            <Paperclip className="w-3.5 h-3.5" />
                            {msg.attachments.length} 个附件
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            </motion.div>
          ) : (
            /* Selected Email Message Content Detail View (Full Width) */
            <motion.div
              key={`mail-detail-${selectedMessage.id}`}
              initial={{ opacity: 0, y: 10, scale: 0.995 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.995 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={`flex-1 flex flex-col w-full h-full overflow-hidden ${isDark ? 'bg-slate-900/50' : 'bg-slate-50/50'}`}
            >
            {/* Header / Actions for Message Detail */}
            <div className={`p-3 border-b flex items-center justify-between gap-2 shrink-0 ${
              isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-300'
            }`}>
              <button
                onClick={() => setSelectedMessageId(null)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer ${
                  isDark 
                    ? 'bg-slate-800 text-slate-200 hover:bg-slate-700 border-slate-700' 
                    : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-300'
                }`}
              >
                <ArrowLeft className="w-4 h-4 text-blue-600" />
                <span>返回邮件列表</span>
              </button>

              <div className={`flex items-center gap-2 text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                <span>邮件正文详情</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => handleToggleStar(selectedMessage.id, e)}
                  className={`p-1.5 rounded border transition-colors cursor-pointer ${
                    isDark ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                  title="标记星标"
                >
                  <Star className={`w-4 h-4 ${selectedMessage.isStarred ? 'text-amber-500 fill-amber-500' : ''}`} />
                </button>
              </div>
            </div>

            {/* Email Message Detail Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {/* Subject */}
              <h1 className={`text-base sm:text-lg font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                {selectedMessage.subject}
              </h1>

              {/* Sender & Recipient Bar */}
              <div className={`p-3 rounded-lg border space-y-1 text-xs ${
                isDark ? 'border-slate-800 bg-slate-800/60' : 'border-slate-300 bg-white'
              }`}>
                <div className="flex justify-between items-start">
                  <div>
                    <span className={`font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                      {selectedMessage.senderName}
                    </span>{' '}
                    <span className={`font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>&lt;{selectedMessage.senderEmail}&gt;</span>
                  </div>
                  <span className={`font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{selectedMessage.date}</span>
                </div>
                <div className={isDark ? 'text-slate-300' : 'text-slate-700'}>
                  收件账号:{' '}
                  <span className="font-mono text-blue-600 font-semibold">
                    {account.accountName} ({account.emailAddress})
                  </span>
                </div>
              </div>

              {/* AI Summary Box if exists */}
              {selectedMessage.aiSummary && (
                <div className={`p-3 rounded-lg border text-xs space-y-1 ${
                  isDark ? 'border-blue-900/80 bg-blue-950/60' : 'border-blue-200 bg-blue-50/90'
                }`}>
                  <div className="flex items-center gap-1.5 font-bold text-blue-600">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI 智能概要</span>
                  </div>
                  <p className={`leading-relaxed ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                    {selectedMessage.aiSummary}
                  </p>
                </div>
              )}

              {/* Attachments list if any */}
              {selectedMessage.attachments && selectedMessage.attachments.length > 0 && (
                <div className="space-y-2">
                  <span className={`text-xs font-bold flex items-center gap-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    <Paperclip className="w-3.5 h-3.5 text-blue-600" />
                    附件凭证 ({selectedMessage.attachments.length})
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selectedMessage.attachments.map((att) => (
                      <div
                        key={att.id}
                        className={`p-2.5 rounded border flex items-center justify-between text-xs ${
                          isDark ? 'border-slate-800 bg-slate-800/60' : 'border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                          <div className="truncate">
                            <p className={`font-bold truncate ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{att.name}</p>
                            <p className="text-[10px] text-slate-500 font-mono">{att.size}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Body */}
              <div className={`p-4 rounded-lg border text-xs sm:text-sm leading-relaxed whitespace-pre-wrap font-sans ${
                isDark ? 'border-slate-800 bg-slate-800/40 text-slate-200' : 'border-slate-300 bg-white text-slate-800'
              }`}>
                {selectedMessage.body}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </div>
  );
};
