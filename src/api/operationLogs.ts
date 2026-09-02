export interface OperationAuditLog {
  id: string;
  user: string;
  email: string;
  action: string;
  module: string;
  detail: string;
  ip: string;
  device: string;
  time: string;
  status: '成功' | '失败';
  risk: '普通' | '关注' | '高风险';
}

export interface OperationAuditSummary {
  today: number;
  activeUsers: number;
  success: number;
  risks: number;
}

export interface OperationAuditResult {
  items: OperationAuditLog[];
  total: number;
  summary: OperationAuditSummary;
}

export const operationLogsApi = {
  async list(params: { q?: string; action?: string; status?: string } = {}): Promise<OperationAuditResult> {
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q);
    if (params.action && params.action !== '全部') query.set('action', params.action);
    if (params.status && params.status !== '全部') query.set('status', params.status);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const response = await fetch(`/api/audit-logs${suffix}`, { credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.detail || payload?.error || `日志加载失败（HTTP ${response.status}）`);
    return payload as OperationAuditResult;
  },
};
