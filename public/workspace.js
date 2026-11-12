import { officeOverview } from './overview.js';
import { avatarFields } from './office-avatars.js';
import { baseWorkstations, workstationLabel } from './office-presence.js';

const pageNames = {
  overview: '实时监控', tasks: '项目工作台', people: '员工管理', agents: 'Agent 管理', layout: '布局管理',
  settings: '工作空间设置', help: '帮助中心', inbox: '收件箱', discovery: '发现与入职', finance: '财务',
  conversations: '协作会话',
};
const roleNames = {worker: '执行员工', lead: '项目负责人', hr: '人事', finance: '财务'};
const zoneNames = {work: '开放工位区', meeting: '会议室', ai: 'Agent 节点', lounge: '休闲区'};
const zoneSeeds = {work: '研发协作区', meeting: '评审会议室', ai: 'AI 运行区', lounge: '休息区'};
const templates = [
  ['open', '开放式协作', '适合跨职能项目团队'],
  ['delivery', '研发与交付', '适合高密度人机协同'],
  ['distributed', '分布式团队', '适合远程办公与多区域协作'],
];
const templatePositions = {
  open: {work: [9.8, 44], meeting: [45.5, 14.3], ai: [68.5, 52.6], lounge: [37, 73]},
  delivery: {work: [15, 46], meeting: [40, 29], ai: [64, 51], lounge: [44, 77]},
  distributed: {work: [10, 38], meeting: [53, 23], ai: [66, 57], lounge: [25, 73]},
};
const sceneZoneOrigins = {work:[-3.2,.55], meeting:[6.45,5.6], ai:[6.6,-.95], lounge:[-3.4,5.8]};
const clamp = (value, low, high) => Math.min(high,Math.max(low,value));
const pad = value => String(value).padStart(2, '0');
const shiftDate = (key, days) => new Date(Date.parse(key + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);

export function createWorkspaceView(ui) {
  const {data, escape, btn, input, select, empty, number, localTime, edit, api, render,
    navigate, find, name, editNamed, taskKey, workflowName, timeZone} = ui;
  let employee = {tab: 'all', team: '', status: '', q: '', page: 1, selected: ''};
  let agents = {tab: 'all', team: '', model: '', q: ''};
  let calendarOffset = 0, selectedDay, period = 7;
  let layoutDraft, layoutRevision, layoutDirty = false, layoutTab = 'space', layoutView = '3d';
  let selectedZone, layoutZoom = 80, drag;
  let mobileOpen = false;

  const dateKey = value => new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timeZone(),
  }).format(new Date(value));
  const today = () => dateKey(Date.now());
  const monthDay = key => key ? Number(key.slice(5, 7)) + ' 月 ' + Number(key.slice(8, 10)) + ' 日' : '—';
  const percent = (part, total) => total ? Math.round(part / total * 100) : 0;
  const progress = (value, label, color = '') => `<progress max="100" value="${value}" aria-label="${escape(label)}" class="${color}"></progress>`;
  const label = (text, variant = '') => `<span class="symbio-label ${variant}">${escape(text)}</span>`;
  const blockButton = (type, text, id = '', variant = '') =>
    `<button type="button" class="symbio-button ${variant}" data-action="${type}" data-id="${escape(id)}">${escape(text)}</button>`;
  const link = (type, text, id = '') => blockButton(type, text, id, 'text');
  const panel = (title, body, button = '', cls = '') =>
    `<section class="symbio-panel ${cls}"><header class="symbio-panel-head"><h2>${escape(title)}</h2>${button}</header>${body}</section>`;
  const metrics = entries => `<div class="symbio-metrics">${entries.map(([title, value, meta, variant]) =>
    `<article class="symbio-metric"><span>${escape(title)}</span><strong>${escape(value)}</strong>
      <small class="${variant ?? ''}">${escape(meta)}</small></article>`).join('')}</div>`;
  const intro = (id, title, description, actions, body, cls) =>
    `<div class="symbio-page ${cls}" data-node-id="${id}"><header class="symbio-intro">
      <div><h1>${escape(title)}</h1><p>${escape(description)}</p></div><div class="symbio-actions">${actions}</div>
    </header>${body}</div>`;
  const activeRuns = snapshot => snapshot.runs.filter(run => ['queued', 'running', 'stopping'].includes(run.status));
  const assignedName = task => [task.assigneeId ? name('agents', task.assigneeId) : '', task.humanId ? name('humans', task.humanId) : '']
    .filter(Boolean).join(' · ') || '未分配';

  function renderShell(page, snapshot) {
    document.getElementById('breadcrumb-page').textContent = pageNames[page] ?? pageNames.overview;
    document.getElementById('top-operator').textContent = snapshot.user.name;
    document.getElementById('top-operator-role').textContent = snapshot.user.role === 'admin' ? '工作空间管理员' : '工作空间成员';
    document.getElementById('sidebar-people').textContent = snapshot.agents.length + (snapshot.humans?.length ?? 0);
    const budget = snapshot.ledger.find(row => row.scope === 'company');
    const usage = budget?.limit > 0 ? percent(budget.spent, budget.limit) : null;
    document.getElementById('sidebar-quota-label').textContent = usage === null ? '—' : usage + '%';
    document.getElementById('sidebar-quota').value = Math.min(usage ?? 0, 100);
    const bell = document.querySelector('.symbio-bell');
    bell.setAttribute('aria-label', snapshot.unread ? `收件箱，${snapshot.unread} 条未读` : '收件箱');
    document.querySelectorAll('.symbio-navigation button').forEach(button => {
      if (button.dataset.page === page) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function projectRows(snapshot) {
    return snapshot.projects.map(project => {
      const tasks = snapshot.tasks.filter(task => !task.parentId && task.projectId === project.id && task.status !== 'cancelled');
      const complete = tasks.filter(task => task.status === 'done').length;
      const blocked = tasks.some(task => task.status === 'blocked');
      return {...project, tasks: tasks.length, progress: percent(complete, tasks.length),
        status: tasks.length && complete === tasks.length ? '已完成' : blocked ? '需关注' : tasks.length ? '进行中' : '待开始'};
    });
  }

  function projectTable(rows) {
    if (!rows.length) return empty('还没有项目。新建项目后，这里会显示任务进度。');
    return `<div class="symbio-scroll-table"><table class="symbio-table project-table">
      <thead><tr><th>项目名称</th><th>状态</th><th>进度</th><th>负责人</th><th>截止日期</th><th>工作区</th></tr></thead>
      <tbody>${rows.map(project => `<tr><td>${link('project-edit', project.name, project.id)}<small>${escape(project.description || '项目')} · ${link('project-tasks', project.tasks + ' 项任务', project.id)}</small></td>
        <td>${label(project.status, project.status === '需关注' ? 'warn' : project.status === '待开始' ? '' : 'green')}</td>
        <td><div class="symbio-progress">${progress(project.progress, project.name + '完成进度', project.status === '需关注' ? 'warn' : '')}
          <small>${project.progress}%</small></div></td>
        <td>${escape(project.owner || '—')}</td><td>${escape(monthDay(project.dueDate))}</td>
        <td>${link('project-space', '公共工作区 →', project.id)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function calendar(snapshot) {
    const now = today();
    const base = new Date(now + 'T12:00:00Z');
    const month = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + calendarOffset, 1, 12));
    const first = month.toISOString().slice(0, 10);
    const lastDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    const firstIndex = (month.getUTCDay() + 6) % 7;
    const totalDays = Math.ceil((firstIndex + lastDay) / 7) * 7;
    const mainTasks = snapshot.tasks.filter(task => !task.parentId);
    const marks = new Set([...snapshot.projects, ...mainTasks].map(item => item.dueDate).filter(Boolean));
    mainTasks.filter(task => task.scheduledAt && task.status !== 'cancelled').forEach(task => marks.add(dateKey(task.scheduledAt)));
    (snapshot.schedules ?? []).forEach(item => marks.add(dateKey(item.startAt)));
    const days = Array.from({length: totalDays}, (_, index) => shiftDate(first, index - firstIndex));
    return panel('团队日历', `<div class="symbio-calendar-title"><strong>${month.getUTCFullYear()} 年 ${month.getUTCMonth() + 1} 月</strong>
      <div>${link('ws-month', '‹', '-1')}${link('ws-month', '›', '1')}</div></div>
      <div class="symbio-calendar-grid">${['一','二','三','四','五','六','日'].map(day => `<span>${day}</span>`).join('')}
      ${days.map(day => `<button type="button" data-action="ws-day" data-id="${day}" aria-label="${day}" aria-pressed="${day === (selectedDay ?? now)}"
        class="${day.slice(0, 7) !== first.slice(0, 7) ? 'outside' : ''}${marks.has(day) ? ' marked' : ''}">${Number(day.slice(8))}</button>`).join('')}</div>
      <p class="symbio-calendar-legend">● 项目截止日与团队日程</p>`, link('ws-schedule-edit', '＋ 新建日程'), 'symbio-calendar');
  }

  function schedulePanel(snapshot) {
    const day = selectedDay ?? today();
    const schedule = (snapshot.schedules ?? []).filter(item => dateKey(item.startAt) === day)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    const timed = snapshot.tasks.filter(task => !task.parentId && task.scheduledAt && task.status !== 'cancelled' && dateKey(task.scheduledAt) === day)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const due = [...snapshot.projects.map(project => ({...project, kind: 'project'})),
      ...snapshot.tasks.filter(task => !task.parentId && !['done', 'cancelled'].includes(task.status)).map(task => ({...task, kind: 'task'}))]
      .filter(item => item.dueDate === day);
    return panel(day === today() ? '今日安排' : '日程安排', `<p class="symbio-schedule-date">${monthDay(day)} · ${new Intl.DateTimeFormat('zh-CN', {weekday:'short',timeZone:'UTC'}).format(new Date(day + 'T12:00:00Z'))}</p>
      <div class="symbio-schedule-list">${schedule.map(item => `<article><time>${escape(localTime(item.startAt).slice(0, 5))}</time>
        <div>${link('ws-schedule-edit', item.title, item.id)}<small>${escape(item.participants || '团队日程')}</small></div></article>`).join('')}
      ${timed.map(item => `<article><time>${escape(localTime(item.scheduledAt).slice(0, 5))}</time>
        <div>${link('task-view', item.title, item.id)}<small>${item.scheduleStartedAt ? '已定时派发' : '定时派发'}</small></div></article>`).join('')}
      ${due.map(item => `<article><time>截止</time><div>${link(item.kind === 'project' ? 'project-edit' : 'task-view', item.name || item.title, item.id)}
        <small>${escape(item.owner || assignedName(item))}</small></div></article>`).join('')}
      ${!schedule.length && !timed.length && !due.length ? empty('这一天还没有日程。') : ''}</div>`, '', 'symbio-schedule');
  }

  function workbench() {
    const snapshot = data();
    const now = today();
    const until = shiftDate(now, 2);
    const mainTasks = snapshot.tasks.filter(task => !task.parentId);
    const open = mainTasks.filter(task => !['done', 'cancelled'].includes(task.status));
    const due = open.filter(task => task.dueDate && task.dueDate >= now && task.dueDate <= until);
    const projects = projectRows(snapshot);
    const weekday = (new Date(now + 'T12:00:00Z').getUTCDay() + 6) % 7;
    const since = shiftDate(now, period === 7 ? -weekday : 1 - period);
    const periodTasks = mainTasks.filter(task => task.status !== 'cancelled' && task.createdAt && dateKey(task.createdAt) >= since);
    const periodText = period === 30 ? '近 30 天' : '本周';
    const runningIds = new Set(activeRuns(snapshot).filter(run => run.kind === 'task' && run.status !== 'queued').map(run => run.taskId));
    const tasksRunning = mainTasks.filter(task => runningIds.has(task.id)).length;
    const operator = snapshot.user.name;
    const hour = Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:timeZone()}).format());
    const greeting = hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';
    const columns = [['todo', '待开始'], ['in_progress', '进行中'], ['review', '待人工审核']];
    const board = `<section class="symbio-team-board"><header class="symbio-panel-head"><div><h2>团队任务看板</h2>
      <p>${link('ws-all-tasks', '打开任务看板 · ' + mainTasks.length)} / 分配给我的 ${mainTasks.filter(task => (snapshot.humans ?? []).find(h => h.id === task.humanId)?.name === operator).length}</p></div>
      ${blockButton('task-edit', '＋ 添加任务')}</header>
      <div class="symbio-board-columns">${columns.map(([state, title]) => {
        const items = mainTasks.filter(task => task.status === state || (state === 'todo' && task.status === 'blocked'));
        return `<section class="symbio-board-column"><header><strong>${state === 'review' ? '<span class="symbio-board-dot warn">●</span>' : '●'} ${escape(workflowName(state) ?? title)}</strong><span>${pad(items.length)}</span>
          ${link('task-edit', '＋')}</header><div>${items.map(task => `<button type="button" data-action="task-view" data-id="${escape(task.id)}" class="symbio-task">
            <strong>${escape(task.title)}</strong><small>${escape(assignedName(task))}</small><span>${label(name('projects', task.projectId))}
              <small>${escape(task.dueDate === now ? '今日截止' : monthDay(task.dueDate))}</small></span></button>`).join('') || empty('暂无任务')}</div></section>`;
      }).join('')}</div></section>`;
    return intro('5:9', greeting + '，' + operator, `未来 48 小时有 ${due.length} 项任务即将到期。`,
      blockButton('ws-period', periodText, '', 'chevron-trigger') + blockButton('project-edit', '＋ 新建项目', '', 'primary'),
      metrics([
        ['进行中项目', projects.filter(item => item.status === '进行中' || item.status === '需关注').length, projects.length + ' 个项目'],
        ['执行中任务', tasksRunning, tasksRunning + ' 项由 Agent 执行'],
        [periodText + '完成率', percent(periodTasks.filter(t => t.status === 'done').length, periodTasks.length) + '%', periodTasks.length + ' 项新任务'],
        ['即将截止', pad(due.length), '未来 48 小时内', 'alert'],
      ]) + `<div class="symbio-project-grid"><div>${panel('项目进度', projectTable(projects), link('ws-projects', '所有项目 →'), 'symbio-project-progress')}${board}</div>
      <div>${calendar(snapshot)}${schedulePanel(snapshot)}</div></div>`, 'symbio-project');
  }

  function roster(snapshot) {
    const online = new Set(officeOverview(snapshot, null).online.map(agent => agent.id));
    const inUse = new Set(snapshot.runs.filter(run => run.status === 'running').map(run => run.agentId));
    const collaborating = new Set(snapshot.conversations.filter(item => item.status === 'active').flatMap(item => item.participantIds));
    const humans = (snapshot.humans ?? []).map(item => ({...item, type: 'human', status: item.availability,
      code: 'EMP-' + String(item.number).padStart(3, '0')}));
    const ai = snapshot.agents.map((item, index) => ({...item, type: 'agent',
      title: roleNames[item.role], code: 'AGT-' + String(index + 1).padStart(3, '0'),
      status: item.paused ? 'paused' : collaborating.has(item.id) ? 'collaborating' :
        inUse.has(item.id) ? 'running' : online.has(item.id) ? 'online' : 'offline'}));
    return [...humans, ...ai];
  }

  const statusNames = {online:'在线', offline:'离线', running:'执行中', paused:'已暂停', collaborating:'协作中', approval:'待审批'};
  const statusLabel = status => label('● ' + (statusNames[status] ?? status), ['online','running','collaborating'].includes(status) ? 'green' :
    ['paused','approval'].includes(status) ? 'warn' : '');

  function employeeRows(all, state) {
    return all.filter(person => (state.tab === 'all' || person.type === state.tab) && (!state.team || person.teamId === state.team) &&
      (!state.status || person.status === state.status) && (!state.q || (person.name + ' ' + person.code + ' ' + person.title).toLowerCase().includes(state.q.toLowerCase())));
  }

  function filters(state, variant, modelOptions = []) {
    const selectOptions = (title, options, current, field) =>
      `<span class="select-control"><select aria-label="${title}" data-ws-filter="${variant}" data-field="${field}"><option value="">${title}</option>
      ${options.map(([id, text]) => `<option value="${escape(id)}"${current === id ? ' selected' : ''}>${escape(text)}</option>`).join('')}</select></span>`;
    return `<div class="symbio-filters">${selectOptions('所有团队', data().teams.map(team => [team.id, team.name]), state.team, 'team')}
      ${variant === 'employees' ? selectOptions('所有状态', Object.entries(statusNames), state.status, 'status') : selectOptions('所有模型', modelOptions, state.model, 'model')}
      <input type="search" data-ws-filter="${variant}" data-field="q" value="${escape(state.q)}" aria-label="搜索${variant === 'employees' ? '员工' : 'Agent'}" placeholder="${variant === 'employees' ? '搜索姓名…' : '搜索 Agent…'}"></div>`;
  }

  function tabs(entries, active, action) {
    return `<div class="symbio-tabs">${entries.map(([id, title]) =>
      `<button type="button" data-action="${action}" data-id="${id}"${active === id ? ' aria-current="true"' : ''}>${escape(title)}</button>`).join('')}</div>`;
  }

  function employeeDetail(snapshot, selected) {
    if (!selected) return panel('员工详情', empty('选择一名员工，查看团队、任务及权限。'), '', 'symbio-person-detail');
    const assigned = snapshot.tasks.filter(task => (selected.type === 'human' ? task.humanId : task.assigneeId) === selected.id);
    const work = assigned.filter(task => task.status === 'in_progress').length;
    const completed = assigned.filter(task => task.status === 'done').length;
    const partnerIds = new Set(assigned.map(task => task.assigneeId).filter(id => id && id !== selected.id));
    const partners = roster(snapshot).filter(person => person.type === 'agent' && partnerIds.has(person.id));
    const action = selected.type === 'human' ? 'ws-human-edit' : 'agent-edit';
    return panel('员工详情', `<div class="symbio-person-name"><h3>${escape(selected.name)}</h3>${statusLabel(selected.status)}</div>
      <p class="symbio-muted">${escape(selected.title)} / ${escape(name('teams', selected.teamId))}</p>
      <p class="symbio-muted">${escape(selected.email || (selected.type === 'agent' ? 'Agent · ' + selected.code : '—'))}</p>
      <div class="symbio-detail-part"><div class="symbio-inline"><h3>当前工作负载</h3><span>${percent(work, assigned.length)}%</span></div>
        ${progress(percent(work, assigned.length), '工作负载')}<div class="symbio-inline symbio-muted"><span>${work} 项进行中</span><span>已完成 ${completed} 项</span></div></div>
      <div class="symbio-detail-part partners"><div class="symbio-inline"><h3>协作 Agent</h3>${link('ws-agents', '管理绑定 →')}</div>
        ${partners.length ? partners.map(person => `<div class="symbio-inline"><div><strong>${escape(person.name)}</strong><small>${escape(person.title)}</small></div>${statusLabel(person.status)}</div>`).join('') : empty('暂无共同指派的 Agent。')}</div>
      <div class="symbio-detail-part symbio-inline"><span class="symbio-muted">角色权限</span>${label(selected.type === 'human' ? '真人档案' : selected.runtime === 'observed' ? '仅采集' : selected.sandbox === 'workspace-write' ? '工作目录可写' : '只读执行')}</div>`,
      link(action, '···', selected.id), 'symbio-person-detail');
  }

  function people() {
    const snapshot = data();
    const all = roster(snapshot);
    const humans = all.filter(person => person.type === 'human');
    const ai = all.filter(person => person.type === 'agent');
    const list = employeeRows(all, employee);
    const pageCount = Math.max(1, Math.ceil(list.length / 8));
    employee.page = Math.min(employee.page, pageCount);
    const rows = list.slice((employee.page - 1) * 8, employee.page * 8);
    const selected = rows.find(person => person.id === employee.selected) ?? rows[0];
    const assigned = snapshot.tasks.filter(task => task.humanId || task.assigneeId);
    const hybrid = assigned.filter(task => task.humanId && task.assigneeId);
    const directory = panel('员工目录',
      `<div class="symbio-employee-controls">${tabs([['all','全部 ' + all.length], ['human','真人 ' + humans.length], ['agent','Agent ' + ai.length]], employee.tab, 'ws-employee-tab')}
      ${filters(employee, 'employees')}</div>
      <div class="symbio-scroll-table"><table class="symbio-table symbio-directory"><thead><tr><th>员工 / 标识</th><th>类型</th><th>所属团队</th><th>状态</th><th>当前任务</th><th>操作</th></tr></thead>
      <tbody>${rows.map(person => {
        const task = snapshot.tasks.find(task => task.status === 'in_progress' && (person.type === 'human' ? task.humanId : task.assigneeId) === person.id);
        return `<tr${person.id === selected?.id ? ' class="selected"' : ''}><td>${link('ws-person', person.name, person.id)}
          <small>${escape(person.code + ' · ' + person.title)}</small></td><td>${label(person.type === 'human' ? '真人' : 'Agent', person.type === 'human' ? 'violet' : 'green')}</td>
          <td>${escape(name('teams', person.teamId))}</td><td>${statusLabel(person.status)}</td><td>${task ? link('task-view', task.title, task.id) : '—'}</td>
          <td>${link(person.type === 'human' ? 'ws-human-edit' : 'agent-edit', '···', person.id)}</td></tr>`;
      }).join('')}</tbody></table>${!rows.length ? empty('没有匹配的员工。') : ''}</div>
      <footer class="symbio-directory-footer"><span>显示 ${list.length ? (employee.page - 1) * 8 + 1 : 0}–${Math.min(employee.page * 8, list.length)} 项，共 ${list.length} 位员工</span>
        <div>${link('ws-employee-page','‹',String(employee.page - 1))}<strong>${employee.page} / ${pageCount}</strong>${link('ws-employee-page','›',String(employee.page + 1))}</div></footer>`,
      '', 'symbio-employee-list');
    const distribution = snapshot.teams.map(team => {
      const members = all.filter(person => person.teamId === team.id);
      return `<div><div class="symbio-inline"><strong>${escape(team.name)}</strong><span>${members.filter(item => item.type === 'human').length} / ${members.filter(item => item.type === 'agent').length}</span></div>
        ${progress(percent(members.length, all.length), team.name + '员工占比')}</div>`;
    });
    return intro('5:13', '一个团队，无限协作可能。', '统一管理员工身份、团队归属与工作负载，让真人和 Agent 各尽所长。',
      blockButton('ws-export-people', '↓ 导出名单') + blockButton('ws-add-employee', '＋ 添加员工', '', 'primary'),
      metrics([['团队成员', all.length, '覆盖 ' + snapshot.teams.length + ' 个职能团队'], ['真人员工', humans.length, humans.filter(p => p.status === 'online').length + ' 人标记在线'],
        ['Agent 员工', ai.length, ai.filter(p => p.status !== 'offline' && p.status !== 'paused').length + ' 个当前可用'], ['人机协作率', percent(hybrid.length, assigned.length) + '%', '共同指派任务占比']]) +
      `<div class="symbio-people-grid">${directory}${employeeDetail(snapshot, selected)}</div>
      <section class="symbio-panel symbio-team-distribution"><div><h2>团队分布</h2><p class="symbio-muted">真人 / Agent</p></div>
        ${distribution.join('') || empty('暂无小组。')}</section>`, 'symbio-people');
  }

  function agentPage() {
    const snapshot = data();
    const all = roster(snapshot).filter(person => person.type === 'agent');
    const work = activeRuns(snapshot);
    const active = new Set(work.filter(run => run.status === 'running').map(run => run.agentId));
    const approval = snapshot.candidates.filter(item => item.status === 'review');
    const reviews = new Set(snapshot.tasks.filter(task => task.status === 'review').map(task => task.assigneeId));
    const now = today();
    const recent = snapshot.runs.filter(run => (run.endedAt || run.startedAt) && dateKey(run.endedAt || run.startedAt) === now);
    const terminal = recent.filter(run => ['completed','failed','interrupted'].includes(run.status));
    const usage = recent.reduce((sum, run) => sum + (run.usage?.totalTokens ?? 0), 0);
    const budget = snapshot.ledger.find(item => item.scope === 'company');
    const filtered = all.filter(agent => (agents.tab === 'all' ||
      (agents.tab === 'running' && active.has(agent.id)) || (agents.tab === 'paused' && agent.paused) ||
      (agents.tab === 'approval' && reviews.has(agent.id))) &&
      (!agents.team || agent.teamId === agents.team) && (!agents.model || (agent.model || agent.runtime) === agents.model) &&
      (!agents.q || agent.name.toLowerCase().includes(agents.q.toLowerCase())));
    const modelOptions = [...new Set(all.map(agent => agent.model || agent.runtime))].map(model => [model, model]);
    const cards = filtered.map((agent, index) => {
      const runs = terminal.filter(run => run.agentId === agent.id);
      const current = work.filter(run => run.agentId === agent.id);
      const task = current.find(run => run.status === 'running');
      const review = snapshot.tasks.find(task => task.status === 'review' && task.assigneeId === agent.id);
      const agentUsage = recent.filter(run => run.agentId === agent.id).reduce((sum, run) => sum + (run.usage?.totalTokens ?? 0), 0);
      const currentStatus = review && !task ? 'approval' : agent.status;
      const tint = currentStatus === 'approval' ? 'warn' : ['green','violet','sand','green','blue','warn'][index % 6];
      return `<article class="symbio-panel symbio-agent-card"><header><span class="symbio-agent-icon ${tint}">
        <img src="/office-assets/${tint === 'warn' ? 'agent-agent1' : 'agent-agent'}.svg" alt=""></span>
        <div><h2>${escape(agent.name)}</h2><p>${escape(agent.title)}</p></div>${statusLabel(currentStatus)}</header>
        <div class="symbio-agent-model">${label(agent.model || ({demo:'演示运行器',codex:'Codex 默认',pi:'Pi 默认',observed:'仅采集'})[agent.runtime] || agent.runtime)}
          <span>团队 · ${escape(name('teams', agent.teamId))}</span></div>
        <p class="symbio-agent-activity">${escape(task ? find('tasks', task.taskId)?.title || task.activity : review?.title || agent.scope || '暂无执行任务')}</p>
        <div class="symbio-agent-stats"><div><strong>${runs.length ? percent(runs.filter(r => r.status === 'completed').length, runs.length) + '%' : '—'}</strong><small>成功率</small></div>
          <div><strong>${number(agentUsage)}</strong><small>今日 Token</small></div><div><strong>${current.filter(run => run.status !== 'queued').length} 项</strong><small>执行中任务</small></div></div>
        <footer>${link('agent-edit', '查看配置 →', agent.id)}${review ? link('task-view', '处理验收', review.id) :
          agent.runtime !== 'observed' ? link('ws-agent-pause', agent.paused ? '▷ 恢复派发' : 'Ⅱ 暂停', agent.id) : link('goto-discovery', '查看来源')}</footer></article>`;
    });
    if (agents.tab === 'approval') cards.push(...approval.filter(candidate => !agents.team || candidate.draft?.teamId === agents.team)
      .filter(candidate => !agents.q || (candidate.draft?.name || '').toLowerCase().includes(agents.q.toLowerCase()))
      .map(candidate => `<article class="symbio-panel symbio-agent-card">
        <header><span class="symbio-agent-icon warn"><img src="/office-assets/agent-agent1.svg" alt=""></span>
          <div><h2>${escape(candidate.draft?.name || candidate.provider)}</h2><p>候选 Agent</p></div>${statusLabel('approval')}</header>
        <p class="symbio-agent-activity">${escape(candidate.draft?.scope || '等待确认入职档案')}</p>
        <footer>${link('candidate-review', '查看档案', candidate.id)}${link('candidate-approve', '处理审批 →', candidate.id)}</footer></article>`));
    return intro('5:17', '你的 AI 团队，正在持续进化。', '配置 Agent 的能力、模型与权限，追踪每一次执行和交接。',
      blockButton('ws-runs', '运行记录') + blockButton('agent-edit', '＋ 创建 Agent', '', 'primary'),
      metrics([['在线 Agent', all.filter(person => !['offline','paused'].includes(person.status)).length + ' / ' + all.length,
        all.filter(person => ['offline','paused'].includes(person.status)).length + ' 个离线或已暂停'],
        ['今日执行成功率', terminal.length ? percent(terminal.filter(run => run.status === 'completed').length, terminal.length) + '%' : '—', terminal.length + ' 项执行已结束'],
        ['今日 Token 消耗', number(usage), budget?.limit > 0 ? '预算使用率 ' + percent(budget.spent,budget.limit) + '%' : '预算未设置'],
        ['待人工审批', pad(approval.length + [...reviews].filter(Boolean).length), '入职审批与任务验收', 'alert']]) +
      `<div class="symbio-agent-controls">${tabs([['all','全部 Agent ' + all.length], ['running','运行中 ' + active.size],
        ['approval','待审批 ' + (approval.length + [...reviews].filter(Boolean).length)], ['paused','已暂停 ' + all.filter(item => item.paused).length]], agents.tab, 'ws-agent-tab')}
        ${filters(agents, 'agents', modelOptions)}</div><div class="symbio-agent-grid">${cards.join('') || empty('没有匹配的 Agent。')}</div>
        <section class="symbio-governance"><div><h2>安全始终由你掌控</h2><p>在配置中管理 Agent 的工具权限、运行器和文件访问范围。</p></div>
          ${blockButton('goto-discovery', '发现与入职')}${blockButton('ws-policy', '管理权限策略 →')}</section>`, 'symbio-agents');
  }

  function editableLayout() {
    const source = data().layout;
    if (!source) return null;
    if (!layoutDraft || (!layoutDirty && source.revision > layoutRevision)) {
      layoutRevision = source.revision;
      layoutDraft = structuredClone(source.draft);
      selectedZone = layoutDraft.zones.some(zone => zone.id === selectedZone) ? selectedZone : layoutDraft.zones[0].id;
    }
    return layoutDraft;
  }

  function layoutSceneZones() {
    return editableLayout().zones.map(zone => {
      const [originX,originZ] = sceneZoneOrigins[zone.type];
      const [planX,planY] = templatePositions.open[zone.type];
      return {id:zone.id, name:zone.name, visible:zone.visible, selected:zone.id === selectedZone,
        x:clamp(originX + (zone.x-planX)*.20,-8.8,9), z:clamp(originZ + (zone.y-planY)*.17,-6.6,7.3)};
    });
  }

  const officeViewport = (id, preview, label) => `<div id="${id}" class="office-3d-viewport"
    data-layout-preview="${preview}" aria-label="${label}"><p class="office-scene-loading">正在载入 3D 办公室…</p></div>`;

  function workstations(snapshot) {
    const count = snapshot.workstationCount ?? baseWorkstations;
    const staff = [
      ...snapshot.agents.map(person => ({...person, kind:'agent'})),
      ...snapshot.humans.map(person => ({...person, kind:'human'})),
    ];
    const assigned = new Map(staff.filter(person => Number.isInteger(person.seatIndex))
      .map(person => [person.seatIndex, person]));
    const rows = Array.from({length:count}, (_, index) => {
      const person = assigned.get(index);
      const key = person && person.kind + ':' + person.id;
      const caption = `<span>${workstationLabel(index)}</span><strong>${escape(person?.name ?? '空置')}</strong>
        <small>${person ? person.kind === 'agent' ? 'Agent' : '真人' : '可分配'}</small>`;
      return person ? `<li><button type="button" data-action="office-person" data-id="${escape(key)}"
        aria-pressed="${ui.selectedOfficeActor() === key}">${caption}</button></li>` : `<li><div>${caption}</div></li>`;
    }).join('');
    return `<div class="symbio-workstation-grid">
      <section class="symbio-panel symbio-workstation-preview">
        <header class="symbio-panel-head"><h2>3D 工位预览</h2>
          <div class="symbio-workstation-controls">
            <button type="button" data-action="office-orbit" data-id="-1" aria-label="向左旋转">↶</button>
            <button type="button" data-action="office-orbit" data-id="1" aria-label="向右旋转">↷</button>
            <button type="button" data-action="office-zoom-out" aria-label="缩小">−</button>
            <button type="button" data-action="office-zoom-reset" aria-label="还原">还原</button>
            <button type="button" data-action="office-zoom-in" aria-label="放大">＋</button>
          </div></header>
        ${officeViewport('office-3d-viewport','seats','3D 工位预览')}
      </section>
      ${panel('工位分配', `<p class="symbio-muted">${count} 个工位 · ${assigned.size} 个已分配 · ${count-assigned.size} 个空置</p>
        <ul class="symbio-workstation-roster">${rows}</ul>`, blockButton('ws-workstations-add','＋ 新增工位','','primary'))}
    </div>`;
  }

  function layoutEditor() {
    const draft = editableLayout();
    if (!draft) return empty('请重启服务以加载布局管理。');
    const snapshot = data();
    const layout = snapshot.layout;
    const model = officeOverview(snapshot, null);
    const roomOccupancy = zone => zone.autoAssign
      ? Math.min(zone.capacity, model.rooms[zone.type].filter(person => !zone.teamId || person.teamId === zone.teamId).length) : 0;
    const selected = draft.zones.find(zone => zone.id === selectedZone) ?? draft.zones[0];
    const toolRow = `<div class="symbio-layout-tabs">${tabs([['space','空间布局'],['seats','工位管理'],['widgets','监控组件']], layoutTab, 'ws-layout-tab')}
      <div>${blockButton('ws-layout-name', draft.title, '', 'chevron-trigger')}${label(layoutDirty ? '待保存' : layout.publishedAt ? '已发布' : '默认布局', 'green')}</div></div>`;
    const regionPanel = panel('空间区域',
      `<p class="symbio-muted">${draft.zones.length} 个区域 · ${draft.zones.reduce((sum, zone) => sum + zone.capacity, 0)} 人区域总容量</p>
      <div class="symbio-zones">${draft.zones.map((zone, index) =>
        `<button type="button" data-action="ws-zone" data-id="${escape(zone.id)}" aria-pressed="${zone.id === selected.id}">
          <span>${pad(index + 1)}</span><span><strong>${escape(zone.name)}</strong>
          <small>${zone.capacity} 个席位 · ${roomOccupancy(zone) ? roomOccupancy(zone) + ' 人在线' : '当前空闲'}</small></span></button>`).join('')}</div>
      <div class="symbio-zone-tools"><h3>可添加组件</h3><div>${Object.entries(zoneNames).map(([type, title]) =>
        blockButton('ws-zone-add', '＋ ' + (type === 'work' ? '工位区' : title), type)).join('')}</div></div>`,
      link('ws-zone-add', '＋', 'work'), 'symbio-region-panel');
    const previews = `<div class="symbio-layout-switch">${blockButton('ws-layout-view', '3D 视图', '3d', layoutView === '3d' ? 'selected' : '')}
      ${blockButton('ws-layout-view', '平面视图', 'plan', layoutView === 'plan' ? 'selected' : '')}</div>`;
    const canvas = `<section class="symbio-panel symbio-layout-preview"><header class="symbio-panel-head"><h2>布局预览</h2>${previews}${link('ws-layout-preview', '↗ 预览')}</header>
      ${layoutView === '3d' ? `<div class="symbio-layout-stage symbio-layout-stage-3d">
        ${officeViewport('office-3d-viewport','space','3D 空间布局')}
      </div>
      <footer><span>选择区域查看属性</span><div class="symbio-workstation-controls">
        <button type="button" data-action="office-orbit" data-id="-1" aria-label="向左旋转">↶</button>
        <button type="button" data-action="office-orbit" data-id="1" aria-label="向右旋转">↷</button>
        <button type="button" data-action="office-zoom-out" aria-label="缩小">−</button>
        <button type="button" data-action="office-zoom-reset" aria-label="还原视角">还原</button>
        <button type="button" data-action="office-zoom-in" aria-label="放大">＋</button>
      </div></footer>` : `<div class="symbio-layout-stage floor-plan">
        <div class="symbio-layout-art" data-zoom="${layoutZoom}">
          <div class="symbio-plan-grid" aria-hidden="true"></div>
          ${draft.zones.map(zone => `<button type="button" class="symbio-layout-zone${zone.id === selected.id ? ' selected' : ''}"
            data-action="ws-zone" data-id="${escape(zone.id)}" data-layout-zone="${escape(zone.id)}">${escape(zone.name)}</button>`).join('')}
        </div>
        <p class="symbio-muted">拖动区域调整位置。</p>
      </div>
      <footer><span>平面网格</span><div>${link('ws-layout-zoom','−','-10')}<span>${layoutZoom}%</span>${link('ws-layout-zoom','＋','10')}</div></footer>`}
      </section>`;
    const teams = [['', '未分配'], ...snapshot.teams.map(team => [team.id, team.name])];
    const properties = panel('区域属性', `<div class="symbio-zone-properties">
      <div>${label(selected.name, 'green')}</div>
      <label>区域名称<input data-zone-field="name" maxlength="36" value="${escape(selected.name)}"></label>
      <label>区域类型<span class="select-control"><select data-zone-field="type">${Object.entries(zoneNames).map(([type, title]) =>
        `<option value="${type}"${type === selected.type ? ' selected' : ''}>${title}</option>`).join('')}</select></span></label>
      <div><p>席位容量</p><div class="symbio-seat-stepper">${link('ws-zone-seat','−','-1')}<span>${selected.capacity} 个席位</span>${link('ws-zone-seat','＋','1')}</div></div>
      <label>分配团队<span class="select-control"><select data-zone-field="teamId">${teams.map(([id, title]) =>
        `<option value="${escape(id)}"${id === (selected.teamId ?? '') ? ' selected' : ''}>${escape(title)}</option>`).join('')}</select></span></label>
      <div class="symbio-zone-toggles"><label>在实时大屏中显示<input data-zone-field="visible" type="checkbox" role="switch"${selected.visible ? ' checked' : ''}></label>
        <label>允许 Agent 自动入驻<input data-zone-field="autoAssign" type="checkbox" role="switch"${selected.autoAssign ? ' checked' : ''}></label></div>
      <p>已分配 ${roomOccupancy(selected)} / ${selected.capacity} 个席位 · 剩余 ${Math.max(0, selected.capacity - roomOccupancy(selected))} 个</p>
      </div>`, '', 'symbio-region-properties');
    const templatesSection = `<section class="symbio-templates"><header><h2>从模板开始</h2><span>保留现有成员与区域分配，仅替换空间布局。</span></header>
      <div>${templates.map(([id, title, description]) => `<article class="symbio-panel symbio-template${draft.template === id ? ' selected' : ''}">
        <div class="symbio-template-art ${id}" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div><h3>${title}</h3><p>${description}</p></div>
        ${draft.template === id ? '<strong>当前使用</strong>' : link('ws-layout-template','应用模板 →',id)}</article>`).join('')}</div></section>`;
    const widgets = panel('监控组件', `<div class="symbio-widget-settings">${[
      ['metrics','关键指标','展示在线员工、执行中任务、完成数和人工介入'],['activity','协作动态','展示最近的任务与协作事件'],
      ['attention','需要你关注','展示验收、入职和截止提醒'],
    ].map(([key, title, description]) => `<label><span><strong>${title}</strong><small>${description}</small></span>
      <input type="checkbox" role="switch" data-widget="${key}"${draft.widgets[key] ? ' checked' : ''}></label>`).join('')}</div>`);
    return intro('5:21', '为协作，留出更好的空间。', '编排数字办公室的区域、席位与监控组件，构建适合团队的工作现场。',
      layoutTab === 'seats' ? '' : `<span class="symbio-muted">${layoutDirty ? '有未保存的修改' : layout.savedAt ? '已保存于 ' + escape(localTime(layout.savedAt).slice(0, 5)) : '工作空间布局'}</span>` +
        blockButton('ws-layout-save','保存草稿') + blockButton('ws-layout-publish','发布布局 ↗','','primary'),
      toolRow + (layoutTab === 'space' ? `<div class="symbio-layout-grid">${regionPanel}${canvas}${properties}</div>${templatesSection}`
        : layoutTab === 'seats' ? workstations(snapshot) : widgets),
      'symbio-layout');
  }

  function help() {
    return intro('help', '帮助中心', '管理项目、团队、Agent 和数字办公室。',
      '', `<div class="symbio-help-grid">${[
      ['项目与任务','创建项目，分配任务并验收 Agent 交付。','tasks'],
      ['员工与小组','维护真人档案、Agent 员工和团队归属。','people'],
      ['运行与采集','配对异机采集客户端，扫描来源并审批入职。','discovery'],
      ['办公室布局','编辑区域与组件，保存草稿或发布到实时监控。','layout'],
      ['工作空间设置','管理运行策略、标签、通知及个人偏好。','settings'],
      ['协作会话','发起双人交流或多人会议，并查看发言记录。','conversations'],
    ].map(([title, description, target]) => panel(title, `<p class="symbio-muted">${description}</p>`, link('ws-nav','打开 →',target))).join('')}</div>`,
    'symbio-help');
  }

  function hydrate() {
    const draft = layoutDraft;
    if (draft) document.querySelectorAll('[data-layout-zone]').forEach(button => {
      const zone = draft.zones.find(item => item.id === button.dataset.layoutZone);
      if (zone) placeZone(button, zone);
    });
    const published = data().layout?.published;
    if (published) {
      document.querySelectorAll('[data-published-zone]').forEach(button => {
        const zone = published.zones.find(item => item.id === button.dataset.publishedZone);
        if (!zone) return;
        const original = templatePositions.open[zone.id];
        const reference = {work:[9.8,40],meeting:[51.5,25.1],ai:[66.4,65.4],lounge:[24.7,83.7]}[zone.id];
        const x = original && reference ? reference[0] + zone.x - original[0] : zone.x;
        const y = original && reference ? reference[1] + zone.y - original[1] : zone.y;
        placeZone(button, {x: Math.min(82,Math.max(1,x)), y:Math.min(88,Math.max(12,y))});
      });
    }
  }

  function placeZone(node, zone) {
    node.style.setProperty('--zone-x', zone.x + '%');
    node.style.setProperty('--zone-y', zone.y + '%');
  }

  function mutateLayout(fn) {
    fn(editableLayout());
    layoutDirty = true;
    render();
  }

  function searchResults() {
    const query = document.getElementById('workspace-search-input').value.trim().toLowerCase();
    const snapshot = data();
    const target = document.getElementById('workspace-search-results');
    const items = [
      ...snapshot.projects.map(item => ['project', item.id, item.name, '项目']),
      ...snapshot.tasks.map(item => ['task', item.id, taskKey(item) + ' ' + item.title, '任务']),
      ...(snapshot.humans ?? []).map(item => ['human', item.id, item.name, '真人员工']),
      ...snapshot.agents.map(item => ['agent', item.id, item.name, 'Agent']),
    ].filter(item => item[2].toLowerCase().includes(query)).slice(0, 18);
    target.innerHTML = query ? items.length ? `<div class="stack">${items.map(([kind,id,title,type]) =>
      blockButton('ws-search-result', type + ' · ' + title, kind + ':' + id)).join('')}</div>` : empty('没有匹配的内容。')
      : empty('输入关键词搜索项目、任务和员工。');
  }

  function humanEditor(id) {
    const person = find('humans', id) ?? {};
    edit(id ? '编辑真人员工' : '添加真人员工',
      input('姓名', 'name', person.name, {required:true}) + input('岗位', 'title', person.title, {required:true}) +
      input('邮箱', 'email', person.email, {type:'email'}) +
      select('团队', 'teamId', [['','未分配'], ...data().teams.map(team => [team.id, team.name])], person.teamId) +
      select('可用状态', 'availability', [['offline','离线'],['online','在线']], person.availability ?? 'offline') +
      avatarFields(person),
      form => api('humans', {...Object.fromEntries(form), id}));
  }

  function editSchedule(id) {
    const item = find('schedules', id) ?? {};
    const localInput = value => {
      const date = new Date(value);
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    edit(id ? '编辑日程' : '新建日程',
      input('日程名称', 'title', item.title, {required:true}) +
      input('开始时间（本机）', 'startAt', item.startAt ? localInput(item.startAt) : (selectedDay ?? today()) + 'T09:00',
        {type:'datetime-local',required:true}) + input('参与者', 'participants', item.participants),
      form => api('schedules', {id,title:form.get('title'),participants:form.get('participants'),
        startAt:new Date(form.get('startAt')).toISOString()}));
  }

  function exportPeople() {
    const csv = value => {
      let safe = String(value ?? '');
      if (/^[=+\-@\t\r]/.test(safe)) safe = "'" + safe;
      return '"' + safe.replaceAll('"','""') + '"';
    };
    const rows = [['姓名','标识','类型','岗位','团队','状态'], ...roster(data()).map(item =>
      [item.name,item.code,item.type === 'human' ? '真人' : 'Agent',item.title,name('teams',item.teamId),statusNames[item.status]])];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(csv).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'}));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'Symbio-员工名单.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function action(type, id) {
    if (!type.startsWith('ws-')) return false;
    switch (type) {
      case 'ws-nav': navigate(id); break;
      case 'ws-agents': navigate('agents'); break;
      case 'ws-policy': navigate('settings', 'organization'); break;
      case 'ws-mobile-menu':
        mobileOpen = !mobileOpen;
        document.body.classList.toggle('symbio-mobile-open', mobileOpen);
        document.querySelector('.symbio-mobile-menu').setAttribute('aria-expanded', String(mobileOpen));
        break;
      case 'ws-search': {
        ui.openModal('workspace-search');
        searchResults();
        document.getElementById('workspace-search-input').focus();
        break;
      }
      case 'ws-search-result': {
        document.getElementById('workspace-search').close();
        const [kind, recordId] = id.split(':');
        if (kind === 'project') editNamed('project', recordId);
        else if (kind === 'human') humanEditor(recordId);
        else if (kind === 'agent') await ui.action('agent-edit', recordId);
        else await ui.action('task-view', recordId);
        break;
      }
      case 'ws-profile':
        ui.showPanel(data().user.name,
          `<div class="stack">${blockButton('account-open','我的账户')}
          ${data().user.role === 'admin' ? blockButton('account-users','用户管理') + blockButton('ws-nav','工作空间设置','settings') +
          blockButton('ws-nav','财务账本','finance') + blockButton('ws-nav','发现与入职','discovery') +
          blockButton('ws-nav','协作会话','conversations') : ''}
          ${blockButton('account-logout','退出登录')}</div>`);
        break;
      case 'ws-period': period = period === 7 ? 30 : 7; render(); break;
      case 'ws-all-tasks': navigate('tasks', 'all'); break;
      case 'ws-projects': ui.showPanel('所有项目', projectTable(projectRows(data()))); break;
      case 'ws-month': calendarOffset = Math.max(-60, Math.min(60, calendarOffset + Number(id))); render(); break;
      case 'ws-day': selectedDay = id; render(); break;
      case 'ws-schedule-edit': editSchedule(id); break;
      case 'ws-employee-tab': employee.tab = id; employee.page = 1; render(); break;
      case 'ws-employee-page': employee.page = Math.max(1,Number(id)); render(); break;
      case 'ws-person': employee.selected = id; render(); break;
      case 'ws-add-employee':
        ui.showPanel('添加员工', `<div class="stack">${blockButton('ws-human-edit','添加真人员工')}
          ${blockButton('agent-edit','创建 Agent 员工')}${blockButton('goto-discovery','从已发现的 Agent 入职')}</div>`);
        break;
      case 'ws-human-edit': humanEditor(id); break;
      case 'ws-export-people': exportPeople(); break;
      case 'ws-agent-tab': agents.tab = id; render(); break;
      case 'ws-agent-pause': {
        const agent = find('agents', id);
        if (agent.paused) await api('agents/' + id + '/dispatch',{paused:false});
        else edit('暂停 Agent 派发', '<p>排队的任务将等待恢复，正在运行的执行可以继续完成。</p>',
          () => api('agents/' + id + '/dispatch',{paused:true}), '暂停派发');
        break;
      }
      case 'ws-runs': ui.showPanel('运行记录', ui.runTable(data().runs.slice(0,80))); break;
      case 'ws-layout-tab': navigate('layout',id); break;
      case 'ws-workstations-add':
        edit('新增工位', input('数量','amount',1,{type:'number',min:1,max:24,required:true}) +
          '<p class="description">新增工位会同步到实时监控，并优先分配给后续入职的员工。</p>',
        form => api('layout/workstations',{amount:Number(form.get('amount'))}), '新增工位');
        break;
      case 'ws-layout-view': layoutView = id; render(); break;
      case 'ws-layout-zoom': layoutZoom = Math.max(60,Math.min(120,layoutZoom + Number(id))); render(); break;
      case 'ws-zone': selectedZone = id; render(); break;
      case 'ws-zone-add': {
        if (editableLayout().zones.length >= 16) throw new Error('最多可配置 16 个区域');
        mutateLayout(draft => {
          selectedZone = 'zone-' + crypto.randomUUID();
          const [x,y] = templatePositions.open[id];
          draft.zones.push({id:selectedZone,type:id,name:zoneSeeds[id] + ' ' + (draft.zones.length + 1),
            capacity:8,x:Math.min(75,x + 4),y:Math.min(85,y + 5),teamId:null,visible:true,autoAssign:true});
        });
        break;
      }
      case 'ws-zone-seat': mutateLayout(draft => {
        const zone = draft.zones.find(item => item.id === selectedZone);
        zone.capacity = Math.max(1,Math.min(500,zone.capacity + Number(id)));
      }); break;
      case 'ws-layout-name': edit('空间名称', input('名称','title',editableLayout().title,{required:true}),
        form => mutateLayout(draft => { draft.title = form.get('title').trim(); })); break;
      case 'ws-layout-template': mutateLayout(draft => {
        draft.template = id;
        const counts = {};
        for (const zone of draft.zones) {
          const [x,y] = templatePositions[id][zone.type];
          const offset = counts[zone.type] ?? 0;
          zone.x = Math.min(82,x + 2 * offset);
          zone.y = Math.min(88,y + 5 * offset);
          counts[zone.type] = offset + 1;
        }
      }); break;
      case 'ws-layout-preview': {
        const draft = editableLayout();
        ui.showPanel('布局预览 · ' + draft.title,
          `<div class="symbio-layout-stage symbio-layout-stage-3d symbio-layout-modal">
            ${officeViewport('office-layout-dialog-viewport','space','3D 布局预览')}
          </div>
          <div class="stack">${draft.zones.map(zone => `<div class="symbio-inline"><strong>${escape(zone.name)}</strong><span>${zone.capacity} 个席位</span></div>`).join('')}</div>`);
        break;
      }
      case 'ws-layout-save':
      case 'ws-layout-publish': {
        const saved = await api('layout/' + (type === 'ws-layout-save' ? 'draft' : 'publish'), {
          revision:layoutRevision,draft:editableLayout(),
        });
        layoutRevision = saved.revision;
        layoutDraft = structuredClone(saved.draft);
        layoutDirty = false;
        break;
      }
      default: return false;
    }
    return true;
  }

  function bind() {
    document.getElementById('workspace-search-input').addEventListener('input', searchResults);
    document.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && data() && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        ui.action('ws-search');
      }
    });
    document.addEventListener('input', event => {
      const element = event.target;
      const filter = element.dataset.wsFilter;
      if (!filter || element.tagName !== 'INPUT') return;
      const state = filter === 'employees' ? employee : agents;
      state.q = element.value;
      if (filter === 'employees') employee.page = 1;
      const position = element.selectionStart;
      render();
      const next = document.querySelector(`input[data-ws-filter="${filter}"]`);
      next?.focus();
      if (next && position != null) next.setSelectionRange(position,position);
    });
    document.addEventListener('change', event => {
      const element = event.target;
      const filter = element.dataset.wsFilter;
      if (filter && element.tagName === 'SELECT') {
        const state = filter === 'employees' ? employee : agents;
        state[element.dataset.field] = element.value;
        if (filter === 'employees') employee.page = 1;
        render();
      }
      if (element.dataset.zoneField) {
        const key = element.dataset.zoneField;
        const value = element.type === 'checkbox' ? element.checked : element.value.trim();
        if (key === 'name' && !value) { render(); return; }
        mutateLayout(draft => {
          const zone = draft.zones.find(item => item.id === selectedZone);
          zone[key] = value;
        });
      }
      if (element.dataset.widget) mutateLayout(draft => { draft.widgets[element.dataset.widget] = element.checked; });
    });
    document.addEventListener('pointerdown', event => {
      const button = event.target.closest('[data-layout-zone]');
      if (!button || event.button !== 0) return;
      const box = button.parentElement.getBoundingClientRect();
      const zone = editableLayout().zones.find(item => item.id === button.dataset.layoutZone);
      drag = {button,box,zone,initialX:event.clientX,initialY:event.clientY,x:zone.x,y:zone.y,moved:false};
      button.setPointerCapture(event.pointerId);
    });
    document.addEventListener('pointermove', event => {
      if (!drag) return;
      const dx = event.clientX - drag.initialX, dy = event.clientY - drag.initialY;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      drag.moved = true;
      drag.x = Math.round(Math.max(0,Math.min(82,drag.zone.x + dx * 100 / drag.box.width)));
      drag.y = Math.round(Math.max(6,Math.min(88,drag.zone.y + dy * 100 / drag.box.height)));
      placeZone(drag.button, drag);
    });
    document.addEventListener('pointerup', () => {
      if (!drag) return;
      const completed = drag;
      drag = undefined;
      if (!completed.moved) return;
      completed.zone.x = completed.x;
      completed.zone.y = completed.y;
      selectedZone = completed.zone.id;
      layoutDirty = true;
      render();
    });
    document.addEventListener('pointercancel', () => {
      drag = undefined;
      hydrate();
    });
  }

  function closeMobile() {
    mobileOpen = false;
    document.body.classList.remove('symbio-mobile-open');
    document.querySelector('.symbio-mobile-menu').setAttribute('aria-expanded','false');
  }

  return {renderShell, workbench, people, agentPage, layoutEditor, layoutSceneZones, help, action, hydrate, bind,
    selectLayoutTab(tab) { layoutTab = ['seats','widgets'].includes(tab) ? tab : 'space'; },
    dragging: () => Boolean(drag), closeMobile};
}
