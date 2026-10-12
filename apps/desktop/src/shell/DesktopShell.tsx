import type { ReactNode } from 'react';
import type { MediaSnapshot } from '@babacom/contracts';
import { t } from '../i18n';

export interface DesktopShellProps {
  children: ReactNode;
  status?: MediaSnapshot['status'];
}

const statusLabelKey: Record<MediaSnapshot['status'], Parameters<typeof t>[0]> = {
  idle: 'channelStatusIdle',
  connecting: 'channelStatusConnecting',
  connected: 'channelStatusConnected',
  leaving: 'channelStatusLeaving',
  failed: 'channelStatusFailed',
  'cleanup-failed': 'channelStatusCleanupFailed',
};

export function DesktopShell({ children, status = 'idle' }: DesktopShellProps) {
  const roomName = typeof window !== 'undefined' && window.admission?.roomName
    ? window.admission.roomName
    : t('defaultRoomName');
  const serverName = t('appName');
  const isConnected = status === 'connected';

  return (
    <div className="desktop-shell">
      <nav className="shell-rail" aria-label={t('serverRailLabel')}>
        <div className="rail-item active">
          <div className="rail-pill" aria-hidden="true" />
          <div
            className="rail-server-badge"
            role="img"
            aria-label={serverName}
            title={serverName}
          >
            <span className="rail-server-initials">{t('brandInitials')}</span>
          </div>
        </div>
      </nav>
      <nav className="shell-sidebar" aria-label={t('channelSidebarLabel')}>
        <header className="sidebar-header">
          <h2 className="sidebar-server-title">{serverName}</h2>
          <span className="sidebar-badge">{t('serverBadge')}</span>
        </header>
        <div className="sidebar-channels">
          <div className="channel-category">
            <span className="category-label">{t('voiceChannelsCategory')}</span>
          </div>
          <div className={`channel-item${isConnected ? ' connected' : ''}`}>
            <span className="channel-icon" aria-hidden="true">🔊</span>
            <span className="channel-name">{roomName}</span>
            <span className="channel-status-label">
              {t(statusLabelKey[status])}
            </span>
          </div>
        </div>
      </nav>
      <div className="shell-stage">
        {children}
      </div>
    </div>
  );
}
