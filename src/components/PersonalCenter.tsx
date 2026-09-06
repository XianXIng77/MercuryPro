import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell, Check, CircleUserRound, Eye, EyeOff, ImageUp, KeyRound, Monitor,
  Palette, Save, ShieldCheck, Smartphone, Sparkles, Trash2, UserRound, WandSparkles,
} from 'lucide-react';
import { AuthUser, authApi } from '../api/auth';
import { StylePreset } from '../types';
import { useToast } from './Toast';

interface PersonalCenterProps {
  currentUser: AuthUser;
  currentPreset: StylePreset;
  onUserUpdate: (user: AuthUser) => void;
  permissionCodes?: string[];
  onSelectPreset: (presetId: StylePreset['id']) => void;
}

type SectionId = 'profile' | 'security' | 'notifications' | 'appearance';

const sections: Array<{ id: SectionId; label: string; caption: string; icon: React.ReactNode; tint: string }> = [
  { id: 'profile', label: '基本资料', caption: '身份与联系方式', icon: <UserRound className="h-4 w-4" />, tint: 'blue' },
  { id: 'security', label: '安全设置', caption: '密码与登录设备', icon: <ShieldCheck className="h-4 w-4" />, tint: 'violet' },
  { id: 'notifications', label: '通知偏好', caption: '提醒与消息频率', icon: <Bell className="h-4 w-4" />, tint: 'amber' },
  { id: 'appearance', label: '外观偏好', caption: '主题与工作氛围', icon: <Palette className="h-4 w-4" />, tint: 'emerald' },
];

const tintClasses: Record<string, string> = {
  blue: 'bg-blue-500/12 text-blue-600 dark:text-blue-300',
  violet: 'bg-violet-500/12 text-violet-600 dark:text-violet-300',
  amber: 'bg-amber-500/12 text-amber-600 dark:text-amber-300',
  emerald: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300',
};

const initials = (value: string) => value.trim().slice(0, 2).toUpperCase() || 'ME';
const avatarClasses: Record<string, string> = { blue: 'bg-blue-600', violet: 'bg-violet-600', emerald: 'bg-emerald-600', amber: 'bg-amber-500', rose: 'bg-rose-600' };
const MAX_AVATAR_FILE_SIZE = 8 * 1024 * 1024;
const AVATAR_SIZE = 512;
const acceptedAvatarTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const prepareAvatar = (file: File) => new Promise<string>((resolve, reject) => {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(objectUrl);
    const scale = Math.min(1, AVATAR_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) { reject(new Error('浏览器无法处理这张图片')); return; }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    resolve(canvas.toDataURL('image/webp', 0.86));
  };
  image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('图片读取失败，请换一张图片重试')); };
  image.src = objectUrl;
});


export const PersonalCenter: React.FC<PersonalCenterProps> = ({ currentUser, currentPreset, permissionCodes = [], onUserUpdate, onSelectPreset }) => {
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.mode === 'dark';
  const canUpdateProfile = permissionCodes.includes('profile:update');
  const toast = useToast();
  const [section, setSection] = useState<SectionId>('profile');
  const [profile, setProfile] = useState({ username: currentUser.username || '', phone: currentUser.phone || '', bio: currentUser.bio || '', avatarColor: currentUser.avatarColor || 'blue', avatar: currentUser.avatar || '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState<Record<string, boolean>>({ product: true, security: true, digest: false });
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [avatarMessage, setAvatarMessage] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAvatarMessage('');
    if (!acceptedAvatarTypes.has(file.type)) { setAvatarMessage('请选择 PNG、JPG 或 WebP 图片'); return; }
    if (file.size > MAX_AVATAR_FILE_SIZE) { setAvatarMessage('图片不能超过 8MB'); return; }
    setAvatarBusy(true);
    try {
      const avatar = await prepareAvatar(file);
      setProfile((value) => ({ ...value, avatar }));
      setAvatarMessage('新头像已就绪，保存资料后会同步到右上角');
    } catch (error) {
      setAvatarMessage(error instanceof Error ? error.message : '头像处理失败');
    } finally {
      setAvatarBusy(false);
    }
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canUpdateProfile) { toast.error('无权限'); return; }
    setSaving(true); setSaved(false); setProfileError('');
    try {
      const result = await authApi.updateProfile(profile);
      onUserUpdate(result.user);
      setProfile((value) => ({ ...value, ...result.user }));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2600);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : '资料保存失败');
    } finally { setSaving(false); }
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault(); setPasswordMessage('');
    if (passwords.next.length < 8) { setPasswordMessage('新密码至少需要 8 个字符'); return; }
    if (passwords.next !== passwords.confirm) { setPasswordMessage('两次输入的新密码不一致'); return; }
    setPasswordSaving(true);
    try {
      await authApi.updatePassword(passwords.current, passwords.next);
      setPasswords({ current: '', next: '', confirm: '' });
      setPasswordMessage('密码已更新，下次登录时使用新密码');
    } catch (error) { setPasswordMessage(error instanceof Error ? error.message : '密码修改失败'); }
    finally { setPasswordSaving(false); }
  };

  return (
    <div className={`flex-1 overflow-y-auto ${theme.appBg}`}>
      <div className="min-h-full w-full p-4 sm:p-6">

        <main className="min-w-0">
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className={`relative mb-5 overflow-hidden rounded-2xl border p-5 sm:p-6 ${theme.cardBg} ${theme.border}`}>
            <div className="pointer-events-none absolute -right-14 -top-20 h-48 w-48 rounded-full bg-blue-500/10 blur-3xl" /><div className="pointer-events-none absolute bottom-0 right-1/3 h-20 w-40 rounded-full bg-violet-500/8 blur-3xl" />
            <div className="relative flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-blue-600"><Sparkles className="h-4 w-4" /><span className="text-[11px] font-bold tracking-wide">YOUR WORKSPACE, YOUR WAY</span></div><h2 className={`text-2xl font-black tracking-tight ${theme.textPrimary}`}>你好，{profile.username || '朋友'}</h2><p className={`mt-1 text-xs ${theme.textSecondary}`}>在这里管理你的身份信息、登录安全和工作偏好。</p></div><div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${isDark ? 'bg-emerald-400/10 text-emerald-300' : 'bg-emerald-50 text-emerald-700'}`}><span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />账号状态正常</div></div>
          </motion.div>

          <nav className={`mb-5 flex gap-1.5 overflow-x-auto rounded-xl border p-1.5 ${theme.cardBg} ${theme.border}`} aria-label="个人中心分区">
            {sections.map((item) => {
              const active = item.id === section;
              return <button key={item.id} type="button" onClick={() => setSection(item.id)} className={`flex min-w-fit flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${active ? (isDark ? 'bg-blue-500/18 text-blue-300' : 'bg-blue-600 text-white') : isDark ? 'hover:bg-white/[0.05]' : 'hover:bg-slate-100'}`}>
                <span className={`flex h-7 w-7 items-center justify-center rounded-md ${active ? 'bg-white/15 text-current' : tintClasses[item.tint]}`}>{item.icon}</span>
                <span><b className={`block text-xs ${active ? 'text-current' : theme.textPrimary}`}>{item.label}</b><small className={`hidden text-[10px] sm:block ${active ? 'text-current opacity-75' : theme.textSecondary}`}>{item.caption}</small></span>
              </button>;
            })}
          </nav>

          <AnimatePresence mode="wait">
            {section === 'profile' && <motion.section key="profile" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className={`rounded-2xl border p-5 sm:p-6 ${theme.cardBg} ${theme.border}`}>
              <div className="mb-5 flex items-center justify-between gap-3"><div><h3 className={`text-base font-bold ${theme.textPrimary}`}>基本资料</h3><p className={`mt-1 text-xs ${theme.textSecondary}`}>这些信息会用于团队协作和工作台欢迎语。</p></div><CircleUserRound className="h-5 w-5 text-blue-500" /></div>
              <form onSubmit={saveProfile} className="space-y-5">
                <div className={`flex flex-wrap items-center gap-4 rounded-xl border p-4 ${isDark ? 'border-slate-700 bg-white/[0.025]' : 'border-slate-200 bg-slate-50/60'}`}>
                  <div className={`relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl ${avatarClasses[profile.avatarColor] || avatarClasses.blue} text-lg font-black text-white shadow-sm`}>
                    {initials(profile.username || currentUser.email)}
                    {profile.avatar && <img src={profile.avatar} alt="个人头像预览" className="absolute inset-0 h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
                  </div>
                  <div className="min-w-[220px] flex-1">
                    <p className={`text-sm font-bold ${theme.textPrimary}`}>个人头像</p>
                    <p className={`mt-1 text-[11px] ${theme.textSecondary}`}>支持 PNG、JPG、WebP，图片会自动压缩到合适尺寸。</p>
                    <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarChange} className="hidden" />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button type="button" disabled={avatarBusy} onClick={() => avatarInputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"><ImageUp className="h-3.5 w-3.5" />{avatarBusy ? '处理中…' : profile.avatar ? '更换头像' : '上传头像'}</button>
                      {profile.avatar && <button type="button" onClick={() => { setProfile((value) => ({ ...value, avatar: '' })); setAvatarMessage('头像已移除，保存资料后生效'); }} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition ${isDark ? 'border-slate-600 text-slate-300 hover:bg-white/[0.05]' : 'border-slate-300 text-slate-600 hover:bg-white'}`}><Trash2 className="h-3.5 w-3.5" />移除</button>}
                    </div>
                    {avatarMessage && <p className={`mt-2 text-[11px] ${avatarMessage.includes('失败') || avatarMessage.includes('不能') || avatarMessage.includes('请选择') ? 'text-rose-600' : theme.textSecondary}`}>{avatarMessage}</p>}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1.5"><span className={`text-xs font-bold ${theme.textPrimary}`}>显示名称</span><input value={profile.username} onChange={e => setProfile({ ...profile, username: e.target.value })} required maxLength={32} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 ${isDark ? 'border-slate-600 bg-slate-900/40' : 'border-slate-200 bg-white/60'} ${theme.textPrimary}`} /></label><label className="space-y-1.5"><span className={`text-xs font-bold ${theme.textPrimary}`}>登录邮箱</span><input value={currentUser.email} disabled className={`w-full cursor-not-allowed rounded-xl border px-3 py-2.5 text-sm opacity-65 ${isDark ? 'border-slate-700 bg-slate-950/30' : 'border-slate-200 bg-slate-100/60'} ${theme.textPrimary}`} /></label><label className="space-y-1.5"><span className={`text-xs font-bold ${theme.textPrimary}`}>联系电话 <em className="font-normal not-italic opacity-60">（选填）</em></span><input value={profile.phone} onChange={e => setProfile({ ...profile, phone: e.target.value })} placeholder="例如 138 0000 0000" maxLength={32} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 ${isDark ? 'border-slate-600 bg-slate-900/40' : 'border-slate-200 bg-white/60'} ${theme.textPrimary}`} /></label><div className={`flex items-end rounded-xl border p-3 ${isDark ? 'border-slate-700 bg-white/[0.03]' : 'border-slate-200 bg-slate-50/70'}`}><div><p className={`text-[11px] ${theme.textSecondary}`}>当前角色</p><p className={`mt-1 text-sm font-bold ${theme.textPrimary}`}>{currentUser.isOwner || currentUser.role === 'owner' ? '站主' : currentUser.role === 'admin' ? '系统管理员' : '普通用户'}</p></div><span className="ml-auto rounded-full bg-violet-500/10 px-2.5 py-1 text-[10px] font-bold text-violet-600">已认证</span></div></div>
                <label className="block space-y-1.5"><span className={`text-xs font-bold ${theme.textPrimary}`}>个人简介 <em className="font-normal not-italic opacity-60">（选填）</em></span><textarea value={profile.bio} onChange={e => setProfile({ ...profile, bio: e.target.value })} maxLength={180} rows={3} placeholder="用一句话介绍你自己或负责的工作" className={`w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 ${isDark ? 'border-slate-600 bg-slate-900/40' : 'border-slate-200 bg-white/60'} ${theme.textPrimary}`} /><span className={`block text-right text-[10px] ${theme.textSecondary}`}>{profile.bio.length}/180</span></label>
                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200/50 pt-4 dark:border-slate-700/60">{profileError && <span className="mr-auto text-xs font-semibold text-rose-600">{profileError}</span>}<AnimatePresence>{saved && <motion.span initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-1 text-xs font-semibold text-emerald-600"><Check className="h-3.5 w-3.5" />已保存</motion.span>}</AnimatePresence><button disabled={saving} title={!canUpdateProfile ? '需要修改个人资料权限' : undefined} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"><Save className="h-3.5 w-3.5" />{saving ? '保存中…' : '保存资料'}</button></div>
              </form>
            </motion.section>}

            {section === 'security' && <motion.section key="security" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="space-y-4"><div className={`rounded-2xl border p-5 sm:p-6 ${theme.cardBg} ${theme.border}`}><div className="mb-5"><h3 className={`text-base font-bold ${theme.textPrimary}`}>修改登录密码</h3><p className={`mt-1 text-xs ${theme.textSecondary}`}>定期更新密码，保护邮箱工作台和业务数据。</p></div><form onSubmit={savePassword} className="max-w-xl space-y-4"><label className="block space-y-1.5"><span className={`text-xs font-bold ${theme.textPrimary}`}>当前密码</span><input type="password" value={passwords.current} onChange={e => setPasswords({ ...passwords, current: e.target.value })} required className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15 ${isDark ? 'border-slate-600 bg-slate-900/40' : 'border-slate-200 bg-white/60'} ${theme.textPrimary}`} /></label><label className="block space-y-1.5"><span className={`text-xs font-bold ${theme.textPrimary}`}>新密码</span><div className="relative"><input type={showPassword ? 'text' : 'password'} value={passwords.next} onChange={e => setPasswords({ ...passwords, next: e.target.value })} required minLength={8} className={`w-full rounded-xl border px-3 py-2.5 pr-10 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15 ${isDark ? 'border-slate-600 bg-slate-900/40' : 'border-slate-200 bg-white/60'} ${theme.textPrimary}`} /><button type="button" onClick={() => setShowPassword(v => !v)} className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 ${theme.textSecondary}`} aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div><span className={`block text-[10px] ${theme.textSecondary}`}>至少 8 个字符，建议混合大小写字母、数字和符号。</span></label><label className="block space-y-1.5"><span className={`text-xs font-bold ${theme.textPrimary}`}>确认新密码</span><input type={showPassword ? 'text' : 'password'} value={passwords.confirm} onChange={e => setPasswords({ ...passwords, confirm: e.target.value })} required className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15 ${isDark ? 'border-slate-600 bg-slate-900/40' : 'border-slate-200 bg-white/60'} ${theme.textPrimary}`} /></label>{passwordMessage && <p className={`rounded-lg px-3 py-2 text-xs ${passwordMessage.includes('已更新') ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>{passwordMessage}</p>}<button disabled={passwordSaving} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-60"><KeyRound className="h-3.5 w-3.5" />{passwordSaving ? '更新中…' : '更新密码'}</button></form></div><div className={`grid gap-3 sm:grid-cols-2`}><div className={`rounded-2xl border p-4 ${theme.cardBg} ${theme.border}`}><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600"><Smartphone className="h-4 w-4" /></span><div><p className={`text-xs font-bold ${theme.textPrimary}`}>当前设备</p><p className={`mt-0.5 text-[11px] ${theme.textSecondary}`}>Windows · Chrome · 刚刚活跃</p></div><span className="ml-auto h-2 w-2 rounded-full bg-emerald-500" /></div></div><div className={`rounded-2xl border p-4 ${theme.cardBg} ${theme.border}`}><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/12 text-blue-600"><Monitor className="h-4 w-4" /></span><div><p className={`text-xs font-bold ${theme.textPrimary}`}>登录保护</p><p className={`mt-0.5 text-[11px] ${theme.textSecondary}`}>异常登录会记录到审计日志</p></div><Check className="ml-auto h-4 w-4 text-emerald-500" /></div></div></div></motion.section>}

            {section === 'notifications' && <motion.section key="notifications" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className={`rounded-2xl border p-5 sm:p-6 ${theme.cardBg} ${theme.border}`}><div className="mb-5"><h3 className={`text-base font-bold ${theme.textPrimary}`}>通知偏好</h3><p className={`mt-1 text-xs ${theme.textSecondary}`}>选择哪些变化需要打断你的工作节奏。</p></div><div className="space-y-2">{[{ id: 'product', title: '工作台动态', desc: '新邮件、自动化任务和注册结果', icon: <WandSparkles className="h-4 w-4" /> }, { id: 'security', title: '安全提醒', desc: '登录、密码和权限变更通知', icon: <ShieldCheck className="h-4 w-4" /> }, { id: 'digest', title: '每周摘要', desc: '每周一早上发送工作台数据摘要', icon: <Bell className="h-4 w-4" /> }].map(item => <div key={item.id} className={`flex items-center gap-3 rounded-xl border p-3.5 ${isDark ? 'border-slate-700 hover:bg-white/[0.03]' : 'border-slate-200 hover:bg-slate-50'}`}><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/12 text-amber-600">{item.icon}</span><div className="min-w-0 flex-1"><p className={`text-xs font-bold ${theme.textPrimary}`}>{item.title}</p><p className={`mt-0.5 text-[11px] ${theme.textSecondary}`}>{item.desc}</p></div><button type="button" role="switch" aria-checked={notice[item.id]} onClick={() => setNotice({ ...notice, [item.id]: !notice[item.id] })} className={`relative h-6 w-11 rounded-full transition-colors ${notice[item.id] ? 'bg-blue-600' : isDark ? 'bg-slate-700' : 'bg-slate-200'}`}><motion.span animate={{ x: notice[item.id] ? 20 : 2 }} className="absolute left-0 top-1 h-4 w-4 rounded-full bg-white shadow-sm" /></button></div>)}</div><p className={`mt-4 flex items-center gap-1.5 text-[11px] ${theme.textSecondary}`}><Check className="h-3.5 w-3.5 text-emerald-500" />偏好会自动保存在本机浏览器</p></motion.section>}

            {section === 'appearance' && <motion.section key="appearance" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className={`rounded-2xl border p-5 sm:p-6 ${theme.cardBg} ${theme.border}`}><div className="mb-5"><h3 className={`text-base font-bold ${theme.textPrimary}`}>外观偏好</h3><p className={`mt-1 text-xs ${theme.textSecondary}`}>选择一套适合当前工作节奏的界面氛围。</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{['mist-blue-gray','warm-sand-gray','sage-gray','dark-dusk-blue-gray','dark-warm-charcoal','developer-midnight'].map(id => { const preset = ({ 'mist-blue-gray': '雾蓝灰', 'warm-sand-gray': '暖砂灰', 'sage-gray': '鼠尾草灰', 'dark-dusk-blue-gray': '暮蓝灰', 'dark-warm-charcoal': '暖炭灰', 'developer-midnight': '极客深空' } as Record<string, string>)[id]; const active = id === currentPreset.id; return <button key={id} type="button" onClick={() => onSelectPreset(id)} className={`group rounded-xl border p-3 text-left transition hover:-translate-y-0.5 ${active ? 'border-blue-500 ring-2 ring-blue-500/15' : theme.border}`}><div className="flex h-16 items-end gap-1 overflow-hidden rounded-lg p-2" style={{ background: id.includes('dark') || id === 'developer-midnight' ? '#161b22' : '#e7ecef' }}><span className="h-full w-1/4 rounded bg-black/15" /><span className="h-3/4 w-full rounded bg-white/55" /><span className="h-1/2 w-1/5 rounded bg-blue-500/75" /></div><div className="mt-2 flex items-center justify-between"><span className={`text-xs font-bold ${theme.textPrimary}`}>{preset}</span>{active && <Check className="h-3.5 w-3.5 text-blue-500" />}</div></button>; })}</div><div className={`mt-5 flex items-center gap-3 rounded-xl p-3 ${isDark ? 'bg-white/[0.04]' : 'bg-slate-50'}`}><Sparkles className="h-4 w-4 text-blue-500" /><p className={`text-[11px] ${theme.textSecondary}`}>主题选择会同步到顶部工作台，并保存在本机浏览器。</p></div></motion.section>}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
};
