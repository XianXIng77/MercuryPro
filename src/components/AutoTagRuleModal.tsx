import React, { useState } from 'react';
import {
  Sliders,
  Plus,
  Trash2,
  Check,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Bot,
  AlertCircle,
  FolderInput,
  Tag as TagIcon,
  Play,
} from 'lucide-react';
import { AutoTagRule, Folder, Tag, StylePreset } from '../types';
import { StyledSelect, StyledSelectOption } from './StyledSelect';

const CONDITION_TYPE_OPTIONS: StyledSelectOption[] = [
  { value: 'subject_contains', label: '主题包含关键字' },
  { value: 'sender_contains', label: '发件人包含关键词/域名' },
  { value: 'body_contains', label: '正文包含关键字' },
  { value: 'has_attachment', label: '带有任何文件附件' },
];

interface AutoTagRuleModalProps {
  isOpen: boolean;
  onClose: () => void;
  rules: AutoTagRule[];
  onAddRule: (rule: Omit<AutoTagRule, 'id'>) => void;
  onToggleRule: (id: string) => void;
  onDeleteRule: (id: string) => void;
  onExecuteAllRules: () => void;
  onRunAiAutoTag: () => void;
  folders: Folder[];
  tags: Tag[];
  currentPreset: StylePreset;
}

export const AutoTagRuleModal: React.FC<AutoTagRuleModalProps> = ({
  isOpen,
  onClose,
  rules,
  onAddRule,
  onToggleRule,
  onDeleteRule,
  onExecuteAllRules,
  onRunAiAutoTag,
  folders,
  tags,
  currentPreset,
}) => {
  const [ruleName, setRuleName] = useState('');
  const [conditionType, setConditionType] = useState<AutoTagRule['conditionType']>('subject_contains');
  const [conditionValue, setConditionValue] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [targetFolderId, setTargetFolderId] = useState<string>('');
  const [markStarred, setMarkStarred] = useState(false);

  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.mode === 'dark';

  if (!isOpen) return null;

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName.trim() || selectedTags.length === 0) {
      alert('请填写规则名称并至少选择一个要施加的标签！');
      return;
    }

    onAddRule({
      name: ruleName.trim(),
      enabled: true,
      conditionType,
      conditionValue: conditionValue.trim(),
      applyTags: selectedTags,
      targetFolderId: targetFolderId || undefined,
      markStarred,
    });

    // Reset Form
    setRuleName('');
    setConditionValue('');
    setSelectedTags([]);
    setTargetFolderId('');
    setMarkStarred(false);
  };

  const toggleTagSelection = (tagName: string) => {
    if (selectedTags.includes(tagName)) {
      setSelectedTags(selectedTags.filter((t) => t !== tagName));
    } else {
      setSelectedTags([...selectedTags, tagName]);
    }
  };

  const getConditionLabel = (type: AutoTagRule['conditionType']) => {
    switch (type) {
      case 'subject_contains':
        return '邮件主题包含';
      case 'sender_contains':
        return '发件人地址包含';
      case 'body_contains':
        return '邮件正文包含';
      case 'has_attachment':
        return '邮件带有附件';
      default:
        return '规则条件';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
      <div className={`w-full max-w-2xl rounded-2xl border shadow-2xl p-6 space-y-6 ${theme.cardBg} ${theme.border}`}>
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b pb-4 border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-600 text-white">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className={`font-bold text-base ${theme.textPrimary}`}>自动标签与文件夹路由规则</h2>
              <p className={`text-xs ${theme.textSecondary}`}>
                定义分类匹配逻辑，系统将自动为传入和现存邮件施加标签并归档。
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-xl border ${theme.border} ${theme.textSecondary} hover:${theme.textPrimary}`}
          >
            ✕
          </button>
        </div>

        {/* Global Action Bar */}
        <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500 animate-pulse" />
            <span className="font-semibold text-indigo-900 dark:text-indigo-200">一键全局处理引擎:</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onExecuteAllRules();
                alert('已成功执行所有已启用的自定义规则分类！');
              }}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 flex items-center gap-1"
            >
              <Play className="w-3 h-3" />
              <span>重新触发规则引擎</span>
            </button>
            <button
              onClick={() => {
                onRunAiAutoTag();
                onClose();
              }}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold hover:opacity-90 flex items-center gap-1"
            >
              <Bot className="w-3.5 h-3.5" />
              <span>AI 全局智能自动打标</span>
            </button>
          </div>
        </div>

        {/* Existing Rules List */}
        <div className="space-y-3">
          <h3 className={`font-bold text-xs uppercase tracking-wider ${theme.textSecondary}`}>
            已配置的自动化规则 ({rules.length})
          </h3>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {rules.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">暂未配置规则，可在下方新建规则。</p>
            ) : (
              rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-3 transition-all ${
                    rule.enabled
                      ? 'border-indigo-500/30 bg-indigo-50/20 dark:bg-slate-900'
                      : 'border-slate-200/60 dark:border-slate-800 opacity-60'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-bold text-xs ${theme.textPrimary}`}>{rule.name}</span>
                      <button onClick={() => onToggleRule(rule.id)}>
                        {rule.enabled ? (
                          <ToggleRight className="w-5 h-5 text-indigo-600" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-slate-400" />
                        )}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      当 <span className="font-semibold text-slate-700 dark:text-slate-200">{getConditionLabel(rule.conditionType)}</span>{' '}
                      {rule.conditionType !== 'has_attachment' && (
                        <code className="px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 font-mono">
                          "{rule.conditionValue}"
                        </code>
                      )}
                      &nbsp;&rarr;&nbsp;施加标签: [{rule.applyTags.join(', ')}]
                      {rule.targetFolderId && `，移动至: ${folders.find((f) => f.id === rule.targetFolderId)?.name}`}
                    </p>
                  </div>
                  <button
                    onClick={() => onDeleteRule(rule.id)}
                    className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                    title="删除规则"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Create New Rule Form */}
        <form onSubmit={handleCreateRule} className="p-4 rounded-xl border border-indigo-500/20 bg-indigo-50/10 space-y-4">
          <h4 className={`text-xs font-bold ${theme.textPrimary} flex items-center gap-1.5`}>
            <Plus className="w-4 h-4 text-indigo-500" />
            <span>新建分类打标规则</span>
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className={`block font-medium mb-1 ${theme.textSecondary}`}>规则名称</label>
              <input
                type="text"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="例如：财务电子发票自动归档"
                required
                className={`w-full px-3 py-2 text-xs rounded-xl border ${theme.cardBg} ${theme.textPrimary} ${theme.border} focus:outline-none focus:ring-2 focus:ring-indigo-500/30`}
              />
            </div>

            <div>
              <label className={`block font-medium mb-1 ${theme.textSecondary}`}>匹配条件触发点</label>
              <StyledSelect
                ariaLabel="匹配条件触发点"
                value={conditionType}
                onChange={(value) => setConditionType(value as AutoTagRule['conditionType'])}
                options={CONDITION_TYPE_OPTIONS}
                isDark={isDark}
              />
            </div>

            {conditionType !== 'has_attachment' && (
              <div className="sm:col-span-2">
                <label className={`block font-medium mb-1 ${theme.textSecondary}`}>关键词匹配文本</label>
                <input
                  type="text"
                  value={conditionValue}
                  onChange={(e) => setConditionValue(e.target.value)}
                  placeholder="例如：发票、账单、紧急、周报..."
                  required
                  className={`w-full px-3 py-2 text-xs rounded-xl border ${theme.cardBg} ${theme.textPrimary} ${theme.border} focus:outline-none focus:ring-2 focus:ring-indigo-500/30`}
                />
              </div>
            )}

            <div className="sm:col-span-2">
              <label className={`block font-medium mb-1 ${theme.textSecondary}`}>触发时自动赋予标签</label>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => {
                  const isSelected = selectedTags.includes(t.name);
                  return (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() => toggleTagSelection(t.name)}
                      className={`px-2.5 py-1 text-xs rounded-lg font-semibold border transition-all flex items-center gap-1 ${
                        isSelected
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                          : `${t.bgClass} ${t.textClass} ${t.borderClass}`
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3" />}
                      <span>{t.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className={`block font-medium mb-1 ${theme.textSecondary}`}>自动移动至文件夹 (可选)</label>
              <StyledSelect
                ariaLabel="自动移动至文件夹"
                value={targetFolderId}
                onChange={setTargetFolderId}
                options={[{ value: '', label: '不移动（保留原位置）' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
                isDark={isDark}
              />
            </div>

            <div className="flex items-center pt-5">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={markStarred}
                  onChange={(e) => setMarkStarred(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <span>自动添加星标关注</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="submit"
              className={`px-4 py-2 text-xs font-semibold rounded-xl ${theme.accentBg}`}
            >
              保存并应用新规则
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
