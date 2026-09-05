import React, { useState } from 'react';
import { Users, Bell } from 'lucide-react';
import { NavTab, StylePreset } from '../types';
import { GrokRegistrationPanel } from './GrokRegistrationPanel';
import { RegistrationLogsPanel } from './RegistrationLogsPanel';
import { InvitationCodePanel } from './InvitationCodePanel';
import { UserDashboard } from './UserDashboard';
import { UserAuditPanel } from './UserAuditPanel';

interface ExtensionModulesProps {
  activeTab: NavTab;
  currentPreset: StylePreset;
  permissionCodes?: string[];
}

export const ExtensionModules: React.FC<ExtensionModulesProps> = ({
  activeTab,
  currentPreset,
  permissionCodes = [],
}) => {
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.mode === 'dark';

  if (activeTab === 'dashboard') {
    return <UserDashboard currentPreset={currentPreset} />;
  }

  if (activeTab === 'register') {
    return <GrokRegistrationPanel currentPreset={currentPreset} canRun={permissionCodes.includes('register:run')} />;
  }

  if (activeTab === 'invite') {
    return <InvitationCodePanel currentPreset={currentPreset} canManage={permissionCodes.includes('invite:manage')} />;
  }

  if (activeTab === 'logs') {
    return <RegistrationLogsPanel currentPreset={currentPreset} />;
  }

  if (activeTab === 'audit') {
    return <UserAuditPanel currentPreset={currentPreset} />;
  }

  return null;
};

