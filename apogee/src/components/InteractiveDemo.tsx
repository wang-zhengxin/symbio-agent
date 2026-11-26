import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Coffee,
  Cpu,
  KanbanSquare,
  Play,
  Plus,
  Radar,
  RotateCcw,
  Shield,
  Sparkles,
  Sun,
} from 'lucide-react';
import Office3DStage, { type SceneDemoActorSpec } from '@/components/Office3DStage';

type DemoTab = 'office' | 'board' | 'discovery';

interface DemoActorMeta {
  key: string;
  name: string;
  role: string;
  seat: string;
  team: string;
  runtime: string;
  status: 'working' | 'meeting' | 'lounge' | 'online';
  statusText: string;
  task: string;
  tokens: string;
}

const DEMO_SCENE_ACTORS: SceneDemoActorSpec[] = [
  { key: 'human:boss', name: '老板 · lewis', kind: 'human', state: 'idle', avatarId: 'lead', fixedSeat: 'boss' },
  { key: 'system:reception', name: '前台', kind: 'system', state: 'idle', avatarId: 'coordinator', fixedSeat: 'reception' },
  { key: 'agent:lead', name: '研发负责人', kind: 'agent', state: 'speaking', avatarId: 'architect', seatIndex: 1, mode: 'meeting_room', sessionId: 'demo-room', order: 0 },
  { key: 'agent:design', name: '产品设计', kind: 'agent', state: 'listening', avatarId: 'designer', seatIndex: 0, mode: 'meeting_room', sessionId: 'demo-room', order: 1 },
  { key: 'agent:dev', name: '开发工程师', kind: 'agent', state: 'working', avatarId: 'engineer', seatIndex: 2 },
  { key: 'agent:qa', name: '测试工程师', kind: 'agent', state: 'idle', avatarId: 'analyst', seatIndex: 4 },
  { key: 'agent:ops', name: 'AI 运维助手', kind: 'agent', state: 'thinking', avatarId: 'specialist', seatIndex: 6 },
];

const LIGHT_MODES = [
  { id: 'morning', label: '清晨 06:15', hour: 6.2 },
  { id: 'noon', label: '正午 12:30', hour: 12.5 },
  { id: 'dusk', label: '黄昏 17:30', hour: 17.5 },
  { id: 'night', label: '深夜 22:30', hour: 22.5 },
] as const;

const CUSTOM_DEMO_WALLS = [
  { id: 'cw-n', x1: -7.5, z1: -5.5, x2: 7.5, z2: -5.5, color: 'sage', doors: [] },
  { id: 'cw-s', x1: -7.5, z1: 5.5, x2: 7.5, z2: 5.5, color: 'sage', doors: [] },
  { id: 'cw-w', x1: -7.5, z1: -5.5, x2: -7.5, z2: 5.5, color: 'sage', doors: [] },
  { id: 'cw-e', x1: 7.5, z1: -5.5, x2: 7.5, z2: 5.5, color: 'sage', doors: [] },
  { id: 'cw-mid', x1: 0, z1: -5.5, x2: 0, z2: 5.5, color: 'warm', doors: [5.5] },
];

const CUSTOM_DEMO_FLOORS = [
  { id: 'cf-w', x1: -7.5, z1: -5.5, x2: 0, z2: 5.5, material: 'wood' },
  { id: 'cf-e', x1: 0, z1: -5.5, x2: 7.5, z2: 5.5, material: 'carpet' },
];

const CUSTOM_DEMO_RUGS = [
  { id: 'cr-1', x1: 1.5, z1: 1.0, x2: 6.5, z2: 4.5, color: 'sage' },
];

const CUSTOM_DEMO_ITEMS = [
  { id: 'ci-boss', type: 'boss_desk', x: -4.5, z: -3.0, rotation: 0 },
  { id: 'ci-d1', type: 'desk', x: -5.0, z: 1.5, rotation: 0, seatIndex: 100 },
  { id: 'ci-d2', type: 'desk', x: -2.0, z: 1.5, rotation: 0, seatIndex: 101 },
  { id: 'ci-d3', type: 'desk', x: -2.0, z: -2.5, rotation: 0, seatIndex: 102 },
  { id: 'ci-rec', type: 'reception', x: -4.5, z: 4.0, rotation: 180 },
  { id: 'ci-meet', type: 'meeting_table', x: 4.0, z: -2.5, rotation: 0 },
  { id: 'ci-break', type: 'break_table', x: 4.0, z: 2.8, rotation: 0 },
  { id: 'ci-plant', type: 'plant', x: -6.5, z: -4.5, rotation: 0 },
  { id: 'ci-coffee', type: 'coffee_station', x: 6.2, z: 0.2, rotation: 270 },
];

type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done';

interface DemoTask {
  id: string;
  key: string;
  title: string;
  assignee: string;
  status: TaskStatus;
  label: string;
  tokens: number;
  deliverable?: string;
}

const INITIAL_TASKS: DemoTask[] = [
  {
    id: 't1',
    key: 'AG-12',
    title: '补充小队、标签与 MCP 删除接口',
    assignee: '开发工程师',
    status: 'todo',
    label: '后端',
    tokens: 0,
    deliverable: 'src/office.js, src/settings.js',
  },
  {
    id: 't2',
    key: 'AG-13',
    title: '核对 3D 会议室与长桌休息区动线',
    assignee: '测试工程师',
    status: 'review',
    label: '验收',
    tokens: 12450,
    deliverable: 'test/overview.test.js (+6 用例)',
  },
  {
    id: 't3',
    key: 'AG-14',
    title: '汇总本周多运行器 Token 消耗明细',
    assignee: '财务',
    status: 'done',
    label: '统计',
    tokens: 6820,
    deliverable: 'weekly-budget-report.md',
  },
];

interface DemoRunner {
  id: string;
  name: string;
  source: string;
  adapter: 'ready' | 'observed';
  connected: boolean;
  boundAgents: number;
}

const INITIAL_RUNNERS: DemoRunner[] = [
  { id: 'codex', name: 'Codex', source: '本机', adapter: 'ready', connected: true, boundAgents: 3 },
  { id: 'pi', name: 'Pi', source: '本机', adapter: 'ready', connected: true, boundAgents: 2 },
  { id: 'claude', name: 'Claude Code', source: '本机', adapter: 'observed', connected: false, boundAgents: 0 },
  { id: 'gemini', name: 'Gemini CLI', source: '远程主机 · Mac-Studio', adapter: 'observed', connected: false, boundAgents: 0 },
];

export default function InteractiveDemo() {
  const [activeTab, setActiveTab] = useState<DemoTab>('office');

  // Office Demo State
  const [spaceMode, setSpaceMode] = useState<'default' | 'custom'>('default');
  const [lightIndex, setLightIndex] = useState(1);
  const [qaResting, setQaResting] = useState(true);
  const [selectedActorKey, setSelectedActorKey] = useState<string>('agent:dev');
  const [workstations, setWorkstations] = useState(12);
  const light = LIGHT_MODES[lightIndex];

  const actorMetas = useMemo<DemoActorMeta[]>(
    () => [
      {
        key: 'human:boss',
        name: '老板 · lewis',
        role: '工作空间管理员',
        seat: '独立办公室',
        team: '管理层',
        runtime: '真人成员',
        status: 'online',
        statusText: '在线指挥',
        task: '审阅 Q4 自动化发布方案',
        tokens: '—',
      },
      {
        key: 'system:reception',
        name: '前台',
        role: '固定前台接待',
        seat: '1F 前台席位',
        team: '行政协作',
        runtime: '系统角色',
        status: 'online',
        statusText: '接待中',
        task: '引导来访与状态总览',
        tokens: '—',
      },
      {
        key: 'agent:lead',
        name: '研发负责人',
        role: '项目负责人 (lead)',
        seat: 'W-02 · 研发协作区',
        team: '产品研发',
        runtime: 'Codex · 已授权',
        status: 'meeting',
        statusText: '评审会议室发言中',
        task: 'AG-12 拆解接口验收标准',
        tokens: '14,280 Token',
      },
      {
        key: 'agent:design',
        name: '产品设计',
        role: '执行员工 (worker)',
        seat: 'W-01 · 研发协作区',
        team: '产品研发',
        runtime: 'Pi · read-only',
        status: 'meeting',
        statusText: '评审会议室聆听中',
        task: '评审 3D 光影与交互细节',
        tokens: '7,860 Token',
      },
      {
        key: 'agent:dev',
        name: '开发工程师',
        role: '执行员工 (worker)',
        seat: 'W-03 · 研发协作区',
        team: '产品研发',
        runtime: 'Codex · workspace-write',
        status: 'working',
        statusText: '编写交付文件中',
        task: 'AG-14 实现 24h 光影与删除接口',
        tokens: '38,640 Token',
      },
      {
        key: 'agent:qa',
        name: '测试工程师',
        role: '执行员工 (worker)',
        seat: 'W-05 · 研发协作区',
        team: '质量保障',
        runtime: 'Pi · read-only',
        status: qaResting ? 'lounge' : 'online',
        statusText: qaResting ? '休息区长桌 · 独立错峰休整' : '已步行回到工位待命',
        task: qaResting ? '空闲中（预计数分钟后返回工位）' : '等待下一项测试验证任务',
        tokens: '9,120 Token',
      },
      {
        key: 'agent:ops',
        name: 'AI 运维助手',
        role: '执行员工 (worker)',
        seat: 'W-07 · AI 运行区',
        team: '基础设施',
        runtime: 'Codex · 已授权',
        status: 'working',
        statusText: '等待模型响应中',
        task: 'AG-15 巡检远程采集节点健康度',
        tokens: '19,450 Token',
      },
    ],
    [qaResting],
  );

  const selectedActor = actorMetas.find((a) => a.key === selectedActorKey) ?? actorMetas[4];
  const restingKeys = useMemo(() => (qaResting ? ['agent:qa'] : []), [qaResting]);

  // Board Demo State
  const [tasks, setTasks] = useState<DemoTask[]>(INITIAL_TASKS);
  const [runLog, setRunLog] = useState<string[]>([
    '就绪：点击任意「待办」任务的「派发执行」，或「审核中」任务的「验收发布」体验完整工作流。',
  ]);
  const [simulatingId, setSimulatingId] = useState<string | null>(null);
  const timersRef = useRef<number[]>([]);

  // Discovery Demo State
  const [runners, setRunners] = useState<DemoRunner[]>(INITIAL_RUNNERS);
  const [scanning, setScanning] = useState(false);
  const [allowExec, setAllowExec] = useState(true);
  const [writeSandbox, setWriteSandbox] = useState(true);
  const [mcpEnabled, setMcpEnabled] = useState(true);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  const dispatchTask = (taskId: string) => {
    if (simulatingId) return;
    const target = tasks.find((t) => t.id === taskId);
    if (!target || target.status !== 'todo') return;
    setSimulatingId(taskId);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: 'in_progress' } : t)));
    setRunLog([
      `[00:00] 预留 10,000 Token 额度，派发 ${target.key} 给「${target.assignee}」…`,
      '[00:01] 挂载工作区快照与已授权 SKILL.md 正文…',
    ]);
    const t1 = window.setTimeout(() => {
      setRunLog((prev) => [...prev, `[00:02] 运行器写入交付文件：${target.deliverable}`]);
    }, 650);
    const t2 = window.setTimeout(() => {
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: 'review', tokens: 8420 } : t)),
      );
      setRunLog((prev) => [
        ...prev,
        '[00:03] 执行完成并上报用量 8,420 Token → 已进入待人工验收队列！',
      ]);
      setSimulatingId(null);
    }, 1350);
    timersRef.current.push(t1, t2);
  };

  const approveTask = (taskId: string) => {
    const target = tasks.find((t) => t.id === taskId);
    if (!target || target.status !== 'review') return;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: 'done' } : t)));
    setRunLog((prev) => [
      ...prev.slice(-3),
      `[验收发布] ${target.key} 已通过人工审阅，交付文件（${target.deliverable}）已发布至项目公共工作区。`,
    ]);
  };

  const resetBoard = () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
    setSimulatingId(null);
    setTasks(INITIAL_TASKS);
    setRunLog(['演示已重置：点击「派发执行」或「验收发布」可再次体验。']);
  };

  const runScan = () => {
    setScanning(true);
    const id = window.setTimeout(() => setScanning(false), 650);
    timersRef.current.push(id);
  };

  const toggleConnectRunner = (runnerId: string) => {
    setRunners((prev) =>
      prev.map((runner) =>
        runner.id === runnerId ? { ...runner, connected: !runner.connected } : runner,
      ),
    );
  };

  const statusColor = (status: DemoActorMeta['status']) =>
    ({
      online: 'bg-[#3d614e]',
      working: 'bg-[#238064]',
      meeting: 'bg-[#7761a4]',
      lounge: 'bg-[#c6894b]',
    })[status];

  return (
    <section id="demo" className="w-full py-16 sm:py-22">
      <div className="w-full max-w-[1320px] mx-auto px-5 sm:px-8 lg:px-12">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8">
          <div className="max-w-[640px]">
            <p className="text-[12px] font-semibold tracking-[0.12em] uppercase text-[#3d614e] mb-2.5">
              INTERACTIVE DEMO · 在线交互演示
            </p>
            <h2 className="text-[28px] sm:text-[36px] font-bold tracking-[-0.02em] text-[#252423] leading-[1.22]">
              无需配置，先在这里动手体验核心场景
            </h2>
            <p className="text-[15px] text-[#5d5956] leading-[1.7] mt-2.5">
              切换下方三个标签，体验真实 Three.js 3D 办公室（含默认户型与从零自建样板间切换）、多 Agent 任务流转验收，以及运行器发现与权限授权隔离。
            </p>
          </div>

          <div
            className="inline-flex flex-wrap gap-1.5 p-1.5 rounded-[14px] bg-white/75 backdrop-blur-md border border-white/85 shadow-sm self-start lg:self-auto"
            role="tablist"
            aria-label="交互演示场景切换"
          >
            {[
              { id: 'office' as const, label: '3D 办公室与光影', icon: Building2 },
              { id: 'board' as const, label: '任务派发与验收', icon: KanbanSquare },
              { id: 'discovery' as const, label: '运行器接入与授权', icon: Radar },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-[13px] font-medium transition-all ${
                    active
                      ? 'bg-[#242323] text-[#f7f5f2] shadow-sm'
                      : 'text-[#5d5956] hover:text-[#252423] hover:bg-black/[0.04]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Demo Stage Container */}
        <div className="rounded-[24px] bg-white/80 backdrop-blur-[20px] border border-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_24px_60px_-24px_rgba(37,36,35,0.2)] p-5 sm:p-7">
          {activeTab === 'office' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-8 flex flex-col">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-[#252423]">
                    <Sun className="w-4 h-4 text-[#3d614e]" />
                    <span>
                      {spaceMode === 'custom'
                        ? '从零自建 3D 样板间（磁吸无缝墙体 · 暖橡木 + 地毯 · 1.4m 门洞）'
                        : `1F 实时 3D 沙盘（当前 ${workstations} 个实体工位${workstations > 12 ? ` · 含扩建翼 +${workstations - 12} 席` : ''}）`}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="inline-flex items-center p-0.5 rounded-[9px] bg-[#ede9e3] border border-[#dcd4cb] mr-1">
                      <button
                        type="button"
                        onClick={() => setSpaceMode('default')}
                        className={`px-2 py-0.5 rounded-[7px] text-[11px] font-medium transition-all ${
                          spaceMode === 'default'
                            ? 'bg-[#242323] text-[#f7f5f2]'
                            : 'text-[#5d5956] hover:text-[#252423]'
                        }`}
                      >
                        默认户型
                      </button>
                      <button
                        type="button"
                        onClick={() => setSpaceMode('custom')}
                        className={`px-2 py-0.5 rounded-[7px] text-[11px] font-medium transition-all ${
                          spaceMode === 'custom'
                            ? 'bg-[#242323] text-[#f7f5f2]'
                            : 'text-[#5d5956] hover:text-[#252423]'
                        }`}
                      >
                        从零自建样板
                      </button>
                    </div>
                    {LIGHT_MODES.map((item, idx) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setLightIndex(idx)}
                        className={`px-2.5 py-1 rounded-[8px] text-[11.5px] font-medium border transition-all ${
                          idx === lightIndex
                            ? 'bg-[#242323] text-[#f7f5f2] border-[#242323]'
                            : 'bg-[#f4f0eb] text-[#5d5956] border-[#e2dad1] hover:text-[#252423]'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Real Three.js 3D Interactive Canvas */}
                <div className="relative flex-1 rounded-[18px] border border-[#d6ccc0] overflow-hidden">
                  <Office3DStage
                    actors={DEMO_SCENE_ACTORS}
                    hour={light.hour}
                    workstationCount={workstations}
                    selectedKey={selectedActor.key}
                    restingKeys={restingKeys}
                    mode={spaceMode}
                    floors={spaceMode === 'custom' ? CUSTOM_DEMO_FLOORS : []}
                    walls={spaceMode === 'custom' ? CUSTOM_DEMO_WALLS : []}
                    items={spaceMode === 'custom' ? CUSTOM_DEMO_ITEMS : []}
                    rugs={spaceMode === 'custom' ? CUSTOM_DEMO_RUGS : []}
                    onSelectActor={setSelectedActorKey}
                    className="h-[360px] sm:h-[400px]"
                  />
                  <div className="pointer-events-none absolute bottom-3 left-3 px-2.5 py-1 rounded-[8px] bg-black/45 backdrop-blur-md text-[#f5f0e8] text-[11px]">
                    点击 3D 角色查看详情 · 拖拽旋转 / 滚轮缩放
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2.5 mt-3.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {actorMetas
                      .filter((a) => a.key !== 'system:reception')
                      .map((actor) => (
                        <button
                          key={actor.key}
                          type="button"
                          onClick={() => setSelectedActorKey(actor.key)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-[11.5px] font-medium border transition-colors ${
                            actor.key === selectedActor.key
                              ? 'bg-[#242323] text-[#f7f5f2] border-[#242323]'
                              : 'bg-[#f4f0eb] text-[#5d5956] border-[#e2dad1] hover:text-[#252423]'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${statusColor(actor.status)}`} />
                          {actor.name}
                        </button>
                      ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setQaResting((prev) => !prev);
                        setSelectedActorKey('agent:qa');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] bg-[#f4f0eb] hover:bg-[#e9e3dc] border border-[#ded6cd] text-[12px] font-medium text-[#252423] transition-colors"
                    >
                      <Coffee className="w-3.5 h-3.5 text-[#a1662c]" />
                      {qaResting ? '让测试员回工位' : '让测试员去长桌休息'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setWorkstations((n) => (n >= 18 ? 12 : n + 2))}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] bg-[#f4f0eb] hover:bg-[#e9e3dc] border border-[#ded6cd] text-[12px] font-medium text-[#252423] transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5 text-[#3d614e]" />
                      {workstations >= 18 ? '还原 12 工位' : '扩建 +2 实体工位'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Inspector Card */}
              <aside className="lg:col-span-4 rounded-[18px] bg-[#f6f3ef] border border-[#e3dcd4] p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <span className="text-[11px] font-semibold tracking-wider uppercase text-[#78716b]">成员实况面板</span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white border border-[#e2dad1] text-[11px] font-medium text-[#252423]">
                      <span className={`w-1.5 h-1.5 rounded-full ${statusColor(selectedActor.status)}`} />
                      {selectedActor.statusText}
                    </span>
                  </div>

                  <h3 className="text-[20px] font-bold text-[#252423]">{selectedActor.name}</h3>
                  <p className="text-[13px] text-[#5d5956] mt-0.5">{selectedActor.role}</p>

                  <dl className="mt-5 space-y-3 text-[13px]">
                    <div className="flex justify-between gap-3 py-2 border-b border-[#e5dfd8]">
                      <dt className="text-[#78716b]">当前工位</dt>
                      <dd className="font-medium text-[#252423] text-right">{selectedActor.seat}</dd>
                    </div>
                    <div className="flex justify-between gap-3 py-2 border-b border-[#e5dfd8]">
                      <dt className="text-[#78716b]">所属小队</dt>
                      <dd className="font-medium text-[#252423] text-right">{selectedActor.team}</dd>
                    </div>
                    <div className="flex justify-between gap-3 py-2 border-b border-[#e5dfd8]">
                      <dt className="text-[#78716b]">执行来源</dt>
                      <dd className="font-medium text-[#252423] text-right">{selectedActor.runtime}</dd>
                    </div>
                    <div className="flex justify-between gap-3 py-2 border-b border-[#e5dfd8]">
                      <dt className="text-[#78716b]">当前焦点</dt>
                      <dd className="font-medium text-[#252423] text-right">{selectedActor.task}</dd>
                    </div>
                    <div className="flex justify-between gap-3 py-2">
                      <dt className="text-[#78716b]">今日用量</dt>
                      <dd className="font-semibold text-[#3d614e] tabular-nums text-right">{selectedActor.tokens}</dd>
                    </div>
                  </dl>
                </div>

                <a
                  href="/office#overview"
                  className="mt-6 inline-flex items-center justify-center gap-1.5 h-[40px] rounded-[10px] bg-[#242323] hover:bg-[#383634] text-[#f7f5f2] text-[13px] font-medium transition-colors"
                >
                  进入真实 3D 办公室 →
                </a>
              </aside>
            </div>
          )}

          {activeTab === 'board' && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-[#252423]">
                  <Sparkles className="w-4 h-4 text-[#3d614e]" />
                  <span>交互式任务看板演示（点击任务按钮真实驱动状态流转）</span>
                </div>
                <button
                  type="button"
                  onClick={resetBoard}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] bg-[#f4f0eb] hover:bg-[#e9e3dc] border border-[#ded6cd] text-[12px] font-medium text-[#252423]"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  重置演示
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-4">
                {(
                  [
                    ['todo', '待办', 'bg-[#ece8e3] text-[#4e4944]'],
                    ['in_progress', '进行中', 'bg-[#dfeaf0] text-[#285a70]'],
                    ['review', '审核中', 'bg-[#e1ece5] text-[#2f5843]'],
                    ['done', '已完成', 'bg-[#e6e3df] text-[#3d614e]'],
                  ] as const
                ).map(([status, title, pill]) => {
                  const colTasks = tasks.filter((t) => t.status === status);
                  return (
                    <div
                      key={status}
                      className="rounded-[14px] bg-[#f5f2ee] border border-[#e3dcd4] p-3 flex flex-col gap-2.5 min-h-[210px]"
                    >
                      <div className="flex items-center justify-between">
                        <span className={`px-2 py-0.5 rounded-[6px] text-[11.5px] font-semibold ${pill}`}>{title}</span>
                        <span className="text-[11px] text-[#78716b] tabular-nums">{colTasks.length}</span>
                      </div>

                      {colTasks.length ? (
                        colTasks.map((task) => (
                          <div
                            key={task.id}
                            className="rounded-[12px] bg-white border border-[#e5ded6] p-3 shadow-sm flex flex-col gap-2"
                          >
                            <div className="flex items-center justify-between gap-2 text-[11px] text-[#78716b]">
                              <span className="font-mono font-semibold">{task.key}</span>
                              <span className="px-1.5 py-0.5 rounded bg-[#f3efe9] text-[#5d5956]">{task.label}</span>
                            </div>
                            <p className="text-[13px] font-semibold text-[#252423] leading-snug">{task.title}</p>
                            <div className="flex items-center justify-between text-[11.5px] text-[#5d5956]">
                              <span>{task.assignee}</span>
                              {task.tokens > 0 && <span className="tabular-nums">{task.tokens.toLocaleString()} T</span>}
                            </div>
                            {task.status === 'todo' && (
                              <button
                                type="button"
                                disabled={Boolean(simulatingId)}
                                onClick={() => dispatchTask(task.id)}
                                className="mt-1 inline-flex items-center justify-center gap-1 h-[30px] rounded-[8px] bg-[#242323] hover:bg-[#383634] disabled:opacity-50 text-[#f7f5f2] text-[12px] font-medium transition-colors"
                              >
                                <Play className="w-3 h-3" />
                                派发给 Agent 执行
                              </button>
                            )}
                            {task.status === 'in_progress' && (
                              <span className="mt-1 inline-flex items-center justify-center gap-1.5 h-[30px] rounded-[8px] bg-[#dfeaf0] text-[#285a70] text-[12px] font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#285a70] animate-pulse" />
                                运行器执行中…
                              </span>
                            )}
                            {task.status === 'review' && (
                              <button
                                type="button"
                                onClick={() => approveTask(task.id)}
                                className="mt-1 inline-flex items-center justify-center gap-1 h-[30px] rounded-[8px] bg-[#3d614e] hover:bg-[#2f4d3d] text-white text-[12px] font-medium transition-colors"
                              >
                                <Check className="w-3.5 h-3.5" />
                                验收并发布交付
                              </button>
                            )}
                            {task.status === 'done' && (
                              <span className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-[#3d614e] font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                已发布至项目工作区
                              </span>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="text-[12px] text-[#9b938b] text-center my-auto py-6">暂无任务</p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="rounded-[12px] bg-[#242323] text-[#ece7e1] px-4 py-3 font-mono text-[12px] space-y-1">
                {runLog.map((line, i) => (
                  <p key={i} className="leading-relaxed">
                    {line}
                  </p>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'discovery' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7">
                <div className="flex items-center justify-between gap-3 mb-3.5">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-[#252423]">
                    <Cpu className="w-4 h-4 text-[#3d614e]" />
                    <span>发现的 Agent 运行器资源池</span>
                  </div>
                  <button
                    type="button"
                    onClick={runScan}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] bg-[#f4f0eb] hover:bg-[#e9e3dc] border border-[#ded6cd] text-[12px] font-medium text-[#252423]"
                  >
                    <Radar className={`w-3.5 h-3.5 text-[#3d614e] ${scanning ? 'animate-spin' : ''}`} />
                    {scanning ? '正在扫描本机…' : '立即扫描本机'}
                  </button>
                </div>

                <div className="rounded-[14px] border border-[#e3dcd4] overflow-hidden bg-[#faf8f5]">
                  <table className="w-full text-left text-[13px]">
                    <thead className="bg-[#f1ede8] text-[#6a635d] text-[11.5px]">
                      <tr>
                        <th className="py-2.5 px-3.5 font-medium">运行器</th>
                        <th className="py-2.5 px-3 font-medium">来源</th>
                        <th className="py-2.5 px-3 font-medium">执行适配</th>
                        <th className="py-2.5 px-3 font-medium">接入状态</th>
                        <th className="py-2.5 px-3.5 font-medium text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#ebe4dc]">
                      {runners.map((runner) => (
                        <tr key={runner.id}>
                          <td className="py-3 px-3.5 font-semibold text-[#252423]">{runner.name}</td>
                          <td className="py-3 px-3 text-[#5d5956]">{runner.source}</td>
                          <td className="py-3 px-3">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-[6px] text-[11px] font-medium ${
                                runner.adapter === 'ready'
                                  ? 'bg-[#e1ece5] text-[#2f5843]'
                                  : 'bg-[#ede9e3] text-[#6d6660]'
                              }`}
                            >
                              {runner.adapter === 'ready' ? '已适配执行' : '仅观察模式'}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-[6px] text-[11px] font-medium ${
                                runner.connected
                                  ? 'bg-[#e1ece5] text-[#2f5843]'
                                  : 'bg-[#f4e8d8] text-[#855422]'
                              }`}
                            >
                              {runner.connected ? '已接入' : '待接入'}
                            </span>
                          </td>
                          <td className="py-3 px-3.5 text-right">
                            <button
                              type="button"
                              onClick={() => toggleConnectRunner(runner.id)}
                              className={`px-2.5 py-1 rounded-[7px] text-[11.5px] font-medium transition-colors ${
                                runner.connected
                                  ? 'bg-white border border-[#dcd4cb] text-[#5d5956] hover:text-[#252423]'
                                  : 'bg-[#242323] text-[#f7f5f2] hover:bg-[#383634]'
                              }`}
                            >
                              {runner.connected ? '取消模拟' : '接入运行器'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="lg:col-span-5 rounded-[16px] bg-[#f6f3ef] border border-[#e3dcd4] p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="w-4 h-4 text-[#3d614e]" />
                    <h3 className="text-[15px] font-bold text-[#252423]">管理员授权边界模拟</h3>
                  </div>
                  <p className="text-[12.5px] text-[#5d5956] leading-relaxed mb-4">
                    在 Symbio 中，接入运行器不会自动授予执行权限。管理员可按员工独立开关以下能力：
                  </p>

                  <div className="space-y-2.5">
                    {[
                      {
                        label: '允许执行平台任务',
                        desc: '关闭后员工仅保留档案，不会响应自动派发',
                        value: allowExec,
                        toggle: () => setAllowExec((v) => !v),
                      },
                      {
                        label: '工作目录文件写入（workspace-write）',
                        desc: '关闭时强制降级为只读沙箱（read-only）',
                        value: writeSandbox,
                        toggle: () => setWriteSandbox((v) => !v),
                      },
                      {
                        label: '启用已勾选的 MCP 工具服务',
                        desc: '仅放行管理员白名单中明确列出的工具名',
                        value: mcpEnabled,
                        toggle: () => setMcpEnabled((v) => !v),
                      },
                    ].map((row) => (
                      <button
                        key={row.label}
                        type="button"
                        onClick={row.toggle}
                        className="w-full text-left flex items-center justify-between gap-3 p-3 rounded-[11px] bg-white border border-[#e5ded6] hover:border-[#cfc6bc] transition-colors"
                      >
                        <div>
                          <p className="text-[13px] font-semibold text-[#252423]">{row.label}</p>
                          <p className="text-[11.5px] text-[#78716b] mt-0.5">{row.desc}</p>
                        </div>
                        <span
                          className={`w-10 h-5 rounded-full p-0.5 transition-colors shrink-0 ${
                            row.value ? 'bg-[#3d614e]' : 'bg-[#cfc8c0]'
                          }`}
                        >
                          <span
                            className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${
                              row.value ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4 pt-3.5 border-t border-[#e3dcd4] flex items-center justify-between text-[12px]">
                  <span className="text-[#5d5956]">当前生效权限快照：</span>
                  <span className="font-semibold text-[#252423]">
                    {!allowExec
                      ? '禁止执行'
                      : `${writeSandbox ? '可写交付' : '仅只读'} · ${mcpEnabled ? '含 MCP' : '无 MCP'}`}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
