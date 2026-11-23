import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, CheckCircle2, Cpu, Layers, Menu, Sparkles, X } from 'lucide-react';

const RHYTHM_BARS = [
  28, 42, 56, 38, 62, 74, 48, 82, 68, 90,
  76, 54, 86, 94, 72, 60, 84, 78, 64, 52,
];

const NAV_LINKS = [
  { label: '数字办公室', href: '/office#overview' },
  { label: '任务看板', href: '/office#tasks/all' },
  { label: '智能体团队', href: '/office#agents' },
  { label: '空间与工位', href: '/office#layout' },
];

function Animate({
  children, delay = 0, className = '', direction = 'up',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  direction?: 'up' | 'down' | 'scale';
}) {
  const directionClass = {
    up: 'animate-fade-up',
    down: 'animate-fade-down',
    scale: 'animate-fade-scale',
  }[direction];

  return (
    <div className={`opacity-0 ${directionClass} ${className}`} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function SymbioMark() {
  return (
    <span
      className="grid grid-cols-2 grid-rows-2 place-content-center gap-[3px] w-[30px] h-[30px] rounded-[9px] bg-[#222120] shrink-0"
      aria-hidden="true"
    >
      <i className="w-[7px] h-[7px] rounded-[2px] bg-[#ece7e3]" />
      <i className="w-[6px] h-[6px] rounded-[2px] bg-[#c1b8b0] self-center justify-self-center" />
      <i className="w-[6px] h-[6px] rounded-[2px] bg-[#c1b8b0] self-center justify-self-center" />
      <i className="w-[7px] h-[7px] rounded-[2px] bg-[#ece7e3]" />
    </span>
  );
}

function OfficePreviewCard() {
  const maxBar = Math.max(...RHYTHM_BARS);

  return (
    <Animate delay={120} direction="scale" className="w-full max-w-[540px] mx-auto lg:mx-0">
      <div className="w-full rounded-[24px] bg-white/80 backdrop-blur-[20px] border border-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_24px_60px_-20px_rgba(45,39,31,0.18)] p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <p className="symbio-serif text-[22px] leading-tight text-[#252423] tracking-[0.02em]">数字办公室</p>
            <p className="text-[12px] text-[#5d5956] mt-0.5">1F 协作空间 · 实时沙盘视图</p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] bg-[#e2e8e2] text-[#3d614e] text-[11px] font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3d614e]" />
            实时同步
          </span>
        </div>

        {/* Isometric architectural preview matching the 3D workbench aesthetic */}
        <div className="relative rounded-[16px] overflow-hidden border border-[#d8cec2] bg-[radial-gradient(ellipse_at_48%_38%,#f8efe2,#e9dccb_68%,#d4c0aa)] p-4 mb-4">
          <svg
            viewBox="0 0 460 215"
            className="w-full h-auto block"
            role="img"
            aria-label="Symbio 等距数字办公室示意图"
          >
            {/* Floor slab */}
            <polygon points="230,22 422,110 230,198 38,110" fill="#e6dccd" stroke="#8a745b" strokeWidth="1.5" />
            <polygon points="38,110 230,198 230,206 38,118" fill="#a28668" />
            <polygon points="422,110 230,198 230,206 422,118" fill="#82684e" />

            {/* Back left & right architectural walls */}
            <polygon points="230,22 38,110 38,72 230,-16" fill="#688089" opacity="0.92" />
            <polygon points="230,22 422,110 422,72 230,-16" fill="#7c9398" opacity="0.88" />
            <polygon points="230,22 332,68 230,115 128,68" fill="#d9d1c3" opacity="0.65" />

            {/* Glass partition */}
            <polygon points="274,64 358,102 358,76 274,38" fill="#9fb5b4" opacity="0.45" stroke="#53686f" strokeWidth="1" />

            {/* Desk cluster (warm wood tones) */}
            {[
              [158, 92],
              [216, 118],
              [114, 116],
              [172, 142],
            ].map(([x, y], idx) => (
              <g key={idx} transform={`translate(${x}, ${y})`}>
                <polygon points="0,0 38,17 18,27 -20,10" fill={idx % 2 === 0 ? '#c6a278' : '#b28960'} stroke="#7f6143" strokeWidth="0.8" />
                <polygon points="6,1 20,7 16,10 2,4" fill="#3a4549" />
              </g>
            ))}

            {/* Meeting table */}
            <g transform="translate(274, 128)">
              <polygon points="0,0 56,25 28,39 -28,14" fill="#a9805a" stroke="#78583c" strokeWidth="0.9" />
              <circle cx="-12" cy="18" r="4.5" fill="#4d535a" />
              <circle cx="16" cy="31" r="4.5" fill="#4d535a" />
              <circle cx="36" cy="16" r="4.5" fill="#4d535a" />
              <circle cx="10" cy="4" r="4.5" fill="#4d535a" />
            </g>

            {/* Server racks in AI zone */}
            <g transform="translate(328, 86)">
              <polygon points="0,0 16,7 16,-15 0,-22" fill="#333a3c" />
              <polygon points="16,7 26,2 26,-20 16,-15" fill="#4c5659" />
              <circle cx="7" cy="-12" r="1.4" fill="#7ec9a2" />
              <circle cx="7" cy="-6" r="1.4" fill="#7ec9a2" />
            </g>

            {/* Plants */}
            <circle cx="88" cy="112" r="9" fill="#516b46" />
            <circle cx="94" cy="107" r="6" fill="#71845a" />
            <circle cx="358" cy="118" r="8" fill="#516b46" />
            <circle cx="364" cy="113" r="5" fill="#71845a" />
          </svg>

          {/* Floating frosted role pills */}
          <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] bg-[#fdf9f2]/95 border border-[#5f4f3b]/15 shadow-sm text-[11px] text-[#252423] font-medium">
            <span className="w-2 h-2 rounded-full bg-[#3d614e]" />
            研发负责人 · 拆解需求
          </div>
          <div className="absolute bottom-3 left-4 flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] bg-[#fdf9f2]/95 border border-[#5f4f3b]/15 shadow-sm text-[11px] text-[#252423] font-medium">
            <span className="w-2 h-2 rounded-full bg-[#3e849e]" />
            开发工程师 · 编写交付
          </div>
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] bg-[#fdf9f2]/95 border border-[#5f4f3b]/15 shadow-sm text-[11px] text-[#252423] font-medium">
            <span className="w-2 h-2 rounded-full bg-[#7761a4]" />
            评审会议室 · 同步验收
          </div>
        </div>

        {/* Summary KPI strip */}
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          <div className="rounded-[12px] bg-[#f5f2ee] border border-[#e3ddd7] px-3 py-2.5">
            <p className="text-[11px] text-[#5d5956]">协同成员</p>
            <p className="text-[20px] font-semibold text-[#252423] leading-tight mt-1 tabular-nums">真人 + AI</p>
          </div>
          <div className="rounded-[12px] bg-[#f5f2ee] border border-[#e3ddd7] px-3 py-2.5">
            <p className="text-[11px] text-[#5d5956]">交付闭环</p>
            <p className="text-[20px] font-semibold text-[#3d614e] leading-tight mt-1">人工验收</p>
          </div>
          <div className="rounded-[12px] bg-[#f5f2ee] border border-[#e3ddd7] px-3 py-2.5">
            <p className="text-[11px] text-[#5d5956]">算力治理</p>
            <p className="text-[20px] font-semibold text-[#252423] leading-tight mt-1">Token 预算</p>
          </div>
        </div>

        {/* Collaboration rhythm chart */}
        <div className="rounded-[12px] bg-[#f5f2ee]/80 border border-[#e3ddd7] px-3.5 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-[#5d5956]">今日协同节拍</span>
            <span className="text-[11px] text-[#3d614e] font-medium">多运行器稳定在线</span>
          </div>
          <div className="flex items-end gap-[4px] h-[44px]" aria-hidden="true">
            {RHYTHM_BARS.map((height, index) => {
              const isRecent = index >= 16;
              return (
                <div
                  key={index}
                  className="flex-1 rounded-[2px] opacity-0 animate-bar-grow origin-bottom"
                  style={{
                    height: `${(height / maxBar) * 100}%`,
                    backgroundColor: isRecent ? '#3d614e' : '#bfb8b0',
                    animationDelay: `${180 + index * 18}ms`,
                  }}
                />
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-[#7a746e] tabular-nums">
            <span>09:00</span>
            <span>11:00</span>
            <span>13:00</span>
            <span>15:00</span>
            <span>17:00</span>
          </div>
        </div>
      </div>
    </Animate>
  );
}

export default function Hero() {
  return (
    <section className="relative w-full min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 flex items-center py-10 sm:py-14">
        <div className="w-full max-w-[1320px] mx-auto px-5 sm:px-8 lg:px-12 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          <div className="lg:col-span-6 max-w-[580px]">
            <Animate delay={0} direction="up">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/75 border border-[#484239]/10 text-[12px] font-medium text-[#3d614e] mb-6 shadow-sm">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                人机共生 · 本机多智能体协同工作空间
              </span>
            </Animate>

            <Animate delay={40} direction="up">
              <h1 className="text-[#252423] text-[36px] sm:text-[48px] xl:text-[56px] font-bold leading-[1.15] tracking-[-0.025em] mb-5">
                让每一份人机协作，
                <br />
                都清晰可见。
              </h1>
            </Animate>

            <Animate delay={80} direction="up">
              <p className="text-[#5d5956] text-[15px] sm:text-[17px] leading-[1.7] max-w-[490px] mb-8">
                在温暖直观的数字办公室里管理真人成员与 AI 智能体团队——实时洞察工位动态、调度多运行器任务、把控文件交付与 Token 预算。
              </p>
            </Animate>

            <Animate delay={120} direction="up">
              <div className="flex flex-wrap items-center gap-3.5 mb-10">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 h-[48px] px-6 bg-[#242323] hover:bg-[#383634] rounded-[12px] text-[#f7f5f2] text-[15px] font-semibold transition-all shadow-[0_8px_20px_-8px_rgba(36,35,35,0.45)]"
                  onClick={() => window.location.assign('/office#overview')}
                >
                  进入数字办公室
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 h-[48px] px-6 bg-white/80 hover:bg-white rounded-[12px] border border-[#484239]/15 text-[#252423] text-[15px] font-medium transition-colors"
                  onClick={() => window.location.assign('/office#tasks/all')}
                >
                  查看任务看板
                </button>
              </div>
            </Animate>

            <Animate delay={160} direction="up">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-6 border-t border-[#484239]/12">
                <div className="flex items-start gap-2.5">
                  <Layers className="w-4 h-4 text-[#3d614e] mt-0.5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-[13px] font-semibold text-[#252423]">3D 空间沙盘</p>
                    <p className="text-[12px] text-[#5d5956] mt-0.5">实时工位与在岗状态</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Cpu className="w-4 h-4 text-[#3d614e] mt-0.5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-[13px] font-semibold text-[#252423]">多运行器编排</p>
                    <p className="text-[12px] text-[#5d5956] mt-0.5">Codex / Pi / 异机采集</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#3d614e] mt-0.5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-[13px] font-semibold text-[#252423]">人工验收闭环</p>
                    <p className="text-[12px] text-[#5d5956] mt-0.5">交付审阅与预算管控</p>
                  </div>
                </div>
              </div>
            </Animate>
          </div>

          <div className="lg:col-span-6 flex lg:justify-end">
            <OfficePreviewCard />
          </div>
        </div>
      </main>
    </section>
  );
}

function Nav() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = '';
      desktop.removeEventListener('change', closeOnDesktop);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  return (
    <>
      <nav
        className="w-full max-w-[1320px] mx-auto px-5 sm:px-8 lg:px-12 pt-5 sm:pt-7 flex items-center justify-between relative z-50"
        aria-label="主导航"
      >
        <Animate delay={0} direction="down">
          <a href="/office" className="inline-flex items-center gap-2.5 no-underline text-[#252423]">
            <SymbioMark />
            <span className="text-[24px] font-semibold leading-none tracking-[-0.02em]">Symbio</span>
          </a>
        </Animate>

        <Animate delay={80} direction="down" className="hidden lg:block">
          <div className="h-[46px] px-2 flex items-center gap-1 bg-white/65 border border-white/80 rounded-[12px] backdrop-blur-[16px] shadow-[0_6px_20px_-10px_rgba(37,36,35,0.12)]">
            {NAV_LINKS.map(item => (
              <button
                key={item.label}
                type="button"
                className="px-4 h-[34px] rounded-[8px] text-[#5d5956] hover:text-[#252423] hover:bg-white/75 text-[13px] font-medium transition-colors"
                onClick={() => window.location.assign(item.href)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </Animate>

        <Animate delay={140} direction="down" className="hidden lg:block">
          <div className="h-[46px] p-1 bg-white/65 border border-white/80 rounded-[12px] backdrop-blur-[16px] flex items-center gap-1 shadow-[0_6px_20px_-10px_rgba(37,36,35,0.12)]">
            <button
              type="button"
              className="h-[36px] px-4 rounded-[9px] text-[#252423] text-[13px] font-medium hover:bg-white/80 transition-colors"
              onClick={() => window.location.assign('/office')}
            >
              登录
            </button>
            <button
              type="button"
              className="h-[36px] px-4 bg-[#242323] hover:bg-[#383634] rounded-[9px] text-[#f7f5f2] text-[13px] font-semibold transition-colors"
              onClick={() => window.location.assign('/office#overview')}
            >
              进入工作台
            </button>
          </div>
        </Animate>

        <Animate delay={80} direction="down" className="lg:hidden">
          <button
            type="button"
            className="w-[42px] h-[42px] flex items-center justify-center rounded-[11px] bg-white/75 border border-white/90 backdrop-blur-[16px] text-[#252423]"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="切换导航菜单"
            aria-expanded={isOpen}
            aria-controls="mobile-menu"
          >
            {isOpen ? <X className="w-5 h-5" aria-hidden="true" /> : <Menu className="w-5 h-5" aria-hidden="true" />}
          </button>
        </Animate>
      </nav>

      <div
        id="mobile-menu"
        className={`lg:hidden fixed inset-0 z-40 transition-all duration-300 ${isOpen ? 'visible' : 'invisible'}`}
        aria-hidden={!isOpen}
      >
        <div
          className={`absolute inset-0 bg-[#252423]/25 backdrop-blur-[12px] transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setIsOpen(false)}
        />
        <div
          className={`absolute top-[74px] left-4 right-4 bg-[#fbf9f4]/95 backdrop-blur-[24px] rounded-[18px] border border-white/80 shadow-xl p-5 transition-all duration-300 origin-top ${isOpen ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-3 scale-[0.98]'}`}
        >
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map(item => (
              <button
                key={item.label}
                type="button"
                className="text-left px-3.5 py-3 rounded-[10px] text-[#252423] text-[15px] font-medium hover:bg-black/[0.04]"
                onClick={() => {
                  setIsOpen(false);
                  window.location.assign(item.href);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="h-px bg-[#484239]/10 my-4" />
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              className="w-full h-[44px] bg-[#242323] rounded-[10px] text-[#f7f5f2] text-[14px] font-semibold"
              onClick={() => window.location.assign('/office#overview')}
            >
              进入数字办公室
            </button>
            <button
              type="button"
              className="w-full h-[44px] rounded-[10px] border border-[#484239]/15 bg-white/80 text-[#252423] text-[14px] font-medium"
              onClick={() => window.location.assign('/office')}
            >
              登录工作台
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
