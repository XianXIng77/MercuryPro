import { Folder, Tag, AutoTagRule, Email } from '../types';

export const INITIAL_FOLDERS: Folder[] = [
  { id: 'inbox', name: '收件箱', icon: 'Inbox', type: 'system', unreadCount: 4 },
  { id: 'starred', name: '星标邮件', icon: 'Star', type: 'system', unreadCount: 2 },
  { id: 'sent', name: '已发送', icon: 'Send', type: 'system', unreadCount: 0 },
  { id: 'drafts', name: '草稿箱', icon: 'FileText', type: 'system', unreadCount: 1 },
  { id: 'archive', name: '归档中心', icon: 'Archive', type: 'system', unreadCount: 0 },
  { id: 'trash', name: '垃圾桶', icon: 'Trash2', type: 'system', unreadCount: 0 },
  { id: 'spam', name: '垃圾邮件', icon: 'AlertOctagon', type: 'system', unreadCount: 3 },
  // Custom Folders
  { id: 'work', name: '工作项目', icon: 'Briefcase', type: 'custom', unreadCount: 2, color: 'text-indigo-500' },
  { id: 'finance', name: '财务账单', icon: 'Receipt', type: 'custom', unreadCount: 1, color: 'text-emerald-500' },
  { id: 'travel', name: '差旅行程', icon: 'Plane', type: 'custom', unreadCount: 0, color: 'text-amber-500' },
  { id: 'personal', name: '个人私信', icon: 'User', type: 'custom', unreadCount: 1, color: 'text-rose-500' },
];

export const INITIAL_TAGS: Tag[] = [
  { id: 'urgent', name: '紧急高优', color: 'red', bgClass: 'bg-red-500/10', textClass: 'text-red-600 dark:text-red-400', borderClass: 'border-red-500/20' },
  { id: 'action', name: '待处理', color: 'amber', bgClass: 'bg-amber-500/10', textClass: 'text-amber-600 dark:text-amber-400', borderClass: 'border-amber-500/20' },
  { id: 'invoice', name: '账单明细', color: 'emerald', bgClass: 'bg-emerald-500/10', textClass: 'text-emerald-600 dark:text-emerald-400', borderClass: 'border-emerald-500/20' },
  { id: 'followup', name: '客户跟进', color: 'blue', bgClass: 'bg-blue-500/10', textClass: 'text-blue-600 dark:text-blue-400', borderClass: 'border-blue-500/20' },
  { id: 'marketing', name: '营销订阅', color: 'purple', bgClass: 'bg-purple-500/10', textClass: 'text-purple-600 dark:text-purple-400', borderClass: 'border-purple-500/20' },
  { id: 'personal', name: '私人联系', color: 'pink', bgClass: 'bg-pink-500/10', textClass: 'text-pink-600 dark:text-pink-400', borderClass: 'border-pink-500/20' },
];

export const INITIAL_RULES: AutoTagRule[] = [
  {
    id: 'rule-1',
    name: '发票与财务账单自动分类',
    enabled: true,
    conditionType: 'subject_contains',
    conditionValue: '发票',
    applyTags: ['账单明细'],
    targetFolderId: 'finance',
    markStarred: false,
  },
  {
    id: 'rule-2',
    name: '项目紧急提醒打标',
    enabled: true,
    conditionType: 'subject_contains',
    conditionValue: '紧急',
    applyTags: ['紧急高优', '待处理'],
    markStarred: true,
  },
  {
    id: 'rule-3',
    name: '带附件跟进提醒',
    enabled: true,
    conditionType: 'has_attachment',
    conditionValue: 'true',
    applyTags: ['待处理'],
  },
  {
    id: 'rule-4',
    name: '周报与汇报类自动识别',
    enabled: true,
    conditionType: 'subject_contains',
    conditionValue: '周报',
    applyTags: ['工作项目'],
    targetFolderId: 'work',
  },
];

export const INITIAL_EMAILS: Email[] = [
  {
    id: 'msg-101',
    senderName: '阿里云结算中心',
    senderEmail: 'billing@service.aliyun.com',
    senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
    recipient: 'me@company.com',
    subject: '【账单通知】2026年7月云服务器与存储服务电子发票及扣款凭证',
    snippet: '尊敬的用户：您2026年7月度的云产品账单已生成，电子发票已附于信末，总计￥2,840.00元...',
    body: `尊敬的用户：

您好！您2026年7月度的阿里云产品月度结算账单已生成，请查收。

- 结算总额：人民币 2,840.00 元
- 扣款方式：自动续费扣款（已成功）
- 计费周期：2026-07-01 至 2026-07-31
- 关联资源：ECS云服务器 4台、OSS对象存储 1TB、RDS数据库 2实例

已为您开具增值税电子普通发票，请在附件中下载 PDF 格式发票文件保存备查。
如对账单金额有疑义，可登录阿里云控制台提交费用工单咨询。

阿里云计算有限公司
2026年8月5日`,
    date: '08:30 AM',
    timestamp: Date.now() - 3600000 * 2,
    isRead: false,
    isStarred: true,
    folderId: 'finance',
    tags: ['账单明细'],
    urgency: 'normal',
    attachments: [
      { id: 'att-1', name: '阿里云电子发票_202607.pdf', size: '1.2 MB', type: 'pdf' },
      { id: 'att-2', name: '费用明细清单.xlsx', size: '420 KB', type: 'doc' },
    ],
    aiSummary: '2026年7月阿里云扣款凭证与发票已生成，总计￥2,840.00，随信附带PDF电子发票。',
    aiKeyPoints: ['扣款成功，金额￥2,840.00', '附件提供电子发票PDF和Excel清单', '如有疑问可提交费用工单'],
  },
  {
    id: 'msg-102',
    senderName: '张伟 (产品总监)',
    senderEmail: 'zhangwei@techcorp.com',
    senderAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80',
    recipient: 'me@company.com',
    subject: '【紧急】关于智邮 3.0 版本上线前的评审与架构复核',
    snippet: '各位团队成员：目前 3.0 版本的关键模块测试覆盖率尚未达标，需要在今天下午3点前完成...',
    body: `各位团队成员：

目前智邮 3.0 版本的关键模块测试覆盖率尚未达标，特别是自动标签分配引擎和多视图主题切换部分。
请研发团队在今天下午 15:00 前完成以下紧急任务：

1. 确认 Gemini AI 自动打了标签接口的对齐与错误熔断；
2. 修复极客暗黑模式下深色底色的字体对比度问题；
3. 完成新建分类文件夹时的未读数统计。

今天下午 16:00 我们将进行上线前的最后一次评审会议，请各位准备好演示环境。

张伟
产品研发部`,
    date: '10:15 AM',
    timestamp: Date.now() - 3600000 * 5,
    isRead: false,
    isStarred: true,
    folderId: 'work',
    tags: ['紧急高优', '待处理'],
    urgency: 'high',
    attachments: [
      { id: 'att-3', name: '智邮3.0上线 checklist.pdf', size: '2.8 MB', type: 'pdf' },
    ],
    aiSummary: '产品总监张伟要求在今日15:00前修复AI打标与主题样式对比度，并参加16:00上线评审会。',
    aiKeyPoints: ['15:00前交差AI接口与主题对比度修复', '16:00参加评审会', '附上线 CheckList 文件'],
  },
  {
    id: 'msg-103',
    senderName: '携程商旅',
    senderEmail: 'trip@ctrip.biz',
    senderAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80',
    recipient: 'me@company.com',
    subject: '【行程出票】上海虹桥 -> 北京首都 MU5182 航班机票预订成功',
    snippet: '尊敬的旅客：您的 2026-08-12 航班机票已成功出票，登机口信息将于航班起飞前2小时发送...',
    body: `尊敬的旅客：

您的差旅机票已成功出票，订单明细如下：

- 航班号：中国东方航空 MU5182
- 出发地：上海虹桥国际机场 T2
- 目的地：北京首都国际机场 T2
- 出发时间：2026年8月12日 08:30
- 到达时间：2026年8月12日 10:55
- 座位等级：经济舱 (已选靠窗 32A)

请携带有效身份证件提前 90 分钟到达机场办理登机手续。可通过携程商旅APP在线查看实时航班动态。`,
    date: '昨天 18:40',
    timestamp: Date.now() - 3600000 * 20,
    isRead: true,
    isStarred: false,
    folderId: 'travel',
    tags: ['待处理'],
    urgency: 'normal',
    aiSummary: '8月12日上海至北京东航 MU5182 航班预订成功，出发时间 08:30。',
    aiKeyPoints: ['8月12日08:30起飞', '上海虹桥T2 -> 北京首都T2', '座位已定靠窗 32A'],
  },
  {
    id: 'msg-104',
    senderName: 'GitHub Enterprise',
    senderEmail: 'notifications@github.company.com',
    senderAvatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&auto=format&fit=crop&q=80',
    recipient: 'me@company.com',
    subject: '[Pull Request] #142 Implement Multi-Theme Version Switcher & Auto-Tag Engine',
    snippet: 'alex-dev opened PR #142 in main-repo: Added 5 style presets, integrated Express API for automated tag rules...',
    body: `Hi developer,

alex-dev requested your review on Pull Request #142:

Title: Implement Multi-Theme Version Switcher & Auto-Tag Engine
Repository: core-mail/smart-web-app

Summary of Changes:
- Added 5 distinct theme options (Modern, Dark Tech, Classic, Warm, Compact)
- Integrated Express backend proxy for Gemini AI auto-classification
- Created custom folder management and tag rule matching
- Added 3 unit test suites for client-side tag filtering

Please review the code diff and approve if ready to merge.`,
    date: '昨天 14:20',
    timestamp: Date.now() - 3600000 * 24,
    isRead: true,
    isStarred: false,
    folderId: 'work',
    tags: ['客户跟进'],
    urgency: 'normal',
    aiSummary: 'GitHub 提交了 PR #142 代码审查请求，包含多主题与自动打标逻辑。',
    aiKeyPoints: ['PR #142 提交审查', '涉及多主题切换和Express AI打标引擎', '等待审批Merge'],
  },
  {
    id: 'msg-105',
    senderName: '李美华 (HRBP)',
    senderEmail: 'hr@techcorp.com',
    senderAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&auto=format&fit=crop&q=80',
    recipient: 'me@company.com',
    subject: '【通知】2026年度夏季团队建设活动（团建路线意向投票）',
    snippet: '亲爱的伙伴们：一年一度的夏季团建准备开启啦！本次备选路线包含三亚海岛放松、莫干山竹海避暑...',
    body: `亲爱的伙伴们：

一年一度的夏季团队建设活动即将开启！为了让大家度过一个满意的假期，HR团队精选了以下两条路线供大家投票：

路线 A：三亚 5天4晚 海岛冲浪与温泉惬意之旅
路线 B：莫干山 3天2晚 竹海避暑与露营音乐会

请大家在本周五（8月8日）18:00 前点击内部问卷系统参与投票。
团建预计安排在 8 月下旬，具体日期将在投票结束后公布。`,
    date: '08月04日',
    timestamp: Date.now() - 3600000 * 70,
    isRead: true,
    isStarred: false,
    folderId: 'inbox',
    tags: ['营销订阅'],
    urgency: 'low',
    aiSummary: 'HR发起夏季团建路线投票（三亚海岛 vs 莫干山竹海），截止时间本周五18:00。',
    aiKeyPoints: ['三亚与莫干山两条候选路线', '投票截止今晚18:00', '预计8月下旬出行'],
  },
  {
    id: 'msg-106',
    senderName: '王小强',
    senderEmail: 'wangxq_private@163.com',
    senderAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80',
    recipient: 'me@company.com',
    subject: '好久不见！下周周末同学聚会安排',
    snippet: '老同学，好久没联系了！下周六几个高中同学打算在静安区小聚，你有时间过来吗？...',
    body: `老同学：

好久没联系了！听小林说你最近换了新项目，比较忙。
下周六（8月15日）晚上 18:30，我们几个老同学打算在静安寺附近的一家餐厅小聚一下。

有小林、张莉还有陈浩，大家都挺想念你的。
方便的话回复我一下，我好提前订桌！`,
    date: '08月03日',
    timestamp: Date.now() - 3600000 * 96,
    isRead: false,
    isStarred: true,
    folderId: 'personal',
    tags: ['私人联系'],
    urgency: 'low',
    aiSummary: '高中老同学王小强邀请参加 8月15日 静安寺同学聚会，等待回复确认。',
    aiKeyPoints: ['8月15日18:30同学聚会', '地点静安寺附近', '需回复确认订桌'],
  },
  {
    id: 'msg-107',
    senderName: 'AWS Promos',
    senderEmail: 'no-reply@amazon.com',
    senderAvatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&auto=format&fit=crop&q=80',
    recipient: 'me@company.com',
    subject: 'Special Offer: Claim $500 AWS Cloud Credits for Generative AI App Building',
    snippet: 'Exclusive developer deal: Build next-gen LLM applications using AWS Bedrock and get up to $500 free credits...',
    body: `Hello Developer,

Empower your applications with foundational models. Claim your $500 free promotional credits today to build scalable AI agents and microservices.

Offer expires in 7 days. Click below to activate your account promo code.`,
    date: '08月01日',
    timestamp: Date.now() - 3600000 * 150,
    isRead: false,
    isStarred: false,
    folderId: 'spam',
    tags: ['营销订阅'],
    urgency: 'low',
    aiSummary: 'AWS 营销推广邮件，提示领取 $500 云生成式 AI 抵扣券。',
    aiKeyPoints: ['AWS $500 优惠券', '7天内到期'],
  },
];
