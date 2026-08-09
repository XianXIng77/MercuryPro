import React, { useState } from 'react';
import {
  ArrowLeft,
  Reply,
  Forward,
  Star,
  Trash2,
  FolderInput,
  Tag as TagIcon,
  Sparkles,
  Paperclip,
  Languages,
  CheckCircle2,
  Send,
  Plus,
  Bot,
  Lightbulb,
  Copy,
  Check,
} from 'lucide-react';
import { Email, Folder, FolderId, Tag, StylePreset } from '../types';

interface EmailDetailProps {
  email: Email | null;
  onBack: () => void;
  onToggleStar: (id: string, e: React.MouseEvent) => void;
  onDeleteEmail: (id: string) => void;
  onMoveEmail: (id: string, folderId: FolderId) => void;
  onAddTagToEmail: (id: string, tag: string) => void;
  onRemoveTagFromEmail: (id: string, tag: string) => void;
  folders: Folder[];
  tags: Tag[];
  currentPreset: StylePreset;
}

export const EmailDetail: React.FC<EmailDetailProps> = ({
  email,
  onBack,
  onToggleStar,
  onDeleteEmail,
  onMoveEmail,
  onAddTagToEmail,
  onRemoveTagFromEmail,
  folders,
  tags,
  currentPreset,
}) => {
  const [replyText, setReplyText] = useState('');
  const [isAiSummarizing, setIsAiSummarizing] = useState(false);
  const [aiSummaryData, setAiSummaryData] = useState<{ summary: string; keyPoints: string[] } | null>(null);
  const [aiReplies, setAiReplies] = useState<string[]>([]);
  const [isGeneratingReplies, setIsGeneratingReplies] = useState(false);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const theme = currentPreset.themeClasses;

  if (!email) {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center p-8 text-center ${theme.appBg}`}>
        <div className="w-16 h-16 rounded-3xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center mb-4">
          <Bot className="w-8 h-8" />
        </div>
        <h3 className={`font-bold text-base ${theme.textPrimary}`}>智邮智能邮箱</h3>
        <p className={`text-xs mt-1 max-w-sm ${theme.textSecondary}`}>
          选择左侧列表中任意邮件查看完整内容，并体验 AI 智能摘要、快捷回复与标签路由规则。
        </p>
      </div>
    );
  }

  // Handle AI Summarize
  const handleAiSummarize = async () => {
    setIsAiSummarizing(true);
    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'summarize', email }),
      });
      const data = await res.json();
      setAiSummaryData({
        summary: data.summary || email.aiSummary || '这封邮件包含重要的任务及回复要求。',
        keyPoints: data.keyPoints || email.aiKeyPoints || ['请查收主要内容', '必要时做出回复'],
      });
    } catch (err) {
      console.error(err);
      setAiSummaryData({
        summary: email.aiSummary || '这封邮件包含重要的任务及回复要求。',
        keyPoints: email.aiKeyPoints || ['请查收主要内容', '必要时做出回复'],
      });
    } finally {
      setIsAiSummarizing(false);
    }
  };

  // Handle AI Generate Reply Options
  const handleGenerateReplies = async () => {
    setIsGeneratingReplies(true);
    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reply', email }),
      });
      const data = await res.json();
      setAiReplies(data.replies || [
        '好的，收到！我会尽快处理并回复您。',
        '感谢通知，相关资料已核对无误。',
        '抱歉时间上有冲突，建议另约时间，谢谢！',
      ]);
    } catch (err) {
      console.error(err);
      setAiReplies([
        '好的，收到！我会尽快处理并回复您。',
        '感谢通知，相关资料已核对无误。',
        '抱歉时间上有冲突，建议另约时间，谢谢！',
      ]);
    } finally {
      setIsGeneratingReplies(false);
    }
  };

  // Handle Quick Translate
  const handleTranslate = () => {
    if (translatedText) {
      setTranslatedText(null);
    } else {
      setTranslatedText(
        `【中文翻译参考】\n主题：${email.subject}\n正文翻译：您好，信件发自 ${email.senderName} (${email.senderEmail})。正文主要涉及关于智邮系统项目的跟进安排与文件材料。请确认无误后回复。`
      );
    }
  };

  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    alert(`已发送回复给 ${email.senderName} (${email.senderEmail})！`);
    setReplyText('');
  };

  return (
    <div className={`flex-1 flex flex-col h-full overflow-hidden ${theme.appBg}`}>
      {/* Detail Toolbar */}
      <div className={`p-3 border-b flex items-center justify-between gap-2 ${theme.cardBg} ${theme.border}`}>
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-all bg-white dark:bg-slate-800 ${theme.border} text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-2xs`}
            title="返回邮件列表"
          >
            <ArrowLeft className="w-4 h-4 text-blue-600" />
            <span>返回邮件列表</span>
          </button>

          {/* Move to Folder Button */}
          <div className="relative">
            <button
              onClick={() => setShowFolderPicker(!showFolderPicker)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs ${theme.border} ${theme.textSecondary} hover:${theme.textPrimary}`}
            >
              <FolderInput className="w-3.5 h-3.5" />
              <span>移动</span>
            </button>
            {showFolderPicker && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowFolderPicker(false)} />
                <div className={`absolute left-0 mt-1 w-44 rounded-xl p-1 z-50 border shadow-xl ${theme.cardBg} ${theme.border}`}>
                  {folders.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        onMoveEmail(email.id, f.id);
                        setShowFolderPicker(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between"
                    >
                      <span>{f.name}</span>
                      {f.id === email.folderId && <span className="text-indigo-500 text-[10px]">当前</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Add Tag Button */}
          <div className="relative">
            <button
              onClick={() => setShowTagPicker(!showTagPicker)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs ${theme.border} ${theme.textSecondary} hover:${theme.textPrimary}`}
            >
              <TagIcon className="w-3.5 h-3.5" />
              <span>标签</span>
            </button>
            {showTagPicker && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowTagPicker(false)} />
                <div className={`absolute left-0 mt-1 w-40 rounded-xl p-1 z-50 border shadow-xl ${theme.cardBg} ${theme.border}`}>
                  {tags.map((t) => {
                    const hasTag = email.tags.includes(t.name);
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          if (hasTag) {
                            onRemoveTagFromEmail(email.id, t.name);
                          } else {
                            onAddTagToEmail(email.id, t.name);
                          }
                        }}
                        className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${t.bgClass} border ${t.borderClass}`} />
                          <span>{t.name}</span>
                        </div>
                        {hasTag && <Check className="w-3 h-3 text-indigo-600" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => onToggleStar(email.id, e)}
            className={`p-1.5 rounded-xl border ${theme.border} text-slate-400 hover:text-amber-500`}
          >
            <Star className={`w-4 h-4 ${email.isStarred ? 'fill-amber-400 text-amber-400' : ''}`} />
          </button>
          <button
            onClick={() => onDeleteEmail(email.id)}
            className="p-1.5 rounded-xl border border-red-200 dark:border-red-900/50 text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
            title="移动到垃圾桶"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Email Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
        {/* Email Header Info */}
        <div className="space-y-3 pb-4 border-b border-slate-200/60 dark:border-slate-800">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h1 className={`text-lg sm:text-xl font-bold leading-snug ${theme.textPrimary}`}>
              {email.subject}
            </h1>
            <span className="text-xs px-2.5 py-1 rounded-lg font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700">
              📂 {folders.find((f) => f.id === email.folderId)?.name || '收件箱'}
            </span>
          </div>

          {/* Interactive Tag Chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            {email.tags.map((tag) => (
              <span
                key={tag}
                className="group/chip inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
              >
                <span>{tag}</span>
                <button
                  onClick={() => onRemoveTagFromEmail(email.id, tag)}
                  className="opacity-60 hover:opacity-100 text-slate-400 hover:text-red-500"
                  title="移除标签"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>

          {/* Sender Details */}
          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-3">
              <img
                src={email.senderAvatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80'}
                alt={email.senderName}
                className="w-10 h-10 rounded-full object-cover border-2 border-indigo-500/30"
              />
              <div>
                <div className="flex items-center gap-2">
                  <span className={`font-bold text-sm ${theme.textPrimary}`}>{email.senderName}</span>
                  <span className={`text-xs ${theme.textSecondary}`}>&lt;{email.senderEmail}&gt;</span>
                </div>
                <p className={`text-xs ${theme.textSecondary}`}>发给：{email.recipient}</p>
              </div>
            </div>
            <span className={`text-xs ${theme.textSecondary}`}>{email.date}</span>
          </div>
        </div>

        {/* AI Copilot & Smart Actions Bar */}
        <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 border border-indigo-500/20 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-600 text-white">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-indigo-900 dark:text-indigo-200">AI 智能邮件 Copilot</h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">一键生成提炼摘要、语言翻译与智能快捷回复</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleAiSummarize}
                disabled={isAiSummarizing}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30 shadow-xs hover:bg-indigo-50 transition-all flex items-center gap-1.5"
              >
                <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                <span>{isAiSummarizing ? '摘要生成中...' : 'AI 智能摘要'}</span>
              </button>

              <button
                onClick={handleGenerateReplies}
                disabled={isGeneratingReplies}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-indigo-600 text-white shadow-xs hover:bg-indigo-700 transition-all flex items-center gap-1.5"
              >
                <Bot className="w-3.5 h-3.5" />
                <span>{isGeneratingReplies ? '生成回复中...' : '生成快捷回复'}</span>
              </button>

              <button
                onClick={handleTranslate}
                className="p-1.5 rounded-xl border border-indigo-500/30 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-indigo-50"
                title="中英智能翻译"
              >
                <Languages className="w-4 h-4 text-purple-500" />
              </button>
            </div>
          </div>

          {/* AI Summary Results Panel */}
          {aiSummaryData && (
            <div className="p-3 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-indigo-500/30 text-xs space-y-2">
              <p className="font-bold text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>核心总结:</span> {aiSummaryData.summary}
              </p>
              {aiSummaryData.keyPoints && (
                <ul className="list-disc list-inside text-slate-600 dark:text-slate-300 space-y-1 pl-1">
                  {aiSummaryData.keyPoints.map((pt, i) => (
                    <li key={i}>{pt}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* AI Quick Reply Options Panel */}
          {aiReplies.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[11px] font-bold text-indigo-900 dark:text-indigo-200">点击下方快捷回复自动填入发信框：</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {aiReplies.map((reply, index) => (
                  <button
                    key={index}
                    onClick={() => setReplyText(reply)}
                    className="p-2.5 text-left text-xs rounded-xl bg-white dark:bg-slate-800 border border-indigo-500/30 hover:border-indigo-500 hover:bg-indigo-50/50 dark:hover:bg-indigo-950 transition-all text-slate-700 dark:text-slate-200 leading-snug"
                  >
                    <span className="font-bold text-indigo-600 dark:text-indigo-400 block text-[10px] mb-0.5">
                      预设方案 {index + 1}
                    </span>
                    {reply}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Translation Banner */}
        {translatedText && (
          <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/60 border border-purple-500/30 text-xs text-purple-900 dark:text-purple-200 space-y-1">
            <p className="font-bold flex items-center justify-between">
              <span>🌐 智能机器翻译模式</span>
              <button onClick={() => setTranslatedText(null)} className="text-slate-400 hover:text-purple-600">
                关闭
              </button>
            </p>
            <p className="whitespace-pre-line leading-relaxed">{translatedText}</p>
          </div>
        )}

        {/* Email Body Content */}
        <div className={`p-4 sm:p-6 rounded-2xl border leading-relaxed text-sm whitespace-pre-line ${theme.cardBg} ${theme.textPrimary} ${theme.border}`}>
          {email.body}
        </div>

        {/* Attachments Section */}
        {email.attachments && email.attachments.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className={`text-xs font-bold flex items-center gap-1.5 ${theme.textSecondary}`}>
              <Paperclip className="w-3.5 h-3.5" />
              <span>邮件附件 ({email.attachments.length})</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {email.attachments.map((att) => (
                <div
                  key={att.id}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-2 ${theme.cardBg} ${theme.border}`}
                >
                  <div className="min-w-0">
                    <p className={`text-xs font-semibold truncate ${theme.textPrimary}`}>{att.name}</p>
                    <p className={`text-[11px] ${theme.textSecondary}`}>{att.size}</p>
                  </div>
                  <button
                    onClick={() => alert(`模拟下载文件：${att.name}`)}
                    className="px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20"
                  >
                    下载
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Reply Form */}
        <div className={`p-4 rounded-2xl border space-y-3 ${theme.cardBg} ${theme.border}`}>
          <h4 className={`text-xs font-bold ${theme.textPrimary}`}>快速回复</h4>
          <form onSubmit={handleSendReply} className="space-y-3">
            <textarea
              rows={3}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={`给 ${email.senderName} 回复信息，或使用上方 AI 快捷回复生成...`}
              className={`w-full p-3 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500/30 ${theme.cardBg} ${theme.textPrimary} ${theme.border}`}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleGenerateReplies}
                  className="text-xs text-indigo-600 dark:text-indigo-400 font-medium hover:underline flex items-center gap-1"
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span>AI 灵感润色</span>
                </button>
              </div>

              <button
                type="submit"
                disabled={!replyText.trim()}
                className={`px-4 py-2 text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-sm transition-all ${
                  replyText.trim()
                    ? theme.accentBg
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                }`}
              >
                <Send className="w-3.5 h-3.5" />
                <span>发送回复</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
