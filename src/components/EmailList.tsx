import React, { useState } from 'react';
import {
  Star,
  CheckSquare,
  Square,
  Trash2,
  FolderInput,
  Tag as TagIcon,
  MailCheck,
  MailWarning,
  Sparkles,
  Paperclip,
  Filter,
  RefreshCw,
  Inbox,
  LayoutList,
  Table as TableIcon,
  Check,
  ChevronRight,
  ArrowDownToLine,
  Eye,
} from 'lucide-react';
import { Email, Folder, FolderId, Tag, StylePreset } from '../types';

interface EmailListProps {
  emails: Email[];
  selectedEmailId: string | null;
  onSelectEmail: (id: string) => void;
  selectedEmailIds: string[];
  onToggleSelectEmail: (id: string) => void;
  onSelectAllEmails: (select: boolean) => void;
  onToggleStar: (id: string, e: React.MouseEvent) => void;
  onBatchDelete: () => void;
  onBatchMarkRead: (read: boolean) => void;
  onBatchMoveFolder: (folderId: FolderId) => void;
  onBatchAddTag: (tagName: string) => void;
  onBatchAiAutoTag: () => void;
  onFetchNewEmails: () => void;
  onFetchSingleEmail?: (id: string) => void;
  isSyncing: boolean;
  currentFolder: Folder;
  folders: Folder[];
  tags: Tag[];
  selectedTagFilter: string | null;
  searchQuery: string;
  currentPreset: StylePreset;
}

export const EmailList: React.FC<EmailListProps> = ({
  emails,
  selectedEmailId,
  onSelectEmail,
  selectedEmailIds,
  onToggleSelectEmail,
  onSelectAllEmails,
  onToggleStar,
  onBatchDelete,
  onBatchMarkRead,
  onBatchMoveFolder,
  onBatchAddTag,
  onBatchAiAutoTag,
  onFetchNewEmails,
  onFetchSingleEmail,
  isSyncing,
  currentFolder,
  folders,
  tags,
  selectedTagFilter,
  searchQuery,
  currentPreset,
}) => {
  const [quickFilter, setQuickFilter] = useState<'all' | 'unread' | 'starred' | 'urgent'>('all');
  const [viewMode, setViewMode] = useState<'table' | 'compact'>('table'); // Table view vs Compact view
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [activeActionRowId, setActiveActionRowId] = useState<string | null>(null);
  const [syncingRowId, setSyncingRowId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.id.includes('dark');

  // Show floating toast
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2200);
  };

  // Trigger individual email fetch / sync
  const handleSingleFetch = (e: React.MouseEvent, email: Email) => {
    e.stopPropagation();
    setSyncingRowId(email.id);
    setTimeout(() => {
      setSyncingRowId(null);
      if (onFetchSingleEmail) {
        onFetchSingleEmail(email.id);
      }
      triggerToast(`已为邮件《${email.subject.slice(0, 10)}...》完成收信状态重新拉取与解析！`);
    }, 800);
  };

  // Quick Filters
  const filteredEmails = emails.filter((email) => {
    if (quickFilter === 'unread' && email.isRead) return false;
    if (quickFilter === 'starred' && !email.isStarred) return false;
    if (quickFilter === 'urgent' && !email.tags.includes('紧急高优')) return false;
    return true;
  });

  const isAllSelected =
    filteredEmails.length > 0 &&
    filteredEmails.every((e) => selectedEmailIds.includes(e.id));

  const handleSelectAllChange = () => {
    onSelectAllEmails(!isAllSelected);
  };

  const getTagColorClasses = (tagName: string) => {
    const foundTag = tags.find((t) => t.name === tagName);
    if (foundTag) {
      return `${foundTag.bgClass} ${foundTag.textClass} ${foundTag.borderClass}`;
    }
    return 'bg-slate-500/10 text-slate-600 border-slate-500/20';
  };

  return (
    <div className={`flex-1 flex flex-col h-full overflow-hidden border-r ${theme.border} ${theme.appBg}`}>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-16 right-6 z-50 bg-slate-900 text-white px-3.5 py-2 rounded-lg text-xs font-semibold shadow-2xl flex items-center gap-2 border border-blue-500/40 animate-bounce">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Workstation Action Toolbar */}
      <div className={`p-2.5 sm:p-3 border-b flex flex-wrap items-center justify-between gap-2.5 shrink-0 ${theme.cardBg} ${theme.border}`}>
        {/* Left Folder Title & Primary RECEIVE MAIL Button */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Receive Mail Primary Action */}
          <button
            onClick={onFetchNewEmails}
            disabled={isSyncing}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all ${theme.accentBg}`}
            title="一键收信（与远程邮件服务器同步）"
          >
            <ArrowDownToLine className={`w-4 h-4 ${isSyncing ? 'animate-bounce' : ''}`} />
            <span>{isSyncing ? '正在收信...' : '收取邮件'}</span>
          </button>

          <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 hidden sm:block" />

          {/* Selection Checkbox & Context */}
          <button
            onClick={handleSelectAllChange}
            className="p-1 text-slate-400 hover:text-blue-600 transition-colors"
            title={isAllSelected ? '取消全选' : '全选当页数据'}
          >
            {isAllSelected ? (
              <CheckSquare className="w-4 h-4 text-blue-600" />
            ) : (
              <Square className="w-4 h-4" />
            )}
          </button>

          <div className="flex items-center gap-1.5">
            <span className={`font-bold text-xs sm:text-sm ${theme.textPrimary}`}>
              {selectedTagFilter ? `标签: ${selectedTagFilter}` : currentFolder.name}
            </span>
            <span className={`text-[11px] px-2 py-0.2 rounded-full bg-slate-100 dark:bg-slate-800 ${theme.textSecondary}`}>
              {filteredEmails.length} 条数据
            </span>
          </div>
        </div>

        {/* Center/Right Batch Bar or Layout View Controls */}
        <div className="flex items-center gap-2">
          {selectedEmailIds.length > 0 ? (
            <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/80 px-2.5 py-1 rounded-lg border border-blue-500/30 text-xs">
              <span className="font-semibold text-blue-700 dark:text-blue-300 mr-1 text-[11px]">
                已选 {selectedEmailIds.length} 项:
              </span>

              {/* Mark Read/Unread */}
              <button
                onClick={() => onBatchMarkRead(true)}
                className="p-1 hover:bg-blue-200/50 dark:hover:bg-blue-900 rounded text-slate-700 dark:text-slate-200"
                title="标为已读"
              >
                <MailCheck className="w-3.5 h-3.5 text-emerald-600" />
              </button>
              <button
                onClick={() => onBatchMarkRead(false)}
                className="p-1 hover:bg-blue-200/50 dark:hover:bg-blue-900 rounded text-slate-700 dark:text-slate-200"
                title="标为未读"
              >
                <MailWarning className="w-3.5 h-3.5 text-amber-600" />
              </button>

              {/* Move Folder Dropdown */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowFolderMenu(!showFolderMenu);
                    setShowTagMenu(false);
                  }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-blue-200/50 dark:hover:bg-blue-900 text-slate-700 dark:text-slate-200"
                >
                  <FolderInput className="w-3.5 h-3.5 text-blue-600" />
                  <span className="hidden sm:inline">移动至</span>
                </button>
                {showFolderMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowFolderMenu(false)} />
                    <div className={`absolute left-0 mt-1 w-44 rounded-lg p-1 z-50 border shadow-xl ${theme.cardBg} ${theme.border}`}>
                      <p className="text-[10px] text-slate-400 font-bold px-2 py-1">目标文件夹</p>
                      {folders.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => {
                            onBatchMoveFolder(f.id);
                            setShowFolderMenu(false);
                          }}
                          className="w-full text-left px-2.5 py-1.5 text-xs rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between"
                        >
                          <span>{f.name}</span>
                          {f.id === currentFolder.id && <span className="text-blue-500 text-[10px]">当前</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Add Tag Dropdown */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowTagMenu(!showTagMenu);
                    setShowFolderMenu(false);
                  }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-blue-200/50 dark:hover:bg-blue-900 text-slate-700 dark:text-slate-200"
                >
                  <TagIcon className="w-3.5 h-3.5 text-blue-600" />
                  <span className="hidden sm:inline">加标签</span>
                </button>
                {showTagMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowTagMenu(false)} />
                    <div className={`absolute left-0 mt-1 w-40 rounded-lg p-1 z-50 border shadow-xl ${theme.cardBg} ${theme.border}`}>
                      <p className="text-[10px] text-slate-400 font-bold px-2 py-1">分配标签</p>
                      {tags.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            onBatchAddTag(t.name);
                            setShowTagMenu(false);
                          }}
                          className="w-full text-left px-2.5 py-1.5 text-xs rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5"
                        >
                          <span className={`w-2 h-2 rounded-full ${t.bgClass} border ${t.borderClass}`} />
                          <span>{t.name}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Batch AI Auto Tag */}
              <button
                onClick={onBatchAiAutoTag}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-600 text-white font-medium hover:bg-blue-700"
              >
                <Sparkles className="w-3 h-3" />
                <span>AI打标</span>
              </button>

              {/* Batch Delete */}
              <button
                onClick={onBatchDelete}
                className="p-1 hover:bg-red-100 dark:hover:bg-red-950 rounded text-red-600"
                title="删除/移入垃圾桶"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            /* Quick Filter Tabs */
            <div className="flex items-center gap-1 text-xs">
              <button
                onClick={() => setQuickFilter('all')}
                className={`px-2 py-1 rounded-md transition-all text-[11px] font-medium ${
                  quickFilter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                全部
              </button>
              <button
                onClick={() => setQuickFilter('unread')}
                className={`px-2 py-1 rounded-md transition-all text-[11px] font-medium ${
                  quickFilter === 'unread'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                未读
              </button>
              <button
                onClick={() => setQuickFilter('starred')}
                className={`px-2 py-1 rounded-md transition-all text-[11px] font-medium ${
                  quickFilter === 'starred'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                星标
              </button>
              <button
                onClick={() => setQuickFilter('urgent')}
                className={`px-2 py-1 rounded-md transition-all text-[11px] font-medium ${
                  quickFilter === 'urgent'
                    ? 'bg-rose-600 text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                高优
              </button>
            </div>
          )}

          {/* View Mode Switcher (Table Data Grid vs Compact Card View) */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 ml-1">
            <button
              onClick={() => setViewMode('table')}
              className={`p-1 rounded ${viewMode === 'table' ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-2xs font-bold' : 'text-slate-400'}`}
              title="工作台高密表格视图"
            >
              <TableIcon className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('compact')}
              className={`p-1 rounded ${viewMode === 'compact' ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-2xs font-bold' : 'text-slate-400'}`}
              title="紧凑列表视图"
            >
              <LayoutList className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Email Data Table / Dense List View */}
      <div className="flex-1 overflow-y-auto">
        {filteredEmails.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center p-6">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
              <Filter className="w-6 h-6" />
            </div>
            <p className={`text-sm font-bold ${theme.textPrimary}`}>没有符合条件的邮件数据</p>
            <p className={`text-xs mt-1 max-w-xs ${theme.textSecondary}`}>
              {searchQuery ? `未找到匹配 "${searchQuery}" 的记录` : '当前分类下暂无邮件记录'}
            </p>
          </div>
        ) : viewMode === 'table' ? (
          /* High Density Workstation Data Table */
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/70 dark:bg-slate-900/90 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-bold select-none text-[11px]">
                  <th className="py-2 px-3 w-8 text-center">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={handleSelectAllChange}
                      className="rounded text-blue-600"
                    />
                  </th>
                  <th className="py-2 px-2 w-8 text-center">标</th>
                  <th className="py-2 px-3 w-36">发件人 / 地址</th>
                  <th className="py-2 px-3 min-w-[200px]">邮件主题与主要正文</th>
                  <th className="py-2 px-3 w-44">分类标签 / 文件夹</th>
                  <th className="py-2 px-3 w-28 text-right">接收时间</th>
                  <th className="py-2 px-3 w-40 text-center font-bold text-blue-600 dark:text-blue-400 border-l border-slate-200 dark:border-slate-800">
                    【操作列】
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800">
                {filteredEmails.map((email) => {
                  const isSelected = selectedEmailId === email.id;
                  const isChecked = selectedEmailIds.includes(email.id);
                  const isRowSyncing = syncingRowId === email.id;

                  return (
                    <tr
                      key={email.id}
                      onClick={() => onSelectEmail(email.id)}
                      className={`group transition-colors cursor-pointer ${
                        isSelected
                          ? isDark 
                            ? 'bg-blue-950/80 text-blue-100 font-medium border-l-4 border-l-blue-500' 
                            : 'bg-blue-50/90 text-blue-950 font-medium border-l-4 border-l-blue-600'
                          : !email.isRead
                          ? isDark 
                            ? 'bg-slate-900 font-bold text-slate-100 hover:bg-slate-800/60' 
                            : 'bg-white font-bold text-slate-900 hover:bg-blue-50/50'
                          : isDark 
                            ? 'bg-slate-900 text-slate-300 hover:bg-slate-800/60' 
                            : 'bg-white text-slate-700 hover:bg-blue-50/50'
                      }`}
                    >
                      {/* Selection */}
                      <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => onToggleSelectEmail(email.id)}
                          className="rounded text-blue-600 cursor-pointer"
                        />
                      </td>

                      {/* Star */}
                      <td className="py-2.5 px-2 text-center" onClick={(e) => onToggleStar(email.id, e)}>
                        <Star
                          className={`w-3.5 h-3.5 mx-auto cursor-pointer ${
                            email.isStarred ? 'fill-amber-400 text-amber-400' : 'text-slate-300 hover:text-amber-400'
                          }`}
                        />
                      </td>

                      {/* Sender */}
                      <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100 truncate">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="truncate">{email.senderName}</span>
                          {email.attachments && email.attachments.length > 0 && (
                            <Paperclip className="w-3 h-3 text-slate-400 shrink-0" />
                          )}
                        </div>
                      </td>

                      {/* Subject & Snippet */}
                      <td className="py-2.5 px-3 min-w-[200px]">
                        <div className="flex flex-col">
                          <span className={`truncate text-xs ${!email.isRead ? 'font-bold text-slate-900 dark:text-white' : ''}`}>
                            {email.subject}
                          </span>
                          <span className="text-[11px] text-slate-400 truncate line-clamp-1">{email.snippet}</span>
                        </div>
                      </td>

                      {/* Tags & Folder */}
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono">
                            {folders.find((f) => f.id === email.folderId)?.name || '收件箱'}
                          </span>
                          {email.tags.map((t) => (
                            <span
                              key={t}
                              className={`text-[10px] px-1.5 py-0.2 rounded-full border ${getTagColorClasses(t)}`}
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* Date */}
                      <td className="py-2.5 px-3 text-right text-[11px] text-slate-400 font-mono shrink-0">
                        {email.date}
                      </td>

                      {/* 【ACTION COLUMN / 操作列】 */}
                      <td
                        className="py-2 px-2 border-l border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {/* RECEIVE / FETCH MAIL ACTION BUTTON FOR THIS ROW */}
                          <button
                            onClick={(e) => {
                              handleSingleFetch(e, email);
                              onSelectEmail(email.id);
                            }}
                            disabled={isRowSyncing}
                            className={`px-2 py-1 rounded text-[11px] font-bold flex items-center gap-1 transition-all ${
                              isRowSyncing
                                ? 'bg-blue-100 text-blue-700 animate-pulse'
                                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-2xs'
                            }`}
                            title="重新收取该信件并进入收件详情页"
                          >
                            <RefreshCw className={`w-3 h-3 ${isRowSyncing ? 'animate-spin' : ''}`} />
                            <span>{isRowSyncing ? '收信中' : '收信'}</span>
                          </button>

                          {/* Open Mail Detail Button */}
                          <button
                            onClick={() => onSelectEmail(email.id)}
                            className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 hover:bg-blue-100 dark:hover:bg-blue-900 text-slate-700 dark:text-slate-200 text-[11px] font-medium flex items-center gap-1"
                            title="进入该邮件的收件正文页面"
                          >
                            <Eye className="w-3.5 h-3.5 text-blue-600" />
                            <span>查看</span>
                          </button>

                          {/* Read Toggle */}
                          <button
                            onClick={() => {
                              onBatchMarkRead(!email.isRead);
                              triggerToast(email.isRead ? '已标为未读' : '已标为已读');
                            }}
                            className="p-1 rounded text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-slate-800"
                            title={email.isRead ? '标为未读' : '标为已读'}
                          >
                            {email.isRead ? <MailWarning className="w-3.5 h-3.5 text-amber-600" /> : <MailCheck className="w-3.5 h-3.5 text-emerald-600" />}
                          </button>

                          {/* Trash */}
                          <button
                            onClick={() => {
                              onBatchDelete();
                              triggerToast('已移入垃圾桶');
                            }}
                            className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800"
                            title="移入垃圾桶"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Compact Cards View */
          <div className="divide-y divide-slate-200/60 dark:divide-slate-800">
            {filteredEmails.map((email) => {
              const isSelected = selectedEmailId === email.id;
              const isChecked = selectedEmailIds.includes(email.id);

              return (
                <div
                  key={email.id}
                  onClick={() => onSelectEmail(email.id)}
                  className={`p-3 transition-all cursor-pointer flex items-start gap-3 ${
                    isSelected
                      ? `${theme.activeItemBg} border-l-4 border-blue-600`
                      : email.isRead
                      ? 'hover:bg-slate-100/70 dark:hover:bg-slate-800/50'
                      : 'bg-blue-50/30 dark:bg-slate-900/80 font-medium'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onToggleSelectEmail(email.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 rounded text-blue-600"
                  />
                  <button onClick={(e) => onToggleStar(email.id, e)} className="mt-1">
                    <Star className={`w-4 h-4 ${email.isStarred ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
                  </button>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-900 dark:text-slate-100 truncate">{email.senderName}</span>
                      <span className="text-[11px] text-slate-400">{email.date}</span>
                    </div>
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{email.subject}</p>
                    <p className="text-[11px] text-slate-500 line-clamp-1">{email.snippet}</p>

                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-1">
                        {email.tags.map((t) => (
                          <span key={t} className={`text-[10px] px-1.5 py-0.2 rounded-full border ${getTagColorClasses(t)}`}>
                            {t}
                          </span>
                        ))}
                      </div>

                      {/* Row Action Bar with FETCH MAIL button */}
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => handleSingleFetch(e, email)}
                          className="px-2 py-0.5 rounded bg-blue-600 text-white text-[10px] font-bold hover:bg-blue-700 flex items-center gap-0.5"
                        >
                          <RefreshCw className="w-2.5 h-2.5" />
                          <span>收信</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
