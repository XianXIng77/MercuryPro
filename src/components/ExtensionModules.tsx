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
    return <UserDashboard currentPreset={currentPreset} permissionCodes={permissionCodes} />;
  }

  if (activeTab === 'register') {
    return <GrokRegistrationPanel currentPreset={currentPreset} canView={permissionCodes.includes('register:view')} canConfig={permissionCodes.includes('register:config')} canRun={permissionCodes.includes('register:run')} canResource={permissionCodes.includes('register:resource')} canTokenRead={permissionCodes.includes('register:token:read')} />;
  }

  if (activeTab === 'invite') {
    return <InvitationCodePanel currentPreset={currentPreset} canQuery={permissionCodes.includes('invite:view')} canGenerate={permissionCodes.includes('invite:create')} canUpdate={permissionCodes.includes('invite:update')} canDelete={permissionCodes.includes('invite:delete')} canExport={permissionCodes.includes('invite:export')} />;
  }

  if (activeTab === 'logs') {
    return <RegistrationLogsPanel currentPreset={currentPreset} canQuery={permissionCodes.includes('logs:view')} />;
  }

  if (activeTab === 'audit') {
    return <UserAuditPanel currentPreset={currentPreset} canQuery={permissionCodes.includes('audit:view')} />;
  }

  return null;
};
