const assetRoot = '/office-assets/';
const roomNames = {
  work: '研发协作区', meeting: '评审会议', ai: 'AI 运行区', lounge: '休息区',
};
const zoneSuffix = {work: '人', meeting: '人', ai: 'Agent', lounge: '人'};

function occupants(zone, model) {
  return zone.autoAssign ? model.rooms[zone.type].filter(person => !zone.teamId || person.teamId === zone.teamId)
    .slice(0, zone.capacity) : [];
}

export function illustration(variant = 'overview') {
  const editor = variant.startsWith('layout');
  const scale = editor ? 544 / 592 : 1;
  const width = editor ? 544 : 592;
  const height = editor ? 346.8 : 377.4;
  const mask = 'office-floor-mask-' + variant;
  const image = (file, x, y, w, h) =>
    `<image href="${assetRoot}${editor ? 'layout-' : ''}${file}.svg" x="${x * scale}" y="${y * scale}" width="${w * scale}" height="${h * scale}" preserveAspectRatio="none"/>`;
  return `<svg class="office-illustration" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
    <defs>
      <mask id="${mask}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" class="office-floor-mask">
        ${image('floor-grid', 55.47, 65.13, 481, 259)}
      </mask>
    </defs>
    ${image('platform-shadow', 48.07, 74.01, 495.8, 269.36)}
    ${image('vector', 55.5, 194.63, 481, 139.86)}
    ${image('vector1', 55.5, 194.63, 240.5, 139.86)}
    ${image('vector2', 54.94, 64.56, 482.11, 260.11)}
    <g mask="url(#${mask})">${image('floor-grid1', 21.43, 83.25, 481.956, 259.746)}</g>
    ${image('glass-walls', 64.21, 26.32, 463.61, 164.828)}
    ${image('meeting-zone', 217.56, 81.29, 148, 114.053)}
    ${image('open-work-zone', 105.79, 158.75, 134.68, 94.7202)}
    ${image('ai-laboratory-zone', 350.75, 113.98, 133.966, 112.48)}
    ${image('lounge-zone', 221.23, 202.67, 164.28, 101.473)}
    ${image('entry-plant', 76.9, 138.4, 33.339, 63.64)}
    ${image('back-plant', 330.75, 56.23, 26.0079, 49.58)}
  </svg>`;
}

function calendarDate(value, timeZone) {
  return new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
  }).format(new Date(value));
}

function shiftDate(date, days) {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
}

export function officeOverview(snapshot, summary, {timeZone, now = new Date()} = {}) {
  const {agents = [], machines = [], candidates = [], conversations = [], runs = [], tasks = []} = snapshot;
  const today = calendarDate(now, timeZone);
  const yesterday = shiftDate(today, -1);
  const tomorrow = shiftDate(today, 1);
  const onlineMachines = new Set(machines.filter(machine => machine.status === 'online').map(machine => machine.id));
  const localRuntimes = new Set(candidates.filter(item =>
    onlineMachines.has('local') && item.machineId === 'local' && item.kind === 'installation' && item.present)
    .map(item => item.provider));
  const active = runs.filter(run => ['running', 'stopping'].includes(run.status));
  const workingIds = new Set(active.map(run => run.agentId));
  const taskRuns = active.filter(run => run.kind === 'task');
  const activeTasks = new Set(taskRuns.map(run => run.taskId));
  const liveConversations = conversations.filter(conversation => conversation.status === 'active');
  const collaboratingIds = new Set(liveConversations.flatMap(conversation => conversation.participantIds));
  const meetingIds = new Set(liveConversations.filter(conversation => conversation.mode === 'meeting_room')
    .flatMap(conversation => conversation.participantIds));
  const presentCandidates = new Set(candidates.filter(candidate => candidate.present &&
    onlineMachines.has(candidate.machineId) &&
    (candidate.kind !== 'process' || machines.find(machine => machine.id === candidate.machineId)?.processScan === 'ok'))
    .map(candidate => candidate.id));
  const online = agents.filter(agent => workingIds.has(agent.id) || agent.runtime === 'demo' ||
    localRuntimes.has(agent.runtime) || (agent.runtime === 'observed' && presentCandidates.has(agent.candidateId)));
  const onlineHumans = (snapshot.humans ?? []).filter(person => person.availability === 'online');
  const completeIds = day => new Set((summary?.completions ?? []).filter(event => calendarDate(event.time, timeZone) === day)
    .map(event => event.task_id)).size;
  const review = tasks.filter(task => task.status === 'review');
  const blocked = tasks.filter(task => task.status === 'blocked');
  const hiring = candidates.filter(candidate => candidate.status === 'review' &&
    machines.find(machine => machine.id === candidate.machineId)?.status !== 'revoked');
  const due = tasks.filter(task => !['done', 'cancelled', 'review', 'blocked'].includes(task.status) &&
    task.dueDate && task.dueDate <= tomorrow).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const attentionGroups = [
    [...review.map(task => ({kind: 'review', task})), ...hiring.map(candidate => ({kind: 'hire', candidate}))],
    blocked.map(task => ({kind: 'blocked', task})),
    due.map(task => ({kind: 'due', task})),
  ];
  const attention = [...attentionGroups.flatMap(group => group.slice(0, 1)),
    ...attentionGroups.flatMap(group => group.slice(1))];
  return {
    today, online, onlineHumans, active, taskRuns, liveConversations, taskCount: activeTasks.size,
    queued: runs.filter(run => run.kind === 'task' && run.status === 'queued').length,
    completed: completeIds(today), completedYesterday: completeIds(yesterday),
    reviewCount: review.length + hiring.length, blockedCount: blocked.length, dueCount: due.length,
    attention,
    rooms: {
      work: agents.filter(agent => collaboratingIds.has(agent.id)),
      meeting: agents.filter(agent => meetingIds.has(agent.id)),
      ai: agents.filter(agent => workingIds.has(agent.id)),
      lounge: online.filter(agent => !workingIds.has(agent.id) && !collaboratingIds.has(agent.id)),
    },
  };
}

export function createOverview({escape, btn, number, localTime, name, find, empty}) {
  const num = value => number(value);
  const kpi = (label, value, caption, {aside = '', suffix = '', alert = false, action, id = ''} = {}) =>
    `<button type="button" class="office-kpi${alert ? ' attention-kpi' : ''}" data-action="${action}" data-id="${id}">
      <span class="kpi-heading">${label}<span>${escape(aside)}</span></span>
      <span class="kpi-reading"><strong>${escape(value)}</strong>${suffix ? `<span>${escape(suffix)}</span>` : ''}</span>
      <span class="kpi-caption">${escape(caption)}</span>
    </button>`;

  function elapsed(start) {
    if (!start) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(start)) / 1000));
    const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
    return minutes + ':' + String(seconds % 60).padStart(2, '0');
  }

  function timelineItem(event) {
    const task = find('tasks', event.task_id);
    const run = find('runs', event.run_id);
    const candidate = find('candidates', event.payload.candidateId);
    const conversation = find('conversations', event.conversation_id);
    const person = event.agent_id ? name('agents', event.agent_id) : '';
    const machine = name('machines', event.payload.machineId);
    let title, description, color = 'neutral';
    let action = task ? 'task-view' : run ? 'run-view' : '';
    let id = task?.id ?? run?.id ?? '';
    switch (event.type) {
      case 'run.started':
        title = person + ' 开始执行';
        description = task?.title ?? conversation?.topic;
        action = 'run-view';
        id = event.run_id;
        break;
      case 'run.failed':
      case 'run.interrupted':
        title = person + (event.type === 'run.failed' ? ' 的执行失败' : ' 的执行中断');
        description = task?.title ?? event.payload.error;
        color = 'alert';
        action = 'run-view';
        id = event.run_id;
        break;
      case 'task.status':
        title = event.payload.status === 'done' ? '任务已验收' : '任务待验收';
        description = task?.title;
        break;
      case 'task.comment':
        title = '任务收到新评论';
        description = task?.title;
        break;
      case 'conversation.started':
      case 'conversation.completed':
        title = event.type === 'conversation.started' ? '协作会话开始' : '协作会话完成';
        description = conversation?.topic;
        color = 'meeting';
        action = 'overview-conversations';
        break;
      case 'candidate.reviewed':
      case 'candidate.approved':
        title = event.type === 'candidate.reviewed' ? '入职档案待确认' : '候选 Agent 已入职';
        description = candidate?.draft?.name;
        action = 'goto-discovery';
        color = 'meeting';
        break;
      case 'machine.status':
        title = machine + (event.payload.status === 'online' ? '已连接' : '已离线');
        description = '采集连接';
        color = event.payload.status === 'online' ? 'neutral' : 'alert';
        action = 'goto-discovery';
        break;
      case 'layout.published':
        title = '办公室布局已发布';
        description = event.payload.name;
        action = 'ws-nav';
        id = 'layout';
        break;
      default: return '';
    }
    const content = `<time datetime="${escape(event.time)}">${escape(localTime(event.time))}</time>
      <strong>${escape(title)}</strong><span>${escape(description || '查看详情')}</span>`;
    return `<li class="office-event ${color}">${action
      ? `<button type="button" data-action="${action}" data-id="${escape(id)}">${content}</button>`
      : `<div>${content}</div>`}</li>`;
  }

  function timeline(report, live, today) {
    const entries = report?.activity ?? [];
    const [, month, day] = today.split('-').map(Number);
    return `<section class="office-timeline" aria-labelledby="office-timeline-title" data-node-id="5:33079">
      <div class="office-timeline-header"><h2 id="office-timeline-title">协作动态</h2>
        <span class="office-pill ${live ? 'green' : ''}">${live ? '实时' : '离线'}</span></div>
      <p class="office-timeline-date">今天，${month} 月 ${day} 日</p>
      <ol class="office-events">${entries.slice(0, 5).map(timelineItem).join('') ||
        '<li class="office-timeline-empty">执行、协作和采集事件会显示在这里。</li>'}</ol>
      <button type="button" class="office-text-button" data-action="overview-details" data-id="activity">查看全部动态 →</button>
    </section>`;
  }

  function attentionCard(entry, index) {
    const task = entry.task;
    const candidate = entry.candidate;
    const taskRef = task?.number ? name('projects', task.projectId) + ' · ' + task.number + ' 号任务' : '任务';
    const content = {
      review: ['任务验收', task?.title, '待人工确认交付', '去验收', 'task-view', task?.id],
      hire: ['入职审批', candidate?.draft?.name ?? candidate?.provider, '已提交入职档案', '去审批', 'candidate-approve', candidate?.id],
      blocked: ['任务阻塞', task?.title, taskRef, '查看详情', 'task-view', task?.id],
      due: ['截止提醒', task?.title, '截止 ' + task?.dueDate, '查看任务', 'task-view', task?.id],
    }[entry.kind];
    const [title, description, detail, link, action, id] = content;
    return `<article class="office-attention-card">
      <div class="office-attention-title"><span>${String(index + 1).padStart(2, '0')}</span><h3>${escape(title)}</h3></div>
      <p>${escape(description)}</p>
      <div class="office-attention-meta"><span>${escape(detail)}</span>
        <button type="button" class="office-text-button" data-action="${action}" data-id="${escape(id)}">${link} →</button>
      </div>
    </article>`;
  }

  function attention(model) {
    const cards = model.attention.slice(0, 3).map(attentionCard);
    const missing = [
      ['任务验收', '暂无待确认事项', model.reviewCount],
      ['任务阻塞', '暂无阻塞任务', model.blockedCount],
      ['截止提醒', '没有即将到期的任务', model.dueCount],
    ].filter(([, , count]) => !count);
    for (const [title, message] of missing.slice(0, 3 - cards.length)) {
      cards.push(`<article class="office-attention-card office-attention-placeholder">
        <div class="office-attention-title"><span>—</span><h3>${title}</h3></div><p>${message}</p></article>`);
    }
    return `<section class="office-attention" aria-labelledby="office-attention-title">
      <header><h2 id="office-attention-title">需要你关注</h2><span>${num(model.attention.length)} 项待处理</span>
        <button type="button" class="office-text-button" data-action="overview-details" data-id="attention">查看全部 ↗</button>
      </header>
      <div class="office-attention-grid">${cards.join('')}</div>
    </section>`;
  }

  function map(snapshot, model, {zoom, flat, sceneUnavailable, actors = [], selectedActor}) {
    const current = model.taskRuns[0] ?? model.active[0];
    const task = current && find('tasks', current.taskId);
    const agent = current && name('agents', current.agentId);
    const published = snapshot.layout?.published;
    const zones = published ? published.zones.filter(item => item.visible)
      : Object.keys(roomNames).map(key => ({id:key, type:key, name:roomNames[key], autoAssign:true, capacity:Infinity}));
    const zone = item => `<button type="button" class="office-zone ${item.type}" data-action="overview-details"
      data-id="${published ? 'zone:' : ''}${escape(item.id)}"${published ? ` data-published-zone="${escape(item.id)}"` : ''}>
      ${escape(item.name)}<span> · </span>${occupants(item, model).length ? num(occupants(item, model).length) + ' ' + zoneSuffix[item.type] : '空闲'}
    </button>`;
    const roomLinks = zones.map(item => `<button type="button" data-action="overview-details"
      data-id="${published ? 'zone:' : ''}${escape(item.id)}">${escape(item.name)}</button>`).join('');
    const selected = actors.find(actor => actor.key === selectedActor);
    const stateButton = actor => `<button type="button" data-action="office-person" data-id="${escape(actor.key)}"
      data-state="${actor.state}" aria-pressed="${actor.key === selectedActor}"><i aria-hidden="true"></i>
      <span>${escape(actor.name)}</span><small>${actor.label}</small></button>`;
    return `<section class="office-map${flat ? '' : ' office-map-3d'}" aria-labelledby="office-map-title" data-node-id="5:33053">
      <div class="office-map-stage">
        <header class="office-map-header">
          <div><h2 id="office-map-title">数字办公室</h2>
            <button type="button" class="office-floor office-text-button chevron-trigger" data-action="overview-details" data-id="rooms">
              ${escape(snapshot.settings?.workspace.name ?? '本机工作区')} / ${escape(published?.title ?? '1F 协作空间')}
            </button>
          </div>
          <div class="office-map-pills">
            <button type="button" class="office-pill" data-action="overview-details" data-id="staff">● ${num(model.online.length)} Agent</button>
            <span class="office-pill" title="来自员工档案中标记在线的真人">● ${num(model.onlineHumans.length)} 真人</span>
          </div>
        </header>
        ${flat ? `<div class="office-scene" data-zoom="${zoom}">
          ${illustration()}
          ${zones.map(zone).join('')}
          ${current ? `<button type="button" class="office-now" data-action="run-view" data-id="${escape(current.id)}">
            <span class="office-avatar">${escape(Array.from(agent)[0] ?? 'A')}</span>
            <span><strong>${escape(agent)} · ${escape(current.activity ?? '执行中')}</strong>
            <span>${escape(task?.title ?? '协作会话')}${current.startedAt ? ' · 已执行 ' + elapsed(current.startedAt) : ''}</span></span>
          </button>` : `<button type="button" class="office-now" data-action="overview-tasks">
            <span class="office-avatar" aria-hidden="true">A</span>
            <span><strong>暂无任务执行</strong><span>打开任务看板 →</span></span></button>`}
        </div>` : `<div id="office-3d-viewport" class="office-3d-viewport" aria-label="实时三维办公室">
          <p class="office-scene-loading">正在载入 3D 办公室…</p>
        </div>
        <div class="office-room-links" aria-label="办公室区域">${roomLinks}</div>`}
      </div>
      ${selected && !flat ? `<div class="office-selected" data-state="${selected.state}">
        <i aria-hidden="true"></i><div><strong>${escape(selected.name)} · ${selected.label}</strong>
        <span>${escape([selected.title, selected.detail, !selected.title && !selected.detail && selected.avatar.name].filter(Boolean).join(' · '))}</span></div>
        ${selected.runId ? btn('run-view', '执行详情', selected.runId) : ''}
        ${selected.taskId ? btn('task-view', '任务', selected.taskId) : ''}
        ${selected.sessionId ? btn('overview-conversations', '会话') : ''}
        ${btn(selected.kind === 'agent' ? 'agent-edit' : 'ws-human-edit', '档案', selected.profileId)}
        <button type="button" data-action="office-person" data-id="" aria-label="关闭角色详情">×</button></div>` : ''}
      <footer class="office-map-toolbar">
        <div class="office-legend" aria-label="状态图例">
          <span class="working">● 工作中</span><span class="meeting">● 协作中</span><span>● 空闲</span><span class="warning">● 异常</span>
        </div>
        <div class="office-zoom" aria-label="办公室视图控制">
          <button type="button" data-action="office-view" aria-pressed="${!flat}">${flat ? '3D' : '平面'}</button>
          ${flat ? '' : `<button type="button" data-action="office-orbit" data-id="-1" aria-label="向左旋转">↶</button>
          <button type="button" data-action="office-orbit" data-id="1" aria-label="向右旋转">↷</button>`}
          <button type="button" data-action="office-zoom-out" aria-label="缩小"${zoom === 80 ? ' disabled' : ''}>−</button>
          <button type="button" data-action="office-zoom-reset" aria-label="还原缩放">${zoom}%</button>
          <button type="button" data-action="office-zoom-in" aria-label="放大"${zoom === 140 ? ' disabled' : ''}>+</button>
          <button type="button" data-action="overview-fullscreen" data-id="map" aria-label="办公室全屏">⛶</button>
        </div>
      </footer>
      ${sceneUnavailable && flat ? '<p class="office-scene-note" role="status">3D 暂不可用，已切换到平面视图。</p>' : ''}
      ${!flat && actors.length ? `<div class="office-live-roster" aria-label="实时角色列表">${actors.map(stateButton).join('')}</div>
        <p id="office-scene-capacity" class="office-scene-note" hidden></p>` : ''}
    </section>`;
  }

  function render(snapshot, report, options, model = officeOverview(snapshot, report, options)) {
    const delta = model.completed - model.completedYesterday;
    const widgets = snapshot.layout?.published?.widgets ?? {};
    return `<div class="office-overview" data-node-id="5:5">
      <header class="office-intro">
        <div><h1>让每一份协作，都清晰可见。</h1>
          <p>实时掌握真人与 Agent 的工作状态、协作进展和异常。</p></div>
        <div class="office-controls">
          <span class="office-pill ${options.live ? 'green' : ''}">● ${options.live ? '实时同步' : '正在重连'}</span>
          <button type="button" class="office-control" data-action="overview-fullscreen" data-id="page">${options.fullscreen ? '↙ 退出大屏' : '↗ 大屏模式'}</button>
          <details class="office-menu"><summary class="office-control" aria-label="更多操作">···</summary>
            <div><button type="button" data-action="overview-refresh">刷新总览</button>
              <button type="button" data-action="overview-tasks">打开任务看板</button>
              <button type="button" data-action="overview-settings">工作台设置</button></div>
          </details>
        </div>
      </header>
      ${widgets.metrics !== false ? `<section class="office-metrics" aria-label="工作区指标">
        ${kpi('在线员工', num(model.online.length + model.onlineHumans.length), 'Agent ' + num(model.online.length) + '  ·  真人 ' + num(model.onlineHumans.length),
          {suffix: '/ ' + num(snapshot.agents.length + (snapshot.humans?.length ?? 0)), action: 'overview-details', id: 'staff'})}
        ${kpi('执行中任务', num(model.taskCount), num(model.liveConversations.length) + ' 场协作会话进行中',
          {aside: num(model.queued) + ' 项排队', action: 'overview-details', id: 'tasks'})}
        ${kpi('今日完成', num(model.completed), '已通过人工验收',
          {aside: delta ? (delta > 0 ? '↑ ' : '↓ ') + num(Math.abs(delta)) + ' 项' : '较昨日持平', action: 'overview-details', id: 'completed'})}
        ${kpi('待人工介入', String(model.reviewCount + model.blockedCount).padStart(2, '0'),
          num(model.reviewCount) + ' 项确认  ·  ' + num(model.blockedCount) + ' 项阻塞',
          {aside: model.reviewCount + model.blockedCount ? '需要关注' : '暂无待办', alert: true, action: 'overview-details', id: 'attention'})}
      </section>` : ''}
      <div class="office-main-grid${widgets.activity === false ? ' without-timeline' : ''}">${map(snapshot, model, options)}${widgets.activity === false ? '' : timeline(report, options.live, model.today)}</div>
      ${widgets.attention === false ? '' : attention(model)}
    </div>`;
  }

  function details(id, snapshot, report, options) {
    const model = officeOverview(snapshot, report, options);
    const list = (items, renderItem, fallback) => items.length
      ? `<div class="stack">${items.map(renderItem).join('')}</div>` : empty(fallback);
    if (id === 'activity') {
      return {title: '全部协作动态', body: `<ol class="office-events office-events-full">${(report?.activity ?? [])
        .map(timelineItem).join('') || '<li class="office-timeline-empty">暂无动态。</li>'}</ol>`};
    }
    if (id === 'attention') {
      return {title: '需要你关注', body: list(model.attention, attentionCard, '目前没有待处理事项。')};
    }
    if (id === 'tasks') {
      return {title: '执行中任务', body: list(model.taskRuns, run => `<div class="card card-head">
        <strong>${escape(find('tasks', run.taskId)?.title ?? '执行任务')}</strong>
        ${btn('run-view', '查看执行', run.id)}</div>`, '当前没有执行中的任务。') + btn('overview-tasks', '打开任务看板')};
    }
    if (id === 'completed') {
      const ids = new Set((report?.completions ?? []).filter(event => calendarDate(event.time, options.timeZone) === model.today)
        .map(event => event.task_id));
      return {title: '今日完成', body: list(snapshot.tasks.filter(task => ids.has(task.id)),
        task => `<div class="card card-head"><strong>${escape(task.title)}</strong>${btn('task-view', '任务详情', task.id)}</div>`,
        '今天还没有通过验收的任务。')};
    }
    if (id === 'rooms') {
      const layout = snapshot.layout?.published;
      if (layout) return {title: layout.title, body: `<div class="stack">${layout.zones.filter(item => item.visible).map(item =>
        btn('overview-details', item.name + ' · ' + occupants(item, model).length + ' 名员工', 'zone:' + item.id)).join('')}</div>`};
      return {title: '1F 协作空间', body: `<div class="stack">${Object.keys(roomNames).map(key =>
        btn('overview-details', roomNames[key] + ' · ' + model.rooms[key].length + ' 名员工', key)).join('')}</div>`};
    }
    const publishedZone = id.startsWith('zone:') ? snapshot.layout?.published?.zones.find(item => 'zone:' + item.id === id) : null;
    const employees = id === 'staff' ? [...model.online, ...model.onlineHumans]
      : publishedZone ? occupants(publishedZone, model) : model.rooms[id] ?? [];
    return {title: id === 'staff' ? '在线员工' : publishedZone?.name ?? roomNames[id], body: list(employees, agent => {
      const run = model.active.find(run => run.agentId === agent.id);
      return `<div class="card card-head"><strong>${escape(agent.name)}</strong>
        ${run ? btn('run-view', '查看执行', run.id) : '<span class="description">在线</span>'}</div>`;
    }, '当前没有员工。') + (['work', 'meeting'].includes(id) ? btn('overview-conversations', '查看协作会话') : '')};
  }

  return {render, details};
}
