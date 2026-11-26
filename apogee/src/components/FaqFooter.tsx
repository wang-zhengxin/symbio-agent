import { useState } from 'react';
import { ArrowRight, ChevronDown, HelpCircle } from 'lucide-react';
import { SymbioMark } from '@/components/Navbar';
import { isPagesMode, REPO_URL, workspaceHref } from '@/lib/links';

const FAQS = [
  {
    q: 'Symbio 的数据保存在哪里？需要把公司资料上传到云端吗？',
    a: '不需要。Symbio 是本地优先的架构，所有项目、任务、员工档案、工位布局与审计记录全部保存在本机的 SQLite 数据库（data/office.sqlite）和本地项目工作区目录中，默认仅监听 127.0.0.1 本机地址。',
  },
  {
    q: '「发现与接入」中的运行器接入，和「智能体」里的员工创建有什么区别？',
    a: '接入运行器只是将本机或远程主机上可用的 Agent 引擎加入公司的资源池，不会自动占用 3D 工位或授予执行权限；创建智能体时你可以自由绑定任意已接入的运行器，并分别配置人格、岗位、小队、Skills、MCP 工具和文件沙箱权限。',
  },
  {
    q: '目前支持哪些 Agent 运行器？未适配的运行器能用来做什么？',
    a: '本机扫描支持识别 Codex、Pi、Claude Code、Gemini CLI、OpenCode、Cursor Agent、Aider、WorkBuddy、Antigravity 等常见运行器。其中已适配执行接口的运行器（如 Codex、Pi）可直接接受平台任务派发与多人会议发言；其余运行器接入后以「仅观察模式」纳入统一资产与在线状态盘点。',
  },
  {
    q: '如何避免 Agent 修改不该动的文件或消耗过多 Token？',
    a: 'Symbio 提供三层防线：① 权限隔离：默认只读沙箱，人事/财务岗位强制只读，文件写入需管理员显式授权，交付物须经人工三方对比验收后才能发布；② 三级预算：可对公司、小队、员工分别设定 Token 上限并在启动前预留额度；③ 随时熔断：执行中可实时查看工具调用并一键停止。',
  },
  {
    q: '可以自己从零绘制 3D 办公室户型和摆放家具吗？',
    a: '完全可以。进入「空间与工位 → 自由布置」，既可在默认户型上扩建工位与增设隔墙家具，也可切换至「从零自建空间」（24×20m 网格）：先绘制正交墙与 1.4m 门洞（靠近墙角与墙面自动磁吸无缝闭合），再拖拽铺设 4 种材质地板或一键「按墙体外框铺满地板」，最后放置工位桌椅、老板桌、前台、会议/休息长桌与办公摆件，保存后自动启用 A* 穿门寻路。',
  },
  {
    q: '工位数量不够怎么办？3D 空间里的员工为什么会去休息区？',
    a: '工作区容量严格对应 3D 场景中的实体办公桌数量。你可以在「工位管理」扩建东侧工位，或在「自由布置」中随时增放 D-01.. 自定义工位桌椅。空闲员工拥有各自独立的随机计时，会错峰前往休闲区或休息长桌小憩几分钟，收到新任务或会议邀请时会立刻返回工作状态。',
  },
];

export default function FaqFooter() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <>
      <section id="faq" className="w-full py-16 sm:py-22">
        <div className="w-full max-w-[1000px] mx-auto px-5 sm:px-8 lg:px-12">
          <div className="text-center max-w-[600px] mx-auto mb-10">
            <p className="text-[12px] font-semibold tracking-[0.12em] uppercase text-[#3d614e] mb-2.5">
              FAQ · 常见问题
            </p>
            <h2 className="text-[28px] sm:text-[34px] font-bold tracking-[-0.02em] text-[#252423]">
              开始使用前你可能关心的问题
            </h2>
          </div>

          <div className="space-y-3">
            {FAQS.map((item, index) => {
              const isOpen = openIndex === index;
              return (
                <div
                  key={item.q}
                  className="rounded-[16px] bg-white/78 backdrop-blur-[16px] border border-white/90 shadow-sm overflow-hidden transition-colors"
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                    className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
                  >
                    <span className="text-[15px] font-semibold text-[#252423] leading-snug">{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-[#78716b] shrink-0 transition-transform duration-200 ${
                        isOpen ? 'rotate-180 text-[#252423]' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-4 pt-0 text-[13.5px] text-[#5d5956] leading-[1.75] border-t border-[#484239]/8">
                      <p className="pt-3">{item.a}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Closing CTA Banner */}
      <section className="w-full pb-16 sm:pb-20">
        <div className="w-full max-w-[1320px] mx-auto px-5 sm:px-8 lg:px-12">
          <div className="rounded-[24px] bg-[#242323] text-[#f7f5f2] p-8 sm:p-11 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 shadow-[0_24px_60px_-24px_rgba(25,24,23,0.45)]">
            <div className="max-w-[620px]">
              <p className="text-[12px] font-semibold tracking-[0.12em] uppercase text-[#a5ccb4] mb-2">
                READY TO COLLABORATE
              </p>
              <h2 className="text-[26px] sm:text-[34px] font-bold tracking-[-0.02em] leading-[1.24]">
                现在就走进你的 3D 人机协同办公室
              </h2>
              <p className="text-[14.5px] text-[#c7c1ba] leading-[1.7] mt-2.5">
                {isPagesMode
                  ? '克隆仓库并执行 npm install && npm start，5 分钟内即可在你的本机启动完整 3D 数字办公室与多 Agent 协作工作台。'
                  : '本机服务已就绪。点击下方按钮直接进入实时数字办公室、查看任务看板或接入你的第一个 AI 运行器。'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <a
                href={isPagesMode ? REPO_URL : workspaceHref('#overview')}
                target={isPagesMode ? '_blank' : undefined}
                rel={isPagesMode ? 'noreferrer' : undefined}
                className="inline-flex items-center gap-2 h-[46px] px-6 rounded-[12px] bg-[#f7f5f2] hover:bg-white text-[#242323] text-[14.5px] font-semibold transition-colors"
              >
                {isPagesMode ? '前往 GitHub 获取源码' : '进入数字办公室'}
                <ArrowRight className="w-4 h-4" />
              </a>
              <a
                href={isPagesMode ? '#guide' : workspaceHref('#help')}
                className="inline-flex items-center gap-1.5 h-[46px] px-5 rounded-[12px] bg-white/10 hover:bg-white/15 border border-white/15 text-[#f7f5f2] text-[14px] font-medium transition-colors"
              >
                <HelpCircle className="w-4 h-4" />
                {isPagesMode ? '查看部署指南' : '工作台帮助中心'}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full border-t border-[#484239]/12 py-8">
        <div className="w-full max-w-[1320px] mx-auto px-5 sm:px-8 lg:px-12 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-[13px] text-[#5d5956]">
          <div className="flex items-center gap-2.5">
            <SymbioMark />
            <span>
              <strong className="text-[#252423] font-semibold">Symbio</strong> · 人机共生协同工作空间（本地优先）
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            {isPagesMode ? (
              <>
                <a href="#features" className="hover:text-[#252423] transition-colors">产品亮点</a>
                <a href="#demo" className="hover:text-[#252423] transition-colors">3D 交互演示</a>
                <a href="#guide" className="hover:text-[#252423] transition-colors">使用说明</a>
                <a href="#faq" className="hover:text-[#252423] transition-colors">常见问题</a>
                <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-[#252423] transition-colors">GitHub</a>
              </>
            ) : (
              <>
                <a href="/office#overview" className="hover:text-[#252423] transition-colors">办公室</a>
                <a href="/office#tasks/all" className="hover:text-[#252423] transition-colors">任务看板</a>
                <a href="/office#agents" className="hover:text-[#252423] transition-colors">智能体</a>
                <a href="/office#discovery" className="hover:text-[#252423] transition-colors">发现与接入</a>
                <a href="/office#layout" className="hover:text-[#252423] transition-colors">空间与工位</a>
                <a href="/office#finance" className="hover:text-[#252423] transition-colors">统计与预算</a>
              </>
            )}
          </div>
        </div>
      </footer>
    </>
  );
}
