import React, { useState } from 'react';
import {
  Send,
  Paperclip,
  Sparkles,
  X,
  Tag as TagIcon,
  FolderInput,
  Bot,
  Wand2,
} from 'lucide-react';
import { Folder, Tag, StylePreset } from '../types';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSendEmail: (emailData: {
    recipient: string;
    subject: string;
    body: string;
    folderId: string;
    tags: string[];
  }) => void;
  folders: Folder[];
  tags: Tag[];
  currentPreset: StylePreset;
}

export const ComposeModal: React.FC<ComposeModalProps> = ({
  isOpen,
  onClose,
  onSendEmail,
  folders,
  tags,
  currentPreset,
}) => {
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState('sent');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [showAiPromptBox, setShowAiPromptBox] = useState(false);
  const [isAiWriting, setIsAiWriting] = useState(false);

  const theme = currentPreset.themeClasses;

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipient.trim() || !subject.trim() || !body.trim()) {
      alert('请完整填写收件人、主题和正文！');
      return;
    }

    onSendEmail({
      recipient: recipient.trim(),
      subject: subject.trim(),
      body: body.trim(),
      folderId: selectedFolderId,
      tags: selectedTags,
    });

    onClose();
  };

  const toggleTagSelection = (tagName: string) => {
    if (selectedTags.includes(tagName)) {
      setSelectedTags(selectedTags.filter((t) => t !== tagName));
    } else {
      setSelectedTags([...selectedTags, tagName]);
    }
  };

  // AI Assist Email Draft Writing
  const handleAiWriteEmail = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiWriting(true);

    try {
      const promptText = aiPrompt.toLowerCase();
      let genSubject = '【业务沟通】关于近期项目进展与后续安排通知';
      let genBody = `尊敬的团队伙伴：\n\n您好！针对近期推进的业务重点，特向您报备最新进展。\n目前各项准备工作已按计划展开，相关材料请参见复核。\n如有任何问题，随时保持沟通。\n\n祝好！`;

      if (promptText.includes('发票') || promptText.includes('请款')) {
        genSubject = '【财务请款】关于项目尾款结算及开票申请';
        genBody = `尊敬的财务部主管：\n\n您好！智邮项目阶段交付已验收通过，现发起尾款结算申请。\n对应的开票信息及验收报告已准备完毕，请协助安排后续审核开票事宜，非常感谢！`;
      } else if (promptText.includes('请假') || promptText.includes('休假')) {
        genSubject = '【休假申请】部门个人休假报备及工作交接安排';
        genBody = `尊敬的部门经理：\n\n您好！因个人私事安排，本人拟申请于下周一至周三休假3天。\n休假期间重要紧急事务已交接给组内同事协助跟进，个人手机保持畅通。\n请领导批准，谢谢！`;
      }

      setSubject(genSubject);
      setBody(genBody);
      setShowAiPromptBox(false);
      setAiPrompt('');
    } catch (err) {
      console.error(err);
    } finally {
      setIsAiWriting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
      <div className={`w-full max-w-2xl rounded-2xl border shadow-2xl p-6 space-y-4 ${theme.cardBg} ${theme.border}`}>
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-600 text-white">
              <Send className="w-4 h-4" />
            </div>
            <h2 className={`font-bold text-sm ${theme.textPrimary}`}>撰写并发送新邮件</h2>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-xl border ${theme.border} ${theme.textSecondary} hover:${theme.textPrimary}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* AI Writing Assistant Toggle Banner */}
        <div className="p-3 rounded-xl bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 border border-indigo-500/20 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500 animate-pulse" />
            <span className="font-semibold text-indigo-900 dark:text-indigo-200">AI 写作 Copilot:</span>
            <span className="text-slate-500">只需输入简短要点，自动撰写高情商公文邮件</span>
          </div>
          <button
            type="button"
            onClick={() => setShowAiPromptBox(!showAiPromptBox)}
            className="px-3 py-1 text-xs font-semibold rounded-lg bg-indigo-600 text-white flex items-center gap-1 shadow-xs hover:bg-indigo-700"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>AI 一键帮我写</span>
          </button>
        </div>

        {/* AI Prompt Input Box */}
        {showAiPromptBox && (
          <div className="p-3 rounded-xl bg-indigo-50 dark:bg-slate-900 border border-indigo-500/30 space-y-2">
            <p className="text-xs font-bold text-indigo-900 dark:text-indigo-300">输入提示词（如：“帮我写一封关于请假3天的休假申请”）：</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="例如：发一封提醒对方财务对账的邮件..."
                className={`flex-1 px-3 py-1.5 text-xs rounded-xl border ${theme.cardBg} ${theme.textPrimary} ${theme.border}`}
              />
              <button
                type="button"
                onClick={handleAiWriteEmail}
                disabled={isAiWriting}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
              >
                {isAiWriting ? '生成中...' : '生成文案'}
              </button>
            </div>
          </div>
        )}

        {/* Compose Form */}
        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label className={`block font-medium mb-1 ${theme.textSecondary}`}>收件人邮箱</label>
            <input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="例如：partner@company.com"
              required
              className={`w-full px-3 py-2 text-xs rounded-xl border ${theme.cardBg} ${theme.textPrimary} ${theme.border} focus:outline-none focus:ring-2 focus:ring-indigo-500/30`}
            />
          </div>

          <div>
            <label className={`block font-medium mb-1 ${theme.textSecondary}`}>邮件主题</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="请输入清晰生动的邮件主题..."
              required
              className={`w-full px-3 py-2 text-xs rounded-xl border ${theme.cardBg} ${theme.textPrimary} ${theme.border} focus:outline-none focus:ring-2 focus:ring-indigo-500/30`}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={`block font-medium mb-1 ${theme.textSecondary}`}>发送备份存入文件夹</label>
              <select
                value={selectedFolderId}
                onChange={(e) => setSelectedFolderId(e.target.value)}
                className={`w-full px-3 py-2 text-xs rounded-xl border ${theme.cardBg} ${theme.textPrimary} ${theme.border}`}
              >
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={`block font-medium mb-1 ${theme.textSecondary}`}>预分配智能标签</label>
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => {
                  const isSelected = selectedTags.includes(t.name);
                  return (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() => toggleTagSelection(t.name)}
                      className={`px-2 py-0.5 text-[11px] rounded-lg border font-medium ${
                        isSelected
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : `${t.bgClass} ${t.textClass} ${t.borderClass}`
                      }`}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <label className={`block font-medium mb-1 ${theme.textSecondary}`}>邮件正文内容</label>
            <textarea
              rows={7}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="请输入正文..."
              required
              className={`w-full p-3 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500/30 ${theme.cardBg} ${theme.textPrimary} ${theme.border}`}
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => alert('已添加模拟附件：方案计划书.pdf')}
              className={`px-3 py-1.5 text-xs rounded-xl border ${theme.border} ${theme.textSecondary} hover:${theme.textPrimary} flex items-center gap-1.5`}
            >
              <Paperclip className="w-3.5 h-3.5 text-indigo-500" />
              <span>添加附件</span>
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className={`px-4 py-2 text-xs rounded-xl border ${theme.border} ${theme.textSecondary}`}
              >
                存为草稿
              </button>
              <button
                type="submit"
                className={`px-5 py-2 text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-md ${theme.accentBg}`}
              >
                <Send className="w-3.5 h-3.5" />
                <span>立即发送邮件</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
