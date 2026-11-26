import {
  Building2,
  Coins,
  FolderGit2,
  KanbanSquare,
  Radar,
  ShieldCheck,
} from 'lucide-react';
import { isPagesMode, workspaceHref } from '@/lib/links';

const FEATURES = [
  {
    icon: Building2,
    tag: '空间与自建',
    title: '3D 数字办公室与从零自建空间',
    desc: '既可在默认户型上扩建工位与增设家具，也可切换至 24×20m 空白蓝图从零建造：先画正交墙与门洞（近距离自动磁吸无缝转角），再铺设 4 材质地板或一键铺满，最后摆放工位、功能区与摆件。',
    bullets: ['支持编织地毯 / 暖橡木 / 浅灰石 / 灰绿砖 4 种地板', '内置老板桌、前台、会议长桌、休息长桌与 8 种办公摆件', '2D A* 避障穿门寻路、24h 自然光影与独立随机错峰休息'],
    href: workspaceHref('#layout/decorate', '#demo'),
    linkText: isPagesMode ? '在下方体验 3D 样板' : '体验 3D 自由布置',
  },
  {
    icon: Radar,
    tag: '发现与接入',
    title: '多运行器自动发现与异机采集',
    desc: '自动扫描本机安装的 Codex、Pi、Claude Code、Gemini CLI、OpenCode、WorkBuddy、Antigravity 等运行器；提供独立 CLI 客户端 symbio，通过一次性配对码安全接入远程主机。',
    bullets: ['先接入运行器，再在智能体中按需复用绑定', '支持只读任务/成员查询与离线机器安全删除', '未适配运行器以「仅观察模式」纳入统一盘点'],
    href: workspaceHref('#discovery', '#demo'),
    linkText: isPagesMode ? '查看接入演示' : '前往发现与接入',
  },
  {
    icon: ShieldCheck,
    tag: '组织与治理',
    title: '小队、Skills、MCP 与 GitHub 授权',
    desc: '按职责组建真人与 AI 混合小队，从在线技能目录固定版本下载或导入 SKILL.md，配置 stdio / Streamable HTTP MCP 白名单与 GitHub 仓库级工具权限。',
    bullets: ['执行适配状态与管理员授权分离管理', '人事 / 财务岗位默认只读安全上限', '小队、技能、标签、属性与 MCP 支持原子化级联安全删除'],
    href: workspaceHref('#agents', '#guide'),
    linkText: isPagesMode ? '查看配置说明' : '管理智能体团队',
  },
  {
    icon: KanbanSquare,
    tag: '任务与会议',
    title: '看板流转、定时派发与多轮讨论',
    desc: '默认呈现待办、进行中、审核中、已完成四列核心看板（支持展开规划/阻塞/取消扩展列），可拆分子任务、设一次性定时派发，或拉起双人/多人会议室讨论。',
    bullets: ['看板 / 列表 / 表格三种视图自由切换', '支持任务标签、自定义字段与 CSV 导出', '评论区 @ 提及联动收件箱与邮件通知'],
    href: workspaceHref('#tasks/all', '#demo'),
    linkText: isPagesMode ? '体验任务流转' : '查看任务看板',
  },
  {
    icon: FolderGit2,
    tag: '项目工作区',
    title: '文件版本留痕与人工验收发布',
    desc: '每个项目配备独立的公共工作区。AI 执行完成后交付文件自动进入待发布区，支持开工基线、当前版本与本次交付三方对比，无误后一键发布或退回重跑。',
    bullets: ['每次上传与发布自动递增版本号（v1, v2…）', '多任务并发改动自动检测版本冲突', '可选绑定 HTTPS Git 仓库地址'],
    href: workspaceHref('#tasks', '#guide'),
    linkText: isPagesMode ? '查看验收流程' : '浏览项目工作台',
  },
  {
    icon: Coins,
    tag: '算力与安全',
    title: '三级 Token 预算与本机优先架构',
    desc: '按公司、小队、员工三级设置 Token 预算并实时预留防超支；所有状态与审计记录完全保存在本地 SQLite 数据库中，默认仅监听回环地址。',
    bullets: ['启动前自动预留额度，超预算拒绝派发', '同源请求校验与管理员/成员双角色隔离', '保留最近 100 条关键管理操作审计日志'],
    href: workspaceHref('#finance', '#faq'),
    linkText: isPagesMode ? '了解安全护栏' : '查看统计与预算',
  },
];

export default function FeatureGrid() {
  return (
    <section id="features" className="w-full py-16 sm:py-22">
      <div className="w-full max-w-[1320px] mx-auto px-5 sm:px-8 lg:px-12">
        <div className="max-w-[680px] mb-10 sm:mb-12">
          <p className="text-[12px] font-semibold tracking-[0.12em] uppercase text-[#3d614e] mb-2.5">
            CORE CAPABILITIES · 核心产品能力
          </p>
          <h2 className="text-[28px] sm:text-[36px] font-bold tracking-[-0.02em] text-[#252423] leading-[1.22]">
            从底层运行器到 3D 办公现场，完整闭环
          </h2>
          <p className="text-[15px] text-[#5d5956] leading-[1.7] mt-3">
            不再在零散的终端窗口里盲猜每个 Agent 正在做什么——用一套符合直觉的团队管理体系，把发现、授权、派发、交付与核算全部收拢到位。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((item) => {
            const Icon = item.icon;
            return (
              <article
                key={item.title}
                className="group flex flex-col rounded-[20px] bg-white/75 backdrop-blur-[18px] border border-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_12px_32px_-18px_rgba(37,36,35,0.16)] p-6 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/90 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_18px_40px_-18px_rgba(37,36,35,0.22)]"
              >
                <div className="flex items-center justify-between gap-3 mb-4">
                  <span className="inline-flex items-center justify-center w-10 h-10 rounded-[12px] bg-[#f1ede8] border border-[#e0d8cf] text-[#3d614e]">
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-[#ede9e3] text-[#5d5956] text-[11px] font-medium">
                    {item.tag}
                  </span>
                </div>

                <h3 className="text-[17px] font-bold text-[#252423] mb-2">{item.title}</h3>
                <p className="text-[13.5px] text-[#5d5956] leading-[1.68] mb-4">{item.desc}</p>

                <ul className="space-y-1.5 text-[12.5px] text-[#45413e] mb-5 flex-1">
                  {item.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3d614e] mt-[7px] shrink-0" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>

                <div className="pt-3.5 border-t border-[#484239]/10">
                  <a
                    href={item.href}
                    className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#3d614e] hover:text-[#274636] transition-colors"
                  >
                    {item.linkText}
                    <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
