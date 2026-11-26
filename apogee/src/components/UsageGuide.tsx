import { useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Copy,
  Keyboard,
  Terminal,
} from 'lucide-react';

interface GuideStep {
  num: string;
  title: string;
  short: string;
  summary: string;
  bullets: string[];
  codeTitle: string;
  code: string;
  entryHref: string;
  entryLabel: string;
  tip: string;
}

const GUIDE_STEPS: GuideStep[] = [
  {
    num: '01',
    title: '启动本机工作台并初始化管理员',
    short: '启动与建档',
    summary:
      'Symbio 采用本机优先架构，无需部署外部数据库。启动后访问本机端口创建首个管理员账号，系统会自动为你保留 3D 办公室中的独立老板办公室。',
    bullets: [
      '默认监听 http://127.0.0.1:4317，数据自动持久化至本地 data/office.sqlite。',
      '可在「设置 → 常规」自定义公司名称、任务编号前缀（如 AG-1）和注入给所有 Agent 的工作区上下文。',
      '支持通过「设置 → 账号与权限」审批团队其他真人成员加入，成员与管理员权限严格隔离。',
    ],
    codeTitle: '启动命令与常用环境变量',
    code: `# 启动 Symbio 本机工作台（默认 4317 端口）
npm start

# 自定义数据目录、端口与最大并发执行数
OFFICE_PORT=4317 OFFICE_CONCURRENCY=3 OFFICE_DATA_DIR=./data npm start`,
    entryHref: '/office#settings/workspace',
    entryLabel: '打开工作区常规设置',
    tip: '首次登录后可在「设置 → 常规」补充项目技术栈与代码规范上下文，所有 Agent 执行任务时都会自动读取。',
  },
  {
    num: '02',
    title: '发现并接入本机或远程 Agent 运行器',
    short: '运行器接入',
    summary:
      '「接入运行器」与「创建员工」解耦设计：先在「发现与接入」扫描并接入可用运行器到公司资源池，后续即可在智能体档案中为多位员工复用同一个运行器。',
    bullets: [
      '本机自动扫描：识别已安装的 Codex、Pi、Claude Code、Gemini CLI、OpenCode、WorkBuddy、Antigravity 等运行器。',
      '远程/异机采集：在「发现与接入 → 采集机器」安装独立 CLI 客户端 symbio，通过一次性配对码安全接入其他主机。',
      '已适配执行的运行器可直接调度任务；未适配运行器接入后以「仅观察模式」记录进程与在线状态。',
    ],
    codeTitle: '异机接入 symbio 采集客户端示例',
    code: `# 1. 在目标主机全局安装采集客户端（Node.js 22.13+）
npm install -g symbio-agent-collector@0.2.0

# 2. 使用工作台生成的一次性配对码登录并持续采集
symbio login 'http://127.0.0.1:4318' --run

# 3. 随时查询状态或只读查看任务列表
symbio status --json && symbio tasks list --status in_progress`,
    entryHref: '/office#discovery',
    entryLabel: '前往发现与接入',
    tip: '本机采集端口默认为工作台端口 + 1（4318），仅监听回环地址；跨主机局域网采集支持 TLS 证书配置。',
  },
  {
    num: '03',
    title: '组建小队、装配 Skills / MCP 与自建 3D 空间',
    short: '团队与空间建造',
    summary:
      '为你的 AI 员工设定岗位、人格、Skills、MCP 与 GitHub 仓库权限；并在「空间与工位 → 自由布置」中自由扩建默认户型，或切换至「从零自建空间」按三步画出专属办公室。',
    bullets: [
      '团队与能力：在「小队」分组，在「Skills」固定版本下载技能包或导入 SKILL.md，在「设置 → MCP / GitHub」细粒度授权工具与仓库。',
      '从零画 3D 空间：① 拉线画正交墙与 1.4m 门洞（靠近墙角/墙面 ≤0.85m 自动磁吸无缝转角，按住 Alt 暂关吸附）；② 铺 4 材质地板或一键「按墙体外框铺满地板」；③ 摆放工位桌椅（D-01..）、老板桌、前台、会议/休息长桌与 8 种摆件。',
      '智能寻路与保护：保存后自动启用 2D A* 避障穿门寻路；已入座工位与承载家具的地板受保护防误删。',
    ],
    codeTitle: '3D 自由布置常用快捷键与工作流',
    code: `1. 绘制墙面 → 靠近墙角/T型墙面自动磁吸无缝连接（按住 Alt 临时关闭吸附）
2. 铺设地板 → 拖拽拼接编织地毯 / 暖橡木 / 浅灰石 / 灰绿砖，或一键按墙体铺满
3. 摆放家具 → R 旋转 90° · Delete 删除选中 · ⌘Z / ⌘⇧Z 撤销重做 · Esc 退出工具`,
    entryHref: '/office#layout/decorate',
    entryLabel: '打开 3D 自由布置',
    tip: '小队、Skills、任务标签、自定义属性和 MCP 服务均支持随时编辑与原子化级联安全删除，删除时自动清理关联引用并写入操作审计。',
  },
  {
    num: '04',
    title: '派发任务、发起多人会议并人工验收发布',
    short: '协作与验收',
    summary:
      '把需求变成可追踪、可对比、可预算控制的标准交付流程——从新建任务、Agent 执行、会议讨论到三方对比验收发布，全链路留痕。',
    bullets: [
      '在「任务」看板创建任务或一次性定时派发任务，配置标签、优先级与自定义字段；支持看板 / 列表 / 表格三视图。',
      '需要头脑风暴或方案评审时，在「聊天」选中 2 名以上智能体发起双人交流或会议室多轮讨论，一键转为后续任务。',
      '任务完成后在「项目 → 公共工作区 → 待发布」对比开工基线、当前版本与本次交付，确认无误后验收发布；在「统计」掌控 Token 预算。',
    ],
    codeTitle: '关键治理与安全护栏',
    code: `• 任务启动前：自动校验公司 / 小队 / 员工三级 Token 预算并预留额度
• 任务执行中：支持实时查看阶段耗时、工具调用轨迹与随时点击「停止」
• 交付验收时：并发修改自动触发版本冲突提示，必须经人工确认才能发布新版本`,
    entryHref: '/office#tasks/all',
    entryLabel: '打开任务看板',
    tip: '在办公室 3D 视图中，你可以点击工具栏的光影按钮实时预览清晨 / 正午 / 黄昏 / 深夜效果，也能自由旋转缩放观察团队动态。',
  },
];

const QUICK_TIPS = [
  { key: '⌘ K', title: '全局快捷搜索', desc: '在工作台任意页面快速检索项目、任务编号、真人与 AI 成员。' },
  { key: 'R / Alt', title: '3D 自由建造快捷键', desc: '画墙靠近墙角自动磁吸无缝转角（按住 Alt 暂关吸附），按 R 旋转家具、⌘Z 撤销。' },
  { key: '分级预算', title: '三层额度防失控', desc: '在「统计」分别为公司、小队和单个员工设限，超额自动拦截派发。' },
  { key: '审计追踪', title: '操作记录可回溯', desc: '「设置 → 操作记录」自动保留最近 100 条成员、工位、权限、删除与发布变更。' },
];

export default function UsageGuide() {
  const [stepIdx, setStepIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const current = GUIDE_STEPS[stepIdx];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(current.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section id="guide" className="w-full py-16 sm:py-22">
      <div className="w-full max-w-[1320px] mx-auto px-5 sm:px-8 lg:px-12">
        <div className="max-w-[680px] mb-10">
          <p className="text-[12px] font-semibold tracking-[0.12em] uppercase text-[#3d614e] mb-2.5">
            USAGE GUIDE · 使用说明与上手指南
          </p>
          <h2 className="text-[28px] sm:text-[36px] font-bold tracking-[-0.02em] text-[#252423] leading-[1.22]">
            四步搭建你的多 Agent 数字公司
          </h2>
          <p className="text-[15px] text-[#5d5956] leading-[1.7] mt-2.5">
            从启动本机服务到完成首份 AI 交付物的人工验收，全程约 5 分钟即可跑通。
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Step selector list */}
          <div className="lg:col-span-4 flex flex-col gap-2.5">
            {GUIDE_STEPS.map((step, idx) => {
              const active = idx === stepIdx;
              return (
                <button
                  key={step.num}
                  type="button"
                  onClick={() => {
                    setStepIdx(idx);
                    setCopied(false);
                  }}
                  className={`text-left rounded-[16px] p-4 border transition-all ${
                    active
                      ? 'bg-[#242323] text-[#f7f5f2] border-[#242323] shadow-[0_14px_30px_-16px_rgba(36,35,35,0.55)]'
                      : 'bg-white/75 hover:bg-white/95 text-[#252423] border-white/85 shadow-sm'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center justify-center w-8 h-8 rounded-[9px] font-mono text-[12px] font-bold shrink-0 ${
                        active ? 'bg-white/15 text-[#c9e3cf]' : 'bg-[#ede9e3] text-[#3d614e]'
                      }`}
                    >
                      {step.num}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold leading-snug">{step.title}</p>
                      <p className={`text-[12px] mt-0.5 ${active ? 'text-[#c9c3bc]' : 'text-[#78716b]'}`}>
                        {step.short}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Step detail panel */}
          <div className="lg:col-span-8 rounded-[22px] bg-white/80 backdrop-blur-[20px] border border-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_20px_50px_-24px_rgba(37,36,35,0.18)] p-6 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2.5">
                <span className="px-2.5 py-1 rounded-[8px] bg-[#e2ebe4] text-[#2f5843] font-mono text-[12px] font-bold">
                  STEP {current.num}
                </span>
                <h3 className="text-[20px] font-bold text-[#252423]">{current.title}</h3>
              </div>
              <a
                href={current.entryHref}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[9px] bg-[#f4f0eb] hover:bg-[#e8e2da] border border-[#ddd5cc] text-[12.5px] font-medium text-[#252423] transition-colors"
              >
                {current.entryLabel}
                <ArrowUpRight className="w-3.5 h-3.5 text-[#3d614e]" />
              </a>
            </div>

            <p className="text-[14.5px] text-[#5d5956] leading-[1.72] mb-5">{current.summary}</p>

            <ul className="space-y-2.5 mb-6">
              {current.bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2.5 text-[13.5px] text-[#33302d] leading-relaxed">
                  <span className="w-5 h-5 rounded-full bg-[#e6efe9] text-[#3d614e] inline-flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3 h-3" />
                  </span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>

            {/* Code / Config block */}
            <div className="rounded-[14px] overflow-hidden border border-[#2f2d2a] bg-[#21201f] text-[#ede8e1] mb-5">
              <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.04] border-b border-white/10">
                <span className="inline-flex items-center gap-2 text-[12px] text-[#bdb6ae] font-medium">
                  <Terminal className="w-3.5 h-3.5 text-[#8ac8a3]" />
                  {current.codeTitle}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] bg-white/10 hover:bg-white/15 text-[11px] text-[#f2ede7] transition-colors"
                >
                  {copied ? <Check className="w-3 h-3 text-[#8ac8a3]" /> : <Copy className="w-3 h-3" />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <pre className="p-4 text-[12.5px] leading-[1.65] font-mono overflow-x-auto whitespace-pre-wrap">
                {current.code}
              </pre>
            </div>

            <div className="flex items-start gap-2.5 rounded-[12px] bg-[#f4f0ea] border border-[#e3dbd2] px-4 py-3 text-[12.5px] text-[#4f4a45]">
              <BookOpen className="w-4 h-4 text-[#3d614e] shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong className="text-[#252423]">实用提示：</strong>
                {current.tip}
              </p>
            </div>
          </div>
        </div>

        {/* Quick Reference Bar */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {QUICK_TIPS.map((item) => (
            <div
              key={item.title}
              className="rounded-[16px] bg-white/70 backdrop-blur-md border border-white/85 p-4 shadow-sm"
            >
              <div className="flex items-center gap-2 mb-2">
                <Keyboard className="w-3.5 h-3.5 text-[#3d614e]" aria-hidden="true" />
                <span className="px-2 py-0.5 rounded-[6px] bg-[#ede9e3] font-mono text-[11px] font-semibold text-[#252423]">
                  {item.key}
                </span>
              </div>
              <h4 className="text-[14px] font-bold text-[#252423] mb-1">{item.title}</h4>
              <p className="text-[12.5px] text-[#5d5956] leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
