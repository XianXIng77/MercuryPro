import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Eye, EyeOff, Github, Loader2, Lock, Mail, Sparkles, User } from 'lucide-react';
import type { StylePreset } from '../types';

interface LoginViewProps {
  currentPreset: StylePreset;
  onLoginSuccess: (email: string) => void;
}

/** Google "G" 官方四色 logo(SVG) */
const GoogleLogo: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
    <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
  </svg>
);

/** 微信 logo(双气泡 SVG) */
const WechatLogo: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <g fill="#07C160">
      <ellipse cx="8.9" cy="9.2" rx="6.9" ry="5.6" />
      <path d="M5.4 13.4 4.2 16.8 8 14.4z" />
      <ellipse cx="15.3" cy="14.3" rx="5.6" ry="4.6" />
      <path d="M18.2 17.6 19.6 20.6 16.2 18.7z" />
    </g>
    <circle cx="6.6" cy="8.2" r="0.95" fill="#fff" />
    <circle cx="11.2" cy="8.2" r="0.95" fill="#fff" />
    <circle cx="13.5" cy="13.6" r="0.8" fill="#fff" />
    <circle cx="17.1" cy="13.6" r="0.8" fill="#fff" />
  </svg>
);

/** QQ logo(官方企鹅轮廓,白底) */
const QqLogo: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="12" fill="#fff" />
    <g transform="translate(1.92 1.92) scale(0.84)">
      <path
        fill="#1F2329"
        d="M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673.54.065 2.103-2.472 2.103-2.472 0 1.469.756 3.387 2.394 4.771-.612.188-1.363.479-1.845.835-.434.32-.379.646-.301.778.343.578 5.883.369 7.482.189 1.6.18 7.14.389 7.483-.189.078-.132.132-.458-.301-.778-.483-.356-1.233-.646-1.846-.836 1.637-1.384 2.393-3.302 2.393-4.771 0 0 1.563 2.537 2.103 2.472.251-.03.581-1.39-.438-4.673"
      />
    </g>
  </svg>
);

/**
 * 高互动登录页:
 * - 呼吸光晕 + 视差网格背景 + 漂浮粒子
 * - 玻璃拟态卡片,输入框聚焦时高亮 + 图标动效
 * - 密码可见切换、记住我、错误抖动、成功过渡动画
 */
export const LoginView: React.FC<LoginViewProps> = ({ currentPreset, onLoginSuccess }) => {
  const isDark = currentPreset.mode === 'dark';

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  const [oauthProvider, setOauthProvider] = useState<'google' | 'github' | 'wechat' | 'qq' | null>(null);

  // ── 漂浮粒子背景 ─────────────────────────────────────────────
  const particles = useMemo(
    () =>
      Array.from({ length: 24 }, (_, index) => ({
        id: index,
        left: `${(index * 37 + 11) % 100}%`,
        top: `${(index * 53 + 7) % 100}%`,
        size: 3 + ((index * 7) % 5),
        duration: 9 + (index % 6) * 2.2,
        delay: -(index % 9) * 1.4,
        drift: (index % 2 === 0 ? 1 : -1) * (12 + (index % 4) * 9),
      })),
    [],
  );

  // ── 提交 ─────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'submitting') return;
    // 演示模式:模拟网络延迟后直接成功
    const timer = window.setTimeout(() => {
      setStatus('success');
      window.setTimeout(() => onLoginSuccess(email || 'demo@mercury.pro'), 900);
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [status, email, onLoginSuccess]);

  // ── OAuth 第三方登录(演示模式:模拟跳转回调) ────────────────────
  useEffect(() => {
    if (!oauthProvider) return;
    // 接入 fastapi-users 后,这里改为 window.location.href = `/api/v1/auth/oauth/${oauthProvider}/authorize`
    const demoEmails = { google: 'user@gmail.com', github: 'user@github', wechat: 'user@wechat', qq: 'user@qq.com' } as const;
    const timer = window.setTimeout(() => {
      setStatus('success');
      window.setTimeout(() => onLoginSuccess(demoEmails[oauthProvider]), 900);
    }, 1300);
    return () => window.clearTimeout(timer);
  }, [oauthProvider, onLoginSuccess]);

  const handleOauthClick = (provider: 'google' | 'github' | 'wechat' | 'qq') => {
    if (status !== 'idle' || oauthProvider) return;
    setError('');
    setOauthProvider(provider);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (status !== 'idle') return;
    setError('');

    if (mode === 'register' && username.trim().length < 2) {
      setError('用户名至少需要 2 个字符');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('请输入有效的邮箱地址');
      return;
    }
    if (password.length < 8) {
      setError(mode === 'login' ? '密码至少 8 位（演示模式：任意邮箱 + 8 位以上密码即可进入）' : '密码至少需要 8 个字符');
      return;
    }
    setStatus('submitting');
  };

  const inputBase =
    'w-full rounded-xl border bg-transparent py-3 pr-11 text-sm outline-none transition-all duration-200 placeholder:text-slate-400/70';

  const fieldClass = error
    ? `${inputBase} border-rose-500/60 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/15`
    : isDark
      ? `${inputBase} border-slate-600/80 focus:border-blue-500/80 focus:ring-4 focus:ring-blue-500/15`
      : `${inputBase} border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15`;

  return (
    <div
      className={`relative h-screen w-full overflow-hidden font-sans ${
        isDark
          ? 'bg-[radial-gradient(ellipse_at_top_left,#0f2557_0%,#0b1220_45%,#070b14_100%)] text-slate-200'
          : 'bg-[radial-gradient(ellipse_at_top_left,#dbeafe_0%,#eef2ff_45%,#f8fafc_100%)] text-slate-800'
      }`}
    >
      {/* 网格背景 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(96,165,250,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(96,165,250,0.35) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 40%, black 30%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 40%, black 30%, transparent 100%)',
        }}
      />

      {/* 漂浮粒子 */}
      {particles.map((particle) => (
        <motion.span
          key={particle.id}
          className="pointer-events-none absolute rounded-full bg-blue-400/40"
          style={{ left: particle.left, top: particle.top, width: particle.size, height: particle.size }}
          animate={{ y: [0, -46, 0], x: [0, particle.drift, 0], opacity: [0.15, 0.7, 0.15] }}
          transition={{ duration: particle.duration, delay: particle.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}

      {/* 顶部光斑 */}
      <motion.div
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-blue-500/20 blur-[120px]"
        animate={{ opacity: [0.5, 0.85, 0.5] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* 品牌区 */}
      <motion.div
        initial={{ opacity: 0, y: -18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="absolute left-1/2 top-14 z-10 -translate-x-1/2 text-center"
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/30">
          <Sparkles className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight">
          <span className="bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500 bg-clip-text text-transparent">MERCURY</span>
          <span className="ml-2 rounded-md bg-blue-600 px-1.5 py-0.5 align-middle font-mono text-xs text-white">PRO</span>
        </h1>
        <p className={`mt-1.5 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>智能邮箱管理 · 注册引擎 · 多人协作工作台</p>
      </motion.div>

      {/* 登录卡片 */}
      <motion.div
        initial={{ opacity: 0, y: 34, scale: 0.96 }}
        animate={{ opacity: status === 'success' ? 0 : 1, y: status === 'success' ? -26 : 0, scale: status === 'success' ? 0.97 : 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className={`absolute left-1/2 top-1/2 z-10 w-[min(94vw,420px)] -translate-x-1/2 translate-y-[-140px] rounded-2xl border p-7 shadow-2xl backdrop-blur-xl ${
          isDark ? 'border-white/10 bg-slate-900/60 shadow-blue-950/40' : 'border-white/60 bg-white/70 shadow-slate-300/50'
        }`}
      >
        {/* 登录/注册切换 */}
        <div className={`relative mb-6 grid grid-cols-2 rounded-xl p-1 text-xs font-bold ${isDark ? 'bg-slate-800/70' : 'bg-slate-100'}`}>
          {(['login', 'register'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => { setMode(item); setError(''); }}
              className={`relative z-10 rounded-lg py-2 transition-colors duration-200 ${mode === item ? 'text-white' : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {mode === item && (
                <motion.span
                  layoutId="loginModePill"
                  className="absolute inset-0 -z-10 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 shadow-md shadow-blue-500/25"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              {item === 'login' ? '登 录' : '注 册'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <AnimatePresence mode="popLayout" initial={false}>
            {mode === 'register' && (
              <motion.div
                key="username-field"
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 0 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="relative">
                  <User className={`pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 transition-colors ${error && username.trim().length < 2 ? 'text-rose-500' : 'text-slate-400'}`} />
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="用户名"
                    autoComplete="username"
                    className={`${fieldClass} pl-10 ${isDark ? 'focus:bg-slate-900/70' : 'focus:bg-white'}`}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative">
            <Mail className={`pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 transition-colors ${error && !email.trim() ? 'text-rose-500' : 'text-slate-400'}`} />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="邮箱地址"
              autoComplete="email"
              className={`${fieldClass} pl-10 ${isDark ? 'focus:bg-slate-900/70' : 'focus:bg-white'}`}
            />
          </div>

          <div className="relative">
            <Lock className={`pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 transition-colors ${error && password.length < 8 ? 'text-rose-500' : 'text-slate-400'}`} />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === 'login' ? '密码' : '设置密码（至少 8 位）'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className={`${fieldClass} pl-10 ${isDark ? 'focus:bg-slate-900/70' : 'focus:bg-white'}`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:text-blue-500"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {/* 错误提示(抖动) */}
          <AnimatePresence mode="popLayout" initial={false}>
            {error && status === 'idle' && (
              <motion.p
                key={error}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0, x: [0, -7, 7, -4, 4, 0] }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.4 }}
                className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] font-semibold text-rose-500"
                role="alert"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-between pt-0.5 text-[11px]">
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-600" />
              记住我
            </label>
            <button type="button" className="font-semibold text-blue-500 transition-colors hover:text-indigo-500">
              忘记密码？
            </button>
          </div>

          <motion.button
            type="submit"
            whileHover={{ scale: status === 'idle' ? 1.015 : 1 }}
            whileTap={{ scale: status === 'idle' ? 0.97 : 1 }}
            disabled={status !== 'idle'}
            className={`relative w-full overflow-hidden rounded-xl py-3 text-sm font-bold text-white transition-all duration-300 ${
              status === 'success'
                ? 'bg-emerald-500 shadow-lg shadow-emerald-500/30'
                : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 shadow-lg shadow-blue-600/30 hover:shadow-blue-500/40'
            } ${status === 'submitting' ? 'cursor-wait' : ''}`}
          >
            {/* 流光效果 */}
            {status === 'idle' && (
              <motion.span
                className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent"
                initial={{ x: '-150%' }}
                animate={{ x: ['-150%', '450%'] }}
                transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 1.6, ease: 'easeInOut' }}
              />
            )}
            <span className="relative z-10 flex items-center justify-center gap-2">
              {status === 'submitting' && <Loader2 className="h-4 w-4 animate-spin" />}
              {status === 'submitting' ? '正在验证…' : status === 'success' ? '验证通过，正在进入工作台' : mode === 'login' ? '登录工作台' : '创建账号'}
            </span>
          </motion.button>
        </form>

        {/* 第三方登录 */}
        <div className={`mt-5 border-t pt-4 ${isDark ? 'border-slate-700/60' : 'border-slate-200/80'}`}>
          <p className="mb-3 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">
            或使用第三方账号登录
          </p>
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => handleOauthClick('google')}
              disabled={status !== 'idle' || !!oauthProvider}
              title="谷歌邮箱登录"
              aria-label="谷歌邮箱登录"
              className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all hover:-translate-y-0.5 hover:border-blue-500/50 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 ${
                isDark ? 'border-slate-600/70 bg-slate-800/60 text-slate-200 hover:bg-slate-800' : 'border-slate-200 bg-white/80 text-slate-700 hover:bg-white'
              }`}
            >
              {oauthProvider === 'google' ? <Loader2 className="h-5 w-5 animate-spin" /> : <GoogleLogo className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => handleOauthClick('github')}
              disabled={status !== 'idle' || !!oauthProvider}
              title="GitHub 登录"
              aria-label="GitHub 登录"
              className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all hover:-translate-y-0.5 hover:border-blue-500/50 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 ${
                isDark ? 'border-slate-600/70 bg-slate-800/60 text-slate-200 hover:bg-slate-800' : 'border-slate-200 bg-white/80 text-slate-700 hover:bg-white'
              }`}
            >
              {oauthProvider === 'github' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Github className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => handleOauthClick('wechat')}
              disabled={status !== 'idle' || !!oauthProvider}
              title="微信登录"
              aria-label="微信登录"
              className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all hover:-translate-y-0.5 hover:border-blue-500/50 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 ${
                isDark ? 'border-slate-600/70 bg-slate-800/60 text-slate-200 hover:bg-slate-800' : 'border-slate-200 bg-white/80 text-slate-700 hover:bg-white'
              }`}
            >
              {oauthProvider === 'wechat' ? <Loader2 className="h-5 w-5 animate-spin" /> : <WechatLogo className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => handleOauthClick('qq')}
              disabled={status !== 'idle' || !!oauthProvider}
              title="QQ 登录"
              aria-label="QQ 登录"
              className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all hover:-translate-y-0.5 hover:border-blue-500/50 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 ${
                isDark ? 'border-slate-600/70 bg-slate-800/60 text-slate-200 hover:bg-slate-800' : 'border-slate-200 bg-white/80 text-slate-700 hover:bg-white'
              }`}
            >
              {oauthProvider === 'qq' ? <Loader2 className="h-5 w-5 animate-spin" /> : <QqLogo className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </motion.div>

      {/* 底部版权 */}
      <p className={`absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-[10px] ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>
        MercuryPro 2.0 © 2026
      </p>
    </div>
  );
};
