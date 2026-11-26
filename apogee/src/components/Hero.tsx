import { type ReactNode, useState } from 'react';
import { ArrowRight, CheckCircle2, Cpu, Layers, Play, Sparkles } from 'lucide-react';
import Office3DStage, { type SceneDemoActorSpec } from '@/components/Office3DStage';
import { isPagesMode, REPO_URL, workspaceHref } from '@/lib/links';

const RHYTHM_BARS = [
  28, 42, 56, 38, 62, 74, 48, 82, 68, 90,
  76, 54, 86, 94, 72, 60, 84, 78, 64, 52,
];

const HERO_PHASES = [
  { id: 'morning', label: '清晨', time: '06:15', hour: 6.2 },
  { id: 'noon', label: '正午', time: '12:30', hour: 12.5 },
  { id: 'dusk', label: '黄昏', time: '17:30', hour: 17.5 },
  { id: 'night', label: '深夜', time: '22:30', hour: 22.5 },
] as const;

const HERO_ACTORS: SceneDemoActorSpec[] = [
  { key: 'human:boss', name: '老板 · lewis', kind: 'human', state: 'idle', avatarId: 'lead', fixedSeat: 'boss' },
  { key: 'system:reception', name: '前台', kind: 'system', state: 'idle', avatarId: 'coordinator', fixedSeat: 'reception' },
  { key: 'agent:lead', name: '研发负责人', kind: 'agent', state: 'speaking', avatarId: 'architect', seatIndex: 1, mode: 'meeting_room', sessionId: 'demo-meeting', order: 0 },
  { key: 'agent:design', name: '产品设计', kind: 'agent', state: 'listening', avatarId: 'designer', seatIndex: 0, mode: 'meeting_room', sessionId: 'demo-meeting', order: 1 },
  { key: 'agent:dev', name: '开发工程师', kind: 'agent', state: 'working', avatarId: 'engineer', seatIndex: 2 },
  { key: 'agent:qa', name: '测试工程师', kind: 'agent', state: 'idle', avatarId: 'analyst', seatIndex: 4 },
  { key: 'agent:ops', name: 'AI 运维', kind: 'agent', state: 'thinking', avatarId: 'specialist', seatIndex: 6 },
];

const HERO_RESTING = ['agent:qa'];

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

function OfficePreviewCard() {
  const maxBar = Math.max(...RHYTHM_BARS);
  const [phaseIdx, setPhaseIdx] = useState(1);
  const phase = HERO_PHASES[phaseIdx];

  return (
    <Animate delay={120} direction="scale" className="w-full max-w-[580px] mx-auto lg:mx-0">
      <div className="w-full rounded-[24px] bg-white/80 backdrop-blur-[20px] border border-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_24px_60px_-20px_rgba(45,39,31,0.18)] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2.5 mb-4">
          <div>
            <p className="symbio-serif text-[22px] leading-tight text-[#252423] tracking-[0.02em]">数字办公室</p>
            <p className="text-[12px] text-[#5d5956] mt-0.5">真实 Three.js 3D 沙盘 · 拖拽旋转 / 切换光影</p>
          </div>
          <div className="inline-flex items-center gap-1 p-1 rounded-[10px] bg-[#ede9e4] border border-[#dcd5cd]">
            {HERO_PHASES.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPhaseIdx(idx)}
                className={`px-2 py-0.5 rounded-[7px] text-[11px] font-medium transition-all ${
                  idx === phaseIdx
                    ? 'bg-[#242323] text-[#f7f5f2] shadow-sm'
                    : 'text-[#5d5956] hover:text-[#252423]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Real Three.js 3D Office Canvas */}
        <div className="relative rounded-[16px] overflow-hidden border border-[#d8cec2] mb-4">
          <Office3DStage
            actors={HERO_ACTORS}
            hour={phase.hour}
            workstationCount={12}
            restingKeys={HERO_RESTING}
            className="h-[260px] sm:h-[290px]"
          />
          <div className="pointer-events-none absolute top-2.5 right-2.5 px-2.5 py-1 rounded-[8px] bg-black/45 backdrop-blur-md text-[#f7f3ec] text-[11px] font-medium tabular-nums">
            {phase.label} · {phase.time}
          </div>
          <div className="pointer-events-none absolute bottom-2.5 left-2.5 px-2.5 py-1 rounded-[8px] bg-black/40 backdrop-blur-md text-[#f5f0e8] text-[10.5px]">
            左键拖拽旋转 · 滚轮缩放
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          <div className="rounded-[12px] bg-[#f5f2ee] border border-[#e3ddd7] px-3 py-2.5">
            <p className="text-[11px] text-[#5d5956]">协同成员</p>
            <p className="text-[18px] sm:text-[19px] font-semibold text-[#252423] leading-tight mt-1">真人 + AI</p>
          </div>
          <div className="rounded-[12px] bg-[#f5f2ee] border border-[#e3ddd7] px-3 py-2.5">
            <p className="text-[11px] text-[#5d5956]">交付闭环</p>
            <p className="text-[18px] sm:text-[19px] font-semibold text-[#3d614e] leading-tight mt-1">人工验收</p>
          </div>
          <div className="rounded-[12px] bg-[#f5f2ee] border border-[#e3ddd7] px-3 py-2.5">
            <p className="text-[11px] text-[#5d5956]">算力治理</p>
            <p className="text-[18px] sm:text-[19px] font-semibold text-[#252423] leading-tight mt-1">三级预算</p>
          </div>
        </div>

        {/* Collaboration rhythm chart */}
        <div className="rounded-[12px] bg-[#f5f2ee]/80 border border-[#e3ddd7] px-3.5 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-[#5d5956]">今日协同节拍</span>
            <span className="text-[11px] text-[#3d614e] font-medium">本地 SQLite · 零云端依赖</span>
          </div>
          <div className="flex items-end gap-[4px] h-[38px]" aria-hidden="true">
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
        </div>
      </div>
    </Animate>
  );
}

export default function Hero() {
  return (
    <section id="top" className="relative w-full pt-8 pb-16 sm:pt-12 sm:pb-20 lg:pt-16 lg:pb-24">
      <div className="w-full max-w-[1320px] mx-auto px-5 sm:px-8 lg:px-12 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
        <div className="lg:col-span-6 max-w-[590px]">
          <Animate delay={0} direction="up">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/75 border border-[#484239]/10 text-[12px] font-medium text-[#3d614e] mb-6 shadow-sm">
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              人机共生 · 本地优先的多 Agent 协同工作空间
            </span>
          </Animate>

          <Animate delay={40} direction="up">
            <h1 className="text-[#252423] text-[36px] sm:text-[48px] xl:text-[54px] font-bold leading-[1.16] tracking-[-0.025em] mb-5">
              让每一份人机协作，
              <br />
              都清晰可见、井然有序。
            </h1>
          </Animate>

          <Animate delay={80} direction="up">
            <p className="text-[#5d5956] text-[15px] sm:text-[17px] leading-[1.75] max-w-[515px] mb-8">
              Symbio 是运行在你本机的可视化多 Agent 公司管理台。把真人成员与 Codex、Pi 等 AI 智能体请进同一座 3D 数字办公室——支持从零画墙、铺地板、自由摆工位与功能区，统筹任务流转、会议讨论、文件验收与三级 Token 预算。
            </p>
          </Animate>

          <Animate delay={120} direction="up">
            <div className="flex flex-wrap items-center gap-3.5 mb-10">
              <a
                href={workspaceHref('#overview', '#guide')}
                className="inline-flex items-center gap-2 h-[48px] px-6 bg-[#242323] hover:bg-[#383634] rounded-[12px] text-[#f7f5f2] text-[15px] font-semibold transition-all shadow-[0_8px_20px_-8px_rgba(36,35,35,0.45)]"
              >
                {isPagesMode ? '本地快速部署' : '立即进入工作台'}
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </a>
              <a
                href="#demo"
                className="inline-flex items-center gap-2 h-[48px] px-5 bg-white/80 hover:bg-white rounded-[12px] border border-[#484239]/15 text-[#252423] text-[15px] font-medium transition-colors"
              >
                <Play className="w-3.5 h-3.5 text-[#3d614e]" aria-hidden="true" />
                体验交互演示
              </a>
              {isPagesMode && (
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 h-[48px] px-4 text-[#5d5956] hover:text-[#252423] text-[14px] font-medium transition-colors"
                >
                  GitHub 源码 →
                </a>
              )}
            </div>
          </Animate>

          <Animate delay={160} direction="up">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6 border-t border-[#484239]/12">
              <div className="flex items-start gap-2.5">
                <Layers className="w-4 h-4 text-[#3d614e] mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-[13px] font-semibold text-[#252423]">3D 自建空间</p>
                  <p className="text-[12px] text-[#5d5956] mt-0.5">画墙磁吸、多材质地板与光影</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Cpu className="w-4 h-4 text-[#3d614e] mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-[13px] font-semibold text-[#252423]">多运行器编排</p>
                  <p className="text-[12px] text-[#5d5956] mt-0.5">本机扫描与异机采集</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[#3d614e] mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-[13px] font-semibold text-[#252423]">人工验收闭环</p>
                  <p className="text-[12px] text-[#5d5956] mt-0.5">交付对比与预算防线</p>
                </div>
              </div>
            </div>
          </Animate>
        </div>

        <div className="lg:col-span-6 flex justify-center lg:justify-end">
          <OfficePreviewCard />
        </div>
      </div>
    </section>
  );
}
