import React, { useEffect, useState } from 'react';
import { AlertCircle, LoaderCircle, Mail } from 'lucide-react';
import {
  getPublicMicrosoftMailbox,
  mapAccount,
} from '../api/microsoftMail';
import { MailAccount, StylePreset } from '../types';
import { MailboxInboxView } from './MailboxInboxView';

interface PublicMailboxInboxPageProps {
  accessToken: string;
  currentPreset: StylePreset;
}

export const PublicMailboxInboxPage: React.FC<PublicMailboxInboxPageProps> = ({
  accessToken,
  currentPreset,
}) => {
  const theme = currentPreset.themeClasses;
  const [account, setAccount] = useState<MailAccount | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;
    getPublicMicrosoftMailbox(accessToken)
      .then((snapshot) => {
        if (!active) return;
        if (!snapshot.accountId || !snapshot.email) {
          setErrorMessage('收件链接对应的邮箱不存在');
          return;
        }
        setAccount(mapAccount({ accountId: snapshot.accountId, email: snapshot.email }));
      })
      .catch((error: any) => {
        if (active) setErrorMessage(error?.message || '收件链接无效或已过期');
      });
    return () => {
      active = false;
    };
  }, [accessToken]);

  if (account) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
      <MailboxInboxView
        account={account}
        publicAccessToken={accessToken}
        onBackToAccountList={() => {
          if (window.opener) window.close();
          else window.history.back();
        }}
        currentPreset={currentPreset}
      />
      </div>
    );
  }

  return (
    <div className={`flex min-h-screen items-center justify-center p-6 ${theme.appBg}`}>
      <div className={`w-full max-w-md rounded-2xl border p-8 text-center ${theme.cardBg} ${theme.border} ${theme.shadow}`}>
        {errorMessage ? (
          <>
            <AlertCircle className="mx-auto h-10 w-10 text-rose-500" />
            <h1 className={`mt-4 text-base font-bold ${theme.textPrimary}`}>无法打开收件箱</h1>
            <p className={`mt-2 text-xs leading-5 ${theme.textSecondary}`}>{errorMessage}</p>
          </>
        ) : (
          <>
            <LoaderCircle className="mx-auto h-10 w-10 animate-spin text-blue-600" />
            <h1 className={`mt-4 text-base font-bold ${theme.textPrimary}`}>正在打开邮箱收件箱</h1>
            <p className={`mt-2 text-xs ${theme.textSecondary}`}><Mail className="mr-1 inline h-3.5 w-3.5" />正在验证收件链接…</p>
          </>
        )}
      </div>
    </div>
  );
};
