import { useEffect, useRef, useState } from 'react';
import { isPagesMode, REPO_URL, workspaceHref } from '@/lib/links';

export interface SceneDemoActorSpec {
  key: string;
  name: string;
  kind: 'agent' | 'human' | 'system';
  state: 'working' | 'thinking' | 'speaking' | 'listening' | 'idle' | 'review';
  avatarId: string;
  seatIndex?: number;
  fixedSeat?: 'boss' | 'reception';
  mode?: 'meeting_room' | 'face_to_face';
  sessionId?: string;
  order?: number;
}

interface Office3DStageProps {
  actors: SceneDemoActorSpec[];
  hour: number | null;
  workstationCount?: number;
  selectedKey?: string;
  restingKeys?: string[];
  mode?: 'default' | 'custom';
  floors?: unknown[];
  walls?: unknown[];
  items?: unknown[];
  rugs?: unknown[];
  className?: string;
  onSelectActor?: (key: string) => void;
}

interface OfficeSceneHandle {
  update: (
    actors: unknown[],
    percentage: number,
    selectedKey?: string,
    count?: number,
    lighting?: { hour?: number | null },
    items?: unknown[],
    walls?: unknown[],
    rugs?: unknown[],
    mode?: 'default' | 'custom',
    floors?: unknown[],
  ) => void;
  rotate: (direction: number) => void;
  dispose: () => void;
}

interface RuntimeModules {
  createOfficeScene: (
    host: HTMLElement,
    stroll?: (
      eligible: Set<string>,
      now: number,
      reserved?: unknown[],
      customBreaks?: Array<{ x: number; z: number; angle: number; seated: boolean; area: string; exit?: unknown[] }> | null,
    ) => Map<string, { position: unknown; returnAt: number }>,
  ) => OfficeSceneHandle;
  resolveAvatar: (person: { avatarId: string }) => unknown;
  loungeSeats: Array<{ x: number; z: number; angle: number; seated: boolean; area: string; exit: unknown[] }>;
}

let cachedModulesPromise: Promise<RuntimeModules> | null = null;

function loadOfficeModules(): Promise<RuntimeModules> {
  if (!cachedModulesPromise) {
    const base = import.meta.env.BASE_URL;
    const dynamicImport = (url: string) => import(/* @vite-ignore */ url);
    cachedModulesPromise = Promise.all([
      dynamicImport(`${base}office-scene.js`),
      dynamicImport(`${base}office-avatars.js`),
      dynamicImport(`${base}office-presence.js`),
    ]).then(([sceneMod, avatarMod, presenceMod]) => ({
      createOfficeScene: sceneMod.createOfficeScene,
      resolveAvatar: avatarMod.resolveAvatar,
      loungeSeats: presenceMod.loungeSeats,
    }));
  }
  return cachedModulesPromise;
}

export default function Office3DStage({
  actors,
  hour,
  workstationCount = 12,
  selectedKey,
  restingKeys = [],
  mode = 'default',
  floors = [],
  walls = [],
  items = [],
  rugs = [],
  className = '',
  onSelectActor,
}: Office3DStageProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<OfficeSceneHandle | null>(null);
  const modulesRef = useRef<RuntimeModules | null>(null);
  const restingRef = useRef<string[]>(restingKeys);
  const onSelectRef = useRef(onSelectActor);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  restingRef.current = restingKeys;
  onSelectRef.current = onSelectActor;

  const buildPayload = (modules: RuntimeModules) =>
    actors.map((actor) => ({
      ...actor,
      avatar: modules.resolveAvatar({ avatarId: actor.avatarId }),
    }));

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    const handleClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('.office-actor-marker');
      if (target?.dataset.id && onSelectRef.current) {
        onSelectRef.current(target.dataset.id);
      }
    };
    host.addEventListener('click', handleClick);

    loadOfficeModules()
      .then((modules) => {
        if (cancelled || !host.isConnected) return;
        modulesRef.current = modules;
        // Deterministic stroll controller driven by restingKeys prop so demo actors
        // actually stand up and walk to the break table on demand (works in both default & custom modes).
        const demoStroll = (
          eligible: Set<string>,
          _now: number,
          _reserved?: unknown[],
          customBreaks?: Array<{ x: number; z: number; angle: number; seated: boolean; area: string; exit?: unknown[] }> | null,
        ) => {
          const visits = new Map<string, { position: unknown; returnAt: number }>();
          const seats = customBreaks && customBreaks.length ? customBreaks : modules.loungeSeats;
          const preferred = customBreaks && customBreaks.length ? seats.map((_, i) => i) : [5, 8, 6, 9, 4, 7, 10, 11];
          restingRef.current.forEach((key, idx) => {
            if (!eligible.has(key)) return;
            const seat = seats[preferred[idx % preferred.length]] ?? seats[0];
            if (seat) {
              visits.set(key, {
                position: { ...seat, area: 'stroll' },
                returnAt: Number.POSITIVE_INFINITY,
              });
            }
          });
          return visits;
        };

        const scene = modules.createOfficeScene(host, demoStroll);
        sceneRef.current = scene;
        scene.update(buildPayload(modules), 100, selectedKey, workstationCount, { hour }, items, walls, rugs, mode, floors);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      host.removeEventListener('click', handleClick);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const modules = modulesRef.current;
    if (!scene || !modules) return;
    scene.update(buildPayload(modules), 100, selectedKey, workstationCount, { hour }, items, walls, rugs, mode, floors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actors, hour, workstationCount, selectedKey, restingKeys.join(','), mode, floors, walls, items, rugs]);

  return (
    <div
      ref={hostRef}
      className={`office-map-stage symbio-home-3d-stage ${className}`}
      aria-label="Symbio 实时 3D 数字办公室预览"
    >
      {!ready && !failed && (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-[#6d645b]">
          正在加载 3D 办公室场景…
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-[13px] text-[#5d5956]">
          <p className="font-medium text-[#252423]">当前浏览器未启用 WebGL 3D 渲染</p>
          <a
            href={isPagesMode ? REPO_URL : workspaceHref('#overview')}
            target={isPagesMode ? '_blank' : undefined}
            rel={isPagesMode ? 'noreferrer' : undefined}
            className="text-[#3d614e] font-semibold underline underline-offset-4"
          >
            {isPagesMode ? '前往 GitHub 查看源码与部署指南 →' : '直接进入工作台查看 →'}
          </a>
        </div>
      )}
    </div>
  );
}
