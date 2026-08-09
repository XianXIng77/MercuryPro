import React, { useState } from 'react';
import {
  Inbox,
  Star,
  Send,
  FileText,
  Archive,
  Trash2,
  AlertOctagon,
  Briefcase,
  Receipt,
  Plane,
  User,
  FolderPlus,
  Sliders,
  Tag as TagIcon,
  Plus,
  HardDrive,
  Folder as FolderIcon,
  Sparkles,
  ChevronRight,
  MoreVertical,
} from 'lucide-react';
import { Folder, FolderId, Tag, StylePreset } from '../types';

interface SidebarProps {
  folders: Folder[];
  currentFolderId: FolderId;
  onSelectFolder: (id: FolderId) => void;
  tags: Tag[];
  selectedTagFilter: string | null;
  onSelectTagFilter: (tagId: string | null) => void;
  onOpenRuleManager: () => void;
  onOpenCompose: () => void;
  onAddCustomFolder: (name: string, color: string) => void;
  onDeleteCustomFolder: (id: string) => void;
  currentPreset: StylePreset;
}

export const Sidebar: React.FC<SidebarProps> = ({
  folders,
  currentFolderId,
  onSelectFolder,
  tags,
  selectedTagFilter,
  onSelectTagFilter,
  onOpenRuleManager,
  onOpenCompose,
  onAddCustomFolder,
  onDeleteCustomFolder,
  currentPreset,
}) => {
  const [showAddFolderModal, setShowAddFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('text-indigo-500');

  const theme = currentPreset.themeClasses;

  const systemFolders = folders.filter((f) => f.type === 'system');
  const customFolders = folders.filter((f) => f.type === 'custom');

  const getFolderIcon = (iconName: string, className: string = 'w-4 h-4') => {
    switch (iconName) {
      case 'Inbox':
        return <Inbox className={className} />;
      case 'Star':
        return <Star className={className} />;
      case 'Send':
        return <Send className={className} />;
      case 'FileText':
        return <FileText className={className} />;
      case 'Archive':
        return <Archive className={className} />;
      case 'Trash2':
        return <Trash2 className={className} />;
      case 'AlertOctagon':
        return <AlertOctagon className={className} />;
      case 'Briefcase':
        return <Briefcase className={className} />;
      case 'Receipt':
        return <Receipt className={className} />;
      case 'Plane':
        return <Plane className={className} />;
      case 'User':
        return <User className={className} />;
      default:
        return <FolderIcon className={className} />;
    }
  };

  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    onAddCustomFolder(newFolderName.trim(), newFolderColor);
    setNewFolderName('');
    setShowAddFolderModal(false);
  };

  return (
    <aside className={`w-64 shrink-0 transition-colors duration-200 p-3 flex flex-col justify-between select-none ${theme.sidebarBg}`}>
      <div className="space-y-5 overflow-y-auto pr-1">
        {/* Write Email Button */}
        <button
          onClick={onOpenCompose}
          className={`w-full py-2.5 px-4 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 shadow-sm transition-all ${theme.accentBg}`}
        >
          <Plus className="w-4 h-4" />
          <span>撰写新邮件</span>
        </button>

        {/* System Folders Section */}
        <div>
          <p className={`px-2 mb-1 text-[11px] font-bold uppercase tracking-wider ${theme.textSecondary}`}>
            标准文件夹
          </p>
          <div className="space-y-0.5">
            {systemFolders.map((folder) => {
              const isActive = currentFolderId === folder.id && selectedTagFilter === null;
              return (
                <button
                  key={folder.id}
                  onClick={() => {
                    onSelectFolder(folder.id);
                    onSelectTagFilter(null);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all ${
                    isActive
                      ? `${theme.activeItemBg} font-semibold shadow-xs`
                      : `${theme.textSecondary} hover:${theme.textPrimary} hover:bg-slate-100 dark:hover:bg-slate-800/60`
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {getFolderIcon(folder.icon, isActive ? 'w-4 h-4 text-indigo-600 dark:text-indigo-400' : 'w-4 h-4')}
                    <span>{folder.name}</span>
                  </div>
                  {folder.unreadCount > 0 && (
                    <span
                      className={`px-1.5 py-0.2 text-[10px] rounded-full font-bold ${
                        isActive
                          ? 'bg-indigo-600 text-white'
                          : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                      }`}
                    >
                      {folder.unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Folders Section */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1">
            <p className={`text-[11px] font-bold uppercase tracking-wider ${theme.textSecondary}`}>
              自定义分类文件夹
            </p>
            <button
              onClick={() => setShowAddFolderModal(true)}
              title="添加新文件夹"
              className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 ${theme.textSecondary}`}
            >
              <FolderPlus className="w-3.5 h-3.5 text-indigo-500" />
            </button>
          </div>
          <div className="space-y-0.5">
            {customFolders.map((folder) => {
              const isActive = currentFolderId === folder.id && selectedTagFilter === null;
              return (
                <div key={folder.id} className="group relative flex items-center">
                  <button
                    onClick={() => {
                      onSelectFolder(folder.id);
                      onSelectTagFilter(null);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all ${
                      isActive
                        ? `${theme.activeItemBg} font-semibold shadow-xs`
                        : `${theme.textSecondary} hover:${theme.textPrimary} hover:bg-slate-100 dark:hover:bg-slate-800/60`
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      {getFolderIcon(folder.icon, folder.color || 'w-4 h-4 text-indigo-500')}
                      <span className="truncate">{folder.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {folder.unreadCount > 0 && (
                        <span className="px-1.5 py-0.2 text-[10px] rounded-full font-bold bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                          {folder.unreadCount}
                        </span>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={() => onDeleteCustomFolder(folder.id)}
                    title="删除文件夹"
                    className="opacity-0 group-hover:opacity-100 absolute right-2 p-1 text-slate-400 hover:text-red-500 transition-opacity"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tags & Auto Rules Section */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1.5">
            <p className={`text-[11px] font-bold uppercase tracking-wider ${theme.textSecondary}`}>
              智能标签与规则
            </p>
            <button
              onClick={onOpenRuleManager}
              className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
            >
              <Sliders className="w-3 h-3" />
              <span>规则中心</span>
            </button>
          </div>

          <div className="flex flex-wrap gap-1 px-1">
            {selectedTagFilter && (
              <button
                onClick={() => onSelectTagFilter(null)}
                className="w-full text-left px-2 py-1 text-[11px] rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold mb-1 flex items-center justify-between"
              >
                <span>清除标签筛选 ({selectedTagFilter})</span>
                <span>✕</span>
              </button>
            )}

            {tags.map((tag) => {
              const isSelected = selectedTagFilter === tag.name;
              return (
                <button
                  key={tag.id}
                  onClick={() => onSelectTagFilter(isSelected ? null : tag.name)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : `${tag.bgClass} ${tag.textClass} ${tag.borderClass} hover:opacity-80`
                  }`}
                >
                  <TagIcon className="w-3 h-3" />
                  <span>{tag.name}</span>
                </button>
              );
            })}
          </div>

          <button
            onClick={onOpenRuleManager}
            className={`w-full mt-3 p-2.5 rounded-xl border border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 text-xs font-medium flex items-center justify-between transition-all`}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              <span>设置自动打标及路由规则</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Storage & Account Widget at Bottom */}
      <div className="pt-3 border-t border-slate-200/60 dark:border-slate-800 space-y-2">
        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-1">
            <HardDrive className="w-3.5 h-3.5" />
            <span>邮箱空间</span>
          </div>
          <span className="font-semibold text-slate-700 dark:text-slate-300">4.2 GB / 15 GB</span>
        </div>
        <div className="w-full bg-slate-200 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
          <div className="bg-indigo-500 h-full rounded-full" style={{ width: '28%' }} />
        </div>
      </div>

      {/* Add Custom Folder Modal */}
      {showAddFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className={`w-full max-w-sm p-5 rounded-2xl border shadow-2xl ${theme.cardBg} ${theme.border}`}>
            <h3 className={`font-bold text-sm mb-3 ${theme.textPrimary}`}>新建自定义分类文件夹</h3>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div>
                <label className={`block text-xs font-medium mb-1 ${theme.textSecondary}`}>文件夹名称</label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="如：智能合同、团队周报..."
                  required
                  autoFocus
                  className={`w-full px-3 py-2 text-xs rounded-xl border ${theme.cardBg} ${theme.textPrimary} ${theme.border} focus:outline-none focus:ring-2 focus:ring-indigo-500/30`}
                />
              </div>

              <div>
                <label className={`block text-xs font-medium mb-1 ${theme.textSecondary}`}>主题图标颜色</label>
                <div className="flex gap-2">
                  {[
                    { color: 'text-indigo-500', bg: 'bg-indigo-500' },
                    { color: 'text-emerald-500', bg: 'bg-emerald-500' },
                    { color: 'text-amber-500', bg: 'bg-amber-500' },
                    { color: 'text-rose-500', bg: 'bg-rose-500' },
                    { color: 'text-purple-500', bg: 'bg-purple-500' },
                  ].map((c) => (
                    <button
                      type="button"
                      key={c.color}
                      onClick={() => setNewFolderColor(c.color)}
                      className={`w-6 h-6 rounded-full ${c.bg} transition-transform ${
                        newFolderColor === c.color ? 'scale-125 ring-2 ring-offset-2 ring-indigo-500' : 'opacity-70'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddFolderModal(false)}
                  className={`px-3 py-1.5 text-xs rounded-xl border ${theme.border} ${theme.textSecondary}`}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className={`px-4 py-1.5 text-xs font-semibold rounded-xl ${theme.accentBg}`}
                >
                  创建文件夹
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
};
