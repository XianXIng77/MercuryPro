import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  Inbox,
  LoaderCircle,
  Mail,
  Paperclip,
  RefreshCw,
  Search,
  Star,
} from 'lucide-react';
import { getMicrosoftMessage, listMicrosoftMessages, mapMicrosoftMessage } from '../api/microsoftMail';
import { Email, MailAccount, StylePreset } from '../types';

interface MailboxInboxViewProps {
  account: MailAccount;
  onBackToAccountList: () => void;
  currentPreset: StylePreset;
}

export const MailboxInboxView: React.FC<MailboxInboxViewProps> = ({
  account,
  onBackToAccountList,
  currentPreset,
}) => {
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.mode === 'dark';
  const accountId = account.accountId || account.id;

  const [messages, setMessages] = useState<Email[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<Email | null>(null);
  const [inboxSearch, setInboxSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'unread'>('all');
  const [top, setTop] = useState(20);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const rawMessages = await listMicrosoftMessages(accountId, top);
      setMessages(rawMessages.map((item) => mapMicrosoftMessage(item, account.emailAddress)));
    } catch (error: any) {
      setMessages([]);
      setErrorMessage(error.message || '邮件列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [account.emailAddress, accountId, top]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const visibleMessages = useMemo(() => messages.filter((message) => {
    if (filterType === 'unread' && message.isRead) return false;
    const query = inboxSearch.trim().toLowerCase();
    if (!query) return true;
    return [message.subject, message.senderName, message.senderEmail, message.snippet]
      .some((value) => value.toLowerCase().includes(query));
  }), [filterType, inboxSearch, messages]);

  const handleViewMessage = async (message: Email) => {
    setSelectedMessage(message);
    setDetailLoading(true);
    setErrorMessage('');
    try {
      const raw = await getMicrosoftMessage(accountId, message.id);
      setSelectedMessage(mapMicrosoftMessage(raw, account.emailAddress));
      setMessages((previous) => previous.map((item) => item.id === message.id ? { ...item, isRead: true } : item));
    } catch (error: any) {
      setErrorMessage(error.message || '邮件正文加载失败');
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className={`flex-1 flex flex-col h-full overflow-hidden ${theme.appBg}`}>
      <div className={`p-3 border-b flex flex-wrap items-center justify-between gap-3 shrink-0 ${theme.navBg} ${theme.border}`}>
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onBackToAccountList} className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-2 shadow-xs ${theme.cardBg} ${theme.border} ${theme.textPrimary}`}>
            <ArrowLeft className="w-4 h-4 text-blue-600" />返回邮箱账号列表
          </button>
          <div className={`h-6 w-px hidden sm:block ${isDark ? 'bg-slate-700' : 'bg-slate-300'}`} />
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-sm"><Inbox className="w-4 h-4" /></div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className={`font-bold text-sm truncate ${theme.textPrimary}`}>{account.emailAddress}</h2>
                <span className="px-1.5 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 text-[10px] font-bold">Microsoft Graph</span>
                <span className="hidden lg:inline-flex items-center gap-1 text-[10px] text-emerald-600 font-bold"><CheckCircle2 className="w-3 h-3" />真实接口</span>
              </div>
              <p className={`text-xs truncate ${theme.textSecondary}`}>账号 ID：{String(accountId)}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className={`flex items-center gap-2 text-xs ${theme.textSecondary}`}>
            显示
            <select value={top} onChange={(event) => setTop(Number(event.target.value))} className={`px-2.5 py-1.5 rounded-lg border ${theme.cardBg} ${theme.border} ${theme.textPrimary}`}>
              {[10, 20, 50].map((value) => <option key={value} value={value}>{value} 封</option>)}
            </select>
          </label>
          <button onClick={() => void loadMessages()} disabled={loading} className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-60">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />刷新邮件
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden relative p-3 sm:p-4">
        <AnimatePresence mode="wait">
          {!selectedMessage ? (
            <motion.div
              key="mail-list"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className={`flex-1 flex flex-col w-full h-full overflow-hidden rounded-2xl ${theme.cardBg} ${theme.shadow}`}
            >
              <div className={`p-3 border-b flex flex-wrap items-center justify-between gap-3 ${theme.border} ${isDark ? 'bg-white/[0.025]' : 'bg-white/30'}`}>
                <div className="relative flex-1 max-w-2xl">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input value={inboxSearch} onChange={(event) => setInboxSearch(event.target.value)} placeholder="搜索发件人、主题或邮件摘要" className={`w-full pl-9 pr-3 py-2 rounded-xl border outline-none focus:ring-2 focus:ring-blue-500/30 ${theme.cardBg} ${theme.border} ${theme.textPrimary}`} />
                </div>
                <div className={`inline-flex p-1 rounded-xl border ${theme.border}`}>
                  <button onClick={() => setFilterType('all')} className={`px-3 py-1.5 rounded-lg font-semibold ${filterType === 'all' ? 'bg-blue-600 text-white' : theme.textSecondary}`}>全部 ({messages.length})</button>
                  <button onClick={() => setFilterType('unread')} className={`px-3 py-1.5 rounded-lg font-semibold ${filterType === 'unread' ? 'bg-blue-600 text-white' : theme.textSecondary}`}>未读 ({messages.filter((item) => !item.isRead).length})</button>
                </div>
              </div>

              {errorMessage && (
                <div className="m-4 p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2"><AlertCircle className="w-5 h-5 shrink-0" /><span>{errorMessage}</span></div>
                  <button onClick={() => void loadMessages()} className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-semibold">重试</button>
                </div>
              )}

              <div className={`flex-1 overflow-y-auto divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                {loading ? (
                  <div className="h-full min-h-64 flex flex-col items-center justify-center gap-2"><LoaderCircle className="w-8 h-8 animate-spin text-blue-600" /><span className={theme.textSecondary}>正在从 Microsoft Graph 获取邮件...</span></div>
                ) : visibleMessages.length === 0 && !errorMessage ? (
                  <div className="h-full min-h-64 flex flex-col items-center justify-center gap-2"><Mail className="w-9 h-9 text-slate-400" /><p className={`font-semibold ${theme.textPrimary}`}>暂无邮件</p><span className={theme.textSecondary}>当前账号没有符合条件的邮件</span></div>
                ) : visibleMessages.map((message) => (
                  <button key={message.id} onClick={() => void handleViewMessage(message)} className={`w-full p-4 text-left transition-colors ${message.isRead ? isDark ? 'bg-white/[0.01] hover:bg-white/[0.04]' : 'bg-white/20 hover:bg-white/45' : isDark ? 'bg-blue-400/[0.06] hover:bg-white/[0.05]' : 'bg-blue-400/[0.07] hover:bg-white/50'}`}>
                    <div className="flex items-start gap-3">
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${message.isRead ? 'bg-slate-300' : 'bg-blue-600'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex items-center gap-2"><span className={`font-bold text-sm truncate ${theme.textPrimary}`}>{message.senderName}</span><span className={`hidden sm:inline text-xs font-mono truncate ${theme.textSecondary}`}>&lt;{message.senderEmail}&gt;</span></div>
                          <div className={`flex items-center gap-2 shrink-0 text-xs ${theme.textSecondary}`}>{message.isStarred && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />}<span>{message.date}</span></div>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2"><h3 className={`text-sm truncate ${!message.isRead ? 'font-bold' : 'font-medium'} ${theme.textPrimary}`}>{message.subject}</h3>{message.attachments && message.attachments.length > 0 && <Paperclip className="w-3.5 h-3.5 text-slate-400" />}</div>
                        <p className={`mt-1 text-xs line-clamp-2 ${theme.textSecondary}`}>{message.snippet || '暂无摘要'}</p>
                        <div className="mt-2 flex items-center justify-between"><div className="flex gap-1">{message.tags.map((tag) => <span key={tag} className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-[10px]">{tag}</span>)}</div><span className="text-blue-600 text-xs font-semibold inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" />查看正文</span></div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={`mail-detail-${selectedMessage.id}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className={`flex-1 flex flex-col w-full h-full overflow-hidden rounded-2xl ${theme.cardBg} ${theme.shadow}`}
            >
              <div className={`p-3 border-b flex items-center justify-between gap-3 ${theme.border} ${isDark ? 'bg-white/[0.025]' : 'bg-white/30'}`}>
                <button onClick={() => { setSelectedMessage(null); setErrorMessage(''); }} className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 ${theme.cardBg} ${theme.border} ${theme.textPrimary}`}><ArrowLeft className="w-4 h-4 text-blue-600" />返回邮件列表</button>
                <span className={`font-semibold ${theme.textPrimary}`}>邮件正文详情</span>
                <button onClick={() => selectedMessage && void handleViewMessage(selectedMessage)} className={`p-2 rounded-lg border ${theme.cardBg} ${theme.border}`} title="重新加载正文"><RefreshCw className={`w-4 h-4 ${detailLoading ? 'animate-spin' : ''}`} /></button>
              </div>
              <div className={`flex-1 min-h-0 overflow-hidden p-3 sm:p-4 ${isDark ? 'bg-black/10' : 'bg-white/15'}`}>
                <div className={`w-full h-full min-h-0 rounded-2xl border shadow-sm overflow-hidden flex flex-col ${theme.cardBg} ${theme.border}`}>
                  <div className={`p-5 sm:p-6 border-b shrink-0 ${theme.border}`}>
                    <div className="flex items-start justify-between gap-3"><h1 className={`text-lg sm:text-xl font-bold leading-snug ${theme.textPrimary}`}>{selectedMessage.subject}</h1><span className={`text-xs shrink-0 ${theme.textSecondary}`}>{selectedMessage.date}</span></div>
                    <div className="mt-4 flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center">{selectedMessage.senderName.slice(0, 1).toUpperCase()}</div><div><p className={`font-bold text-sm ${theme.textPrimary}`}>{selectedMessage.senderName}</p><p className={`text-xs ${theme.textSecondary}`}>&lt;{selectedMessage.senderEmail}&gt; 发给 {selectedMessage.recipient}</p></div></div>
                  </div>
                  {errorMessage && <div className="m-5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-2"><AlertCircle className="w-4 h-4" />{errorMessage}</div>}
                  <div className={`flex-1 min-h-0 ${selectedMessage.bodyContentType === 'html' && !detailLoading ? 'bg-white' : 'overflow-y-auto p-5 sm:p-6'}`}>
                    {detailLoading ? (
                      <div className="h-full min-h-72 flex flex-col items-center justify-center gap-2"><LoaderCircle className="w-8 h-8 animate-spin text-blue-600" /><span className={theme.textSecondary}>正在加载邮件正文...</span></div>
                    ) : selectedMessage.bodyContentType === 'html' ? (
                      <iframe title="邮件正文" sandbox="" srcDoc={selectedMessage.body} className="block w-full h-full min-h-[420px] border-0 bg-white" />
                    ) : (
                      <div className={`whitespace-pre-wrap text-sm leading-7 ${theme.textPrimary}`}>{selectedMessage.body || '暂无正文'}</div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
