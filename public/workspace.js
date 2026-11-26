import { executionAdapterStatus, agentAuthorization, agentCanExecute } from './agent-permissions.js';
import { officeOverview } from './overview.js';
import { avatarFields } from './office-avatars.js';
import {
  baseWorkstations, customSeatIndexStart, workstationLabel, officePresence, privateOfficeSeatIndex,
  physicalZoneCapacity, workstationZoneType, zoneWorkstationIndices, workstationPosition,
} from './office-presence.js';
import {
  floorPalette, furnitureCatalog, furnitureByType, normalizeFloor, normalizeRotation, rugPalette,
  validateDoorPlacement, validateFloorPlacement, validateItemPlacement, validateRugPlacement,
  validateWallPlacement, wallAxis, wallLength, wallPalette,
} from './office-furniture.js';

import { navigationGroups, navigationFooter, navigationIcon, navigationLocation, settingsTitles } from './navigation.js';

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
const templateCapacities = {
  open: {work: 20, meeting: 10, ai: 20, lounge: 14},
  delivery: {work: 28, meeting: 8, ai: 32, lounge: 8},
  distributed: {work: 12, meeting: 16, ai: 24, lounge: 16},
};
const sceneZoneOrigins = {work:[-3.2,.55], meeting:[6.45,-5.65], ai:[6.6,-.95], lounge:[6.45,5.85]};
const clamp = (value, low, high) => Math.min(high,Math.max(low,value));
const pad = value => String(value).padStart(2, '0');
const shiftDate = (key, days) => new Date(Date.parse(key + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);

export function createWorkspaceView(ui) {
  const {data, escape, btn, input, select, empty, number, localTime, edit, api, render,
    navigate, find, name, editNamed, taskKey, workflowName, timeZone} = ui;
  let employee = {tab: 'all', team: '', status: '', q: '', page: 1, selected: ''};
  let agents = {tab: 'all', team: '', model: '', q: ''};
  let calendarOffset = 0, selectedDay, period = 7;
  let layoutDraft, layoutRevision, layoutDirty = false, layoutTab = 'space';
  let selectedZone;
  let decorDraft = null, decorDirty = false, decorHistory = [], decorFuture = [];
  let designTool = 'select', placingType = null, placingRotation = 0;
  let wallColor = 'sage', floorMaterial = 'carpet', rugColor = 'sand', selectedDecor = null;
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

  function renderShell(page, snapshot, child = '') {
    const mainNav = document.querySelector('.symbio-navigation');
    if (mainNav.dataset.role !== snapshot.user.role) {
      const allowed = item => snapshot.user.role === 'admin' || item.member;
      const entry = item => `<button type="button" ${item.action ? `data-action="${item.action}"` : `data-page="${item.page}" data-child="${item.child || ''}"`}
        title="${item.title}">${navigationIcon(item.icon)}<span>${item.title}</span></button>`;
      mainNav.innerHTML = navigationGroups.map(group => {
        const items = group.items.filter(allowed);
        return items.length ? `<div class="symbio-nav-group"><p>${group.name}</p>${items.map(entry).join('')}</div>` : '';
      }).join('');
      document.querySelector('.symbio-navigation-footer').innerHTML = navigationFooter.filter(allowed).map(entry).join('');
      mainNav.dataset.role = snapshot.user.role;
    }
    const location = navigationLocation(page, page === 'tasks' ? child : '');
    document.getElementById('breadcrumb-group').textContent = page === 'settings'
      ? (Object.entries(ui.settingsGroups).find(([,items]) => Object.hasOwn(items,child))?.[0] || '设置') : location.group;
    document.getElementById('breadcrumb-page').textContent = page === 'settings' ? settingsTitles[child] || '设置' : location.title;
    document.getElementById('top-operator').textContent = snapshot.user.name;
    document.getElementById('top-operator-role').textContent = snapshot.user.role === 'admin' ? '工作空间管理员' : '工作空间成员';
    const budget = snapshot.ledger.find(row => row.scope === 'company');
    const usage = budget?.limit > 0 ? percent(budget.spent, budget.limit) : null;
    document.getElementById('sidebar-quota-label').textContent = usage === null ? '—' : usage + '%';
    document.getElementById('sidebar-quota').value = Math.min(usage ?? 0, 100);
    const bell = document.querySelector('.symbio-bell');
    bell.setAttribute('aria-label', snapshot.unread ? `收件箱，${snapshot.unread} 条未读` : '收件箱');
    document.querySelectorAll('.symbio-navigation button, .symbio-navigation-footer button').forEach(button => {
      if (button.dataset.page === page && (page !== 'tasks' || button.dataset.child === child)) button.setAttribute('aria-current', 'page');
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
      <tbody>${rows.map(project => `<tr><td>${link('project-edit', project.name, project.id)}<small><span class="project-desc" title="${escape(project.description || '项目')}">${escape(project.description || '项目')}</span> · ${link('project-tasks', project.tasks + ' 项任务', project.id)}</small></td>
        <td>${label(project.status, project.status === '需关注' ? 'warn' : project.status === '待开始' ? '' : 'green')}</td>
        <td><div class="symbio-progress">${progress(project.progress, project.name + '完成进度', project.status === '需关注' ? 'warn' : '')}
          <small>${project.progress}%</small></div></td>
        <td>${escape(project.owner || '—')}</td><td>${escape(monthDay(project.dueDate))}</td>
        <td>${link('project-space', '工作区 →', project.id)}</td></tr>`).join('')}</tbody></table></div>`;
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
      <div class="actions">${blockButton('task-fullscreen', '↗ 大屏模式')}${blockButton('task-edit', '＋ 添加任务')}</div></header>
      <div class="symbio-board-columns">${columns.map(([state, title]) => {
        const items = mainTasks.filter(task => task.status === state || (state === 'todo' && task.status === 'blocked'));
        return `<section class="symbio-board-column"><header><strong>${state === 'review' ? '<span class="symbio-board-dot warn">●</span>' : '●'} ${escape(workflowName(state) ?? title)}</strong><span>${items.length}</span>
          ${link('task-edit', '＋')}</header><div>${items.map(task => `<button type="button" data-action="task-view" data-id="${escape(task.id)}" class="symbio-task">
            <strong>${escape(task.title)}</strong><small>${escape(assignedName(task))}</small><span>${label(name('projects', task.projectId))}
              <small>${escape(task.dueDate === now ? '今日截止' : monthDay(task.dueDate))}</small></span></button>`).join('') || empty('暂无任务')}</div></section>`;
      }).join('')}</div></section>`;
    return intro('5:9', '项目', `${greeting}，${operator}。未来 48 小时有 ${due.length} 项任务即将到期。`,
      blockButton('ws-period', periodText, '', 'chevron-trigger') + blockButton('project-edit', '＋ 新建项目', '', 'primary'),
      metrics([
        ['进行中项目', projects.filter(item => item.status === '进行中' || item.status === '需关注').length, projects.length + ' 个项目'],
        ['执行中任务', tasksRunning, tasksRunning + ' 项由 Agent 执行'],
        [periodText + '完成率', percent(periodTasks.filter(t => t.status === 'done').length, periodTasks.length) + '%', periodTasks.length + ' 项新任务'],
        ['即将截止', due.length, '未来 48 小时内', 'alert'],
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

  const seatLabelFor = person => person.officeRole === 'boss' ? '独立办公室'
    : Number.isInteger(person.seatIndex) ? workstationLabel(person.seatIndex) : '未分配';

  function employeeDetail(snapshot, selected) {
    if (!selected) return panel('员工详情', empty('选择一名员工，查看团队、任务及权限。'), '', 'symbio-person-detail');
    const assigned = snapshot.tasks.filter(task => (selected.type === 'human' ? task.humanId : task.assigneeId) === selected.id);
    const work = assigned.filter(task => task.status === 'in_progress').length;
    const completed = assigned.filter(task => task.status === 'done').length;
    const partnerIds = new Set(assigned.map(task => task.assigneeId).filter(id => id && id !== selected.id));
    const partners = roster(snapshot).filter(person => person.type === 'agent' && partnerIds.has(person.id));
    const action = selected.type === 'human' ? 'ws-human-edit' : 'agent-edit';
    const detailActions = `<div class="symbio-row-actions">${blockButton(action, '编辑资料', selected.id)}${selected.type === 'agent' ? blockButton('agent-permissions', '权限设置', selected.id) : ''}</div>`;
    return panel('员工详情', `<div class="symbio-person-name"><h3>${escape(selected.name)}</h3>${statusLabel(selected.status)}</div>
      <p class="symbio-muted">${escape(selected.title)} / ${escape(name('teams', selected.teamId))}</p>
      <p class="symbio-muted">${escape(selected.email || (selected.type === 'agent' ? 'Agent · ' + selected.code : '—'))}</p>
      <div class="symbio-detail-part"><div class="symbio-inline"><h3>当前工作负载</h3><span>${percent(work, assigned.length)}%</span></div>
        ${progress(percent(work, assigned.length), '工作负载')}<div class="symbio-inline symbio-muted"><span>${work} 项进行中</span><span>已完成 ${completed} 项</span></div></div>
      <div class="symbio-detail-part partners"><div class="symbio-inline"><h3>协作 Agent</h3>${link('ws-agents', '管理绑定 →')}</div>
        ${partners.length ? partners.map(person => `<div class="symbio-inline"><div><strong>${escape(person.name)}</strong><small>${escape(person.title)}</small></div>${statusLabel(person.status)}</div>`).join('') : empty('暂无共同指派的 Agent。')}</div>
      <div class="symbio-detail-part symbio-inline"><span class="symbio-muted">专属工位</span>${label(seatLabelFor(selected))}</div>
      <div class="symbio-detail-part symbio-inline"><span class="symbio-muted">执行适配</span>${label(selected.type === 'human' ? '真人档案' : executionAdapterStatus(selected).label)}</div>${selected.type === 'agent' ? `<div class="symbio-detail-part symbio-inline"><span class="symbio-muted">执行授权</span>${label(agentAuthorization(selected).execution ? '管理员已授权' : '管理员未授权')}</div>` : ''}`,
      detailActions, 'symbio-person-detail');
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
        const seatText = seatLabelFor(person);
        return `<tr${person.id === selected?.id ? ' class="selected"' : ''}><td>${link('ws-person', person.name, person.id)}
          <small>${escape(person.code + ' · ' + person.title + (seatText !== '未分配' ? ' · ' + seatText : ''))}</small></td><td>${label(person.type === 'human' ? '真人' : 'Agent', person.type === 'human' ? 'violet' : 'green')}</td>
          <td>${escape(name('teams', person.teamId))}</td><td>${statusLabel(person.status)}</td><td>${task ? link('task-view', task.title, task.id) : '—'}</td>
          <td><div class="symbio-row-actions">${blockButton(person.type === 'human' ? 'ws-human-edit' : 'agent-edit', '编辑', person.id)}${person.type === 'agent' ? blockButton('agent-permissions', '权限', person.id) : ''}</div></td></tr>`;
      }).join('')}</tbody></table>${!rows.length ? empty('没有匹配的员工。') : ''}</div>
      <footer class="symbio-directory-footer"><span>显示 ${list.length ? (employee.page - 1) * 8 + 1 : 0}–${Math.min(employee.page * 8, list.length)} 项，共 ${list.length} 位员工</span>
        <div>${link('ws-employee-page','‹',String(employee.page - 1))}<strong>${employee.page} / ${pageCount}</strong>${link('ws-employee-page','›',String(employee.page + 1))}</div></footer>`,
      '', 'symbio-employee-list');
    const distribution = snapshot.teams.map(team => {
      const members = all.filter(person => person.teamId === team.id);
      return `<div><div class="symbio-inline"><strong>${escape(team.name)}</strong><span>${members.filter(item => item.type === 'human').length} / ${members.filter(item => item.type === 'agent').length}</span></div>
        ${progress(percent(members.length, all.length), team.name + '员工占比')}</div>`;
    });
    return intro('5:13', '成员', '维护真人与智能体的身份、岗位和团队归属。模型、技能与执行权限在「智能体」中配置。',
      blockButton('ws-export-people', '↓ 导出名单') + blockButton('ws-add-employee', '＋ 添加员工', '', 'primary'),
      metrics([['团队成员', all.length, '覆盖 ' + snapshot.teams.length + ' 个职能团队'], ['真人员工', humans.length, humans.filter(p => p.status === 'online').length + ' 人标记在线'],
        ['Agent 员工', ai.length, ai.filter(p => p.status !== 'offline' && p.status !== 'paused').length + ' 个当前可用'], ['人机协作率', percent(hybrid.length, assigned.length) + '%', '共同指派任务占比']]) +
      `<div class="symbio-people-grid">${directory}${employeeDetail(snapshot, selected)}</div>
      <section class="symbio-panel symbio-team-distribution"><div><h2>团队分布</h2><p class="symbio-muted">真人 / Agent</p></div>
        ${distribution.join('') || empty('暂无小队。')}</section>`, 'symbio-people');
  }

  function agentPage() {
    const snapshot = data();
    const all = roster(snapshot).filter(person => person.type === 'agent');
    const work = activeRuns(snapshot);
    const active = new Set(work.filter(run => run.status === 'running').map(run => run.agentId));
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
        <div class="symbio-agent-model">${label(agent.runtime === 'observed' ? (agent.provider ? agent.provider + ' · ' : '') + executionAdapterStatus(agent).label : agent.model || ({demo:'演示运行器',codex:'Codex 默认',pi:'Pi 默认'})[agent.runtime] || agent.runtime)}
          <span>团队 · ${escape(name('teams', agent.teamId))}${Number.isInteger(agent.seatIndex) ? ' · 工位 ' + escape(workstationLabel(agent.seatIndex)) : ''}</span></div>
        <p class="symbio-muted">适配：${escape(executionAdapterStatus(agent).label)} · 授权：${agentAuthorization(agent).execution ? agentCanExecute(agent) ? '已允许执行' : '已授权，待适配' : '未允许执行'}</p><p class="symbio-agent-activity">${escape(task ? find('tasks', task.taskId)?.title || task.activity : review?.title || agent.scope || '暂无执行任务')}</p>
        <div class="symbio-agent-stats"><div><strong>${runs.length ? percent(runs.filter(r => r.status === 'completed').length, runs.length) + '%' : '—'}</strong><small>成功率</small></div>
          <div><strong>${number(agentUsage)}</strong><small>今日 Token</small></div><div><strong>${current.filter(run => run.status !== 'queued').length} 项</strong><small>执行中任务</small></div></div>
        <footer>${link('agent-edit', '编辑配置', agent.id)}${link('agent-permissions', '权限设置', agent.id)}${review ? link('task-view', '处理验收', review.id) :
          agentCanExecute(agent) ? link('ws-agent-pause', agent.paused ? '▷ 恢复派发' : 'Ⅱ 暂停', agent.id) : agent.runtime === 'observed' ? link('goto-discovery', '查看来源') : ''}</footer></article>`;
    });
    return intro('5:17', '智能体', '配置 Agent 的人格、模型、Skills 与权限，查看执行状态和交接记录。',
      blockButton('ws-runs', '运行记录') + blockButton('agent-edit', '＋ 创建 Agent', '', 'primary'),
      metrics([['在线 Agent', all.filter(person => !['offline','paused'].includes(person.status)).length + ' / ' + all.length,
        all.filter(person => ['offline','paused'].includes(person.status)).length + ' 个离线或已暂停'],
        ['今日执行成功率', terminal.length ? percent(terminal.filter(run => run.status === 'completed').length, terminal.length) + '%' : '—', terminal.length + ' 项执行已结束'],
        ['今日 Token 消耗', number(usage), budget?.limit > 0 ? '预算使用率 ' + percent(budget.spent,budget.limit) + '%' : '预算未设置'],
        ['待人工审批', [...reviews].filter(Boolean).length, '任务验收', 'alert']]) +
      `<div class="symbio-agent-controls">${tabs([['all','全部 Agent ' + all.length], ['running','运行中 ' + active.size],
        ['approval','待审批 ' + ([...reviews].filter(Boolean).length)], ['paused','已暂停 ' + all.filter(item => item.paused).length]], agents.tab, 'ws-agent-tab')}
        ${filters(agents, 'agents', modelOptions)}</div><div class="symbio-agent-grid">${cards.join('') || empty('没有匹配的 Agent。')}</div>
        <section class="symbio-governance"><div><h2>安全始终由你掌控</h2><p>在配置中管理 Agent 的工具权限、运行器和文件访问范围。</p></div>
          ${blockButton('goto-discovery', '发现与接入')}${blockButton('ws-policy', '管理权限策略 →')}</section>`, 'symbio-agents');
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

  function editableDecor() {
    if (!decorDirty) {
      const snap = data();
      decorDraft = {
        mode: snap?.officeMode === 'custom' ? 'custom' : 'default',
        floors: structuredClone(snap?.officeFloors ?? []),
        items: structuredClone(snap?.officeItems ?? []),
        walls: structuredClone(snap?.officeWalls ?? []),
        rugs: structuredClone(snap?.officeRugs ?? []),
      };
    }
    return decorDraft;
  }

  function mutateDecor(fn) {
    const current = editableDecor();
    decorHistory.push(structuredClone(current));
    if (decorHistory.length > 30) decorHistory.shift();
    decorFuture = [];
    fn(current);
    decorDirty = true;
    render();
  }

  function nextDraftSeatIndex(items, snapshot) {
    const used = new Set(items.filter(i => i.type === 'desk' && Number.isInteger(i.seatIndex)).map(i => i.seatIndex));
    for (const p of [...(snapshot.agents ?? []), ...(snapshot.humans ?? [])]) {
      if (Number.isInteger(p.seatIndex)) used.add(p.seatIndex);
    }
    let idx = customSeatIndexStart;
    while (used.has(idx)) idx++;
    return idx;
  }

  function rotateSelectedOrPlacing(step = 90) {
    if (designTool === 'place' && placingType) {
      placingRotation = normalizeRotation(placingRotation + step);
      render();
      return;
    }
    if (selectedDecor?.kind !== 'item') return;
    const decor = editableDecor();
    const target = decor.items.find(item => item.id === selectedDecor.id);
    if (!target) return;
    const nextRot = normalizeRotation(target.rotation + step);
    const wingCount = data().workstationCount ?? baseWorkstations;
    const check = validateItemPlacement({...target, rotation: nextRot}, decor.items, wingCount, target.id, decor.walls, decor.mode, decor.floors);
    if (!check.ok) return;
    mutateDecor(draft => {
      const entry = draft.items.find(item => item.id === selectedDecor.id);
      if (entry) entry.rotation = nextRot;
    });
  }

  function deleteSelectedDecor(target = selectedDecor) {
    if (!target) return;
    const decor = editableDecor();
    if (target.kind === 'item') {
      const item = decor.items.find(entry => entry.id === target.id);
      if (!item) return;
      const assigned = seatAssignments(data());
      if (item.type === 'desk' && Number.isInteger(item.seatIndex) && assigned.has(item.seatIndex)) {
        throw new Error(`工位 ${workstationLabel(item.seatIndex)} 已有「${assigned.get(item.seatIndex).name}」入座，无法删除`);
      }
      mutateDecor(draft => {
        const idx = draft.items.findIndex(entry => entry.id === target.id);
        if (idx !== -1) draft.items.splice(idx, 1);
      });
    } else if (target.kind === 'floor') {
      const remainingFloors = decor.floors.filter(entry => entry.id !== target.id);
      if (decor.mode === 'custom') {
        const wingCount = data().workstationCount ?? baseWorkstations;
        const blockedItem = decor.items.find(item => !validateItemPlacement(item, decor.items, wingCount, item.id, decor.walls, 'custom', remainingFloors).ok);
        if (blockedItem) {
          const spec = furnitureByType[blockedItem.type];
          throw new Error(`该地板上仍有「${spec?.name ?? blockedItem.type}」，请先移走或删除后再拆除地板`);
        }
        const blockedRug = decor.rugs.find(rug => !validateRugPlacement(rug, wingCount, 'custom', remainingFloors).ok);
        if (blockedRug) {
          throw new Error('该地板上仍有区域地毯，请先移除地毯后再拆除地板');
        }
      }
      mutateDecor(draft => {
        const idx = draft.floors.findIndex(entry => entry.id === target.id);
        if (idx !== -1) draft.floors.splice(idx, 1);
      });
    } else if (target.kind === 'wall') {
      mutateDecor(draft => {
        const idx = draft.walls.findIndex(entry => entry.id === target.id);
        if (idx !== -1) draft.walls.splice(idx, 1);
      });
    } else if (target.kind === 'rug') {
      mutateDecor(draft => {
        const idx = draft.rugs.findIndex(entry => entry.id === target.id);
        if (idx !== -1) draft.rugs.splice(idx, 1);
      });
    }
    if (selectedDecor?.kind === target.kind && selectedDecor?.id === target.id) selectedDecor = null;
  }

  function seatAssignments(snapshot) {
    const staff = officePresence(snapshot, officeOverview(snapshot, null)).filter(person => person.kind !== 'system');
    return new Map(staff.filter(person => Number.isInteger(person.seatIndex)).map(person => [person.seatIndex, person]));
  }

  function zoneSeatStats(zone, snapshot, assigned = seatAssignments(snapshot)) {
    const count = snapshot.workstationCount ?? baseWorkstations;
    const items = snapshot.officeItems ?? [];
    const mode = snapshot.officeMode === 'custom' ? 'custom' : 'default';
    const isDeskZone = zone.type === 'work' || zone.type === 'ai';
    const indices = zoneWorkstationIndices(zone.type, count, items, mode);
    const total = physicalZoneCapacity(zone.type, count, items, mode);
    if (isDeskZone) {
      const occupied = indices.filter(index => assigned.has(index)).length;
      return {isDeskZone: true, total, occupied, remaining: Math.max(0, total - occupied), indices};
    }
    const model = officeOverview(snapshot, null);
    const active = Math.min(total, (model.rooms[zone.type] ?? []).length);
    return {isDeskZone: false, total, occupied: active, remaining: Math.max(0, total - active), indices: []};
  }

  function layoutSceneZones() {
    const snapshot = data();
    const assigned = seatAssignments(snapshot);
    const counts = {};
    return editableLayout().zones.map(zone => {
      const [originX, originZ] = sceneZoneOrigins[zone.type] ?? sceneZoneOrigins.work;
      const idx = counts[zone.type] ?? 0;
      counts[zone.type] = idx + 1;
      const offsetX = idx ? ((idx % 2 ? 1 : -1) * Math.ceil(idx / 2) * 1.4) : 0;
      const offsetZ = idx ? (Math.floor((idx - 1) / 2) * 1.1) : 0;
      const stats = zoneSeatStats(zone, snapshot, assigned);
      const suffix = stats.isDeskZone ? ` · 余 ${stats.remaining}` : ` · ${stats.total} 席`;
      return {
        id: zone.id, name: zone.name, label: zone.name + suffix,
        title: `${zone.name}（${stats.isDeskZone ? `共 ${stats.total} 个实体工位，已占 ${stats.occupied}，剩余 ${stats.remaining}` : `共 ${stats.total} 个固定席位`}）`,
        visible: zone.visible, selected: zone.id === selectedZone,
        x: clamp(originX + offsetX, -8.8, 9), z: clamp(originZ + offsetZ, -6.6, 7.3),
      };
    });
  }

  function layoutSceneDesks() {
    const snapshot = data();
    const count = snapshot.workstationCount ?? baseWorkstations;
    const items = snapshot.officeItems ?? [];
    const mode = snapshot.officeMode === 'custom' ? 'custom' : 'default';
    const assigned = seatAssignments(snapshot);
    const activeKey = ui.selectedOfficeActor();
    const indices = [
      ...(mode === 'custom' ? [] : Array.from({length: count}, (_, i) => i)),
      ...items.filter(item => item.type === 'desk' && Number.isInteger(item.seatIndex)).map(item => item.seatIndex),
    ];
    return indices.map(index => {
      const [x, z] = workstationPosition(index, count, items);
      const person = assigned.get(index);
      const code = workstationLabel(index);
      const zoneTitle = zoneNames[workstationZoneType(index, items)];
      return {
        id: 'desk:' + index, x, z,
        actorKey: person?.key ?? '',
        selected: Boolean(person && person.key === activeKey),
        code: index === privateOfficeSeatIndex ? '独立' : code,
        occupant: person ? person.name.replace(/^老板 · /, '') : '',
        title: person ? `${code}（${zoneTitle}）· ${person.name}` : `${code}（${zoneTitle}）· 空置工位`,
      };
    });
  }

  const officeViewport = (id, preview, label) => `<div id="${id}" class="office-3d-viewport"
    data-layout-preview="${preview}" aria-label="${label}"><p class="office-scene-loading">正在载入 3D 办公室…</p></div>`;

  function removableWorkstations(snapshot, assigned = seatAssignments(snapshot)) {
    if (snapshot.officeMode === 'custom') return 0;
    const count = snapshot.workstationCount ?? baseWorkstations;
    const minCount = [...assigned.keys()].filter(idx => idx < customSeatIndexStart)
      .reduce((min, idx) => Math.max(min, idx + 1), baseWorkstations);
    return Math.max(0, count - minCount);
  }

  function workstations(snapshot) {
    const count = snapshot.workstationCount ?? baseWorkstations;
    const items = snapshot.officeItems ?? [];
    const mode = snapshot.officeMode === 'custom' ? 'custom' : 'default';
    const customDeskItems = items.filter(item => item.type === 'desk' && Number.isInteger(item.seatIndex));
    const totalDesks = mode === 'custom' ? customDeskItems.length : count + customDeskItems.length;
    const assigned = seatAssignments(snapshot);
    const removable = removableWorkstations(snapshot, assigned);
    const workIndices = zoneWorkstationIndices('work', count, items, mode);
    const aiIndices = zoneWorkstationIndices('ai', count, items, mode);
    const workFree = workIndices.filter(i => !assigned.has(i)).length;
    const aiFree = aiIndices.filter(i => !assigned.has(i)).length;
    const allIndices = [
      ...(mode === 'custom' ? [] : Array.from({length: count}, (_, i) => i)),
      ...customDeskItems.map(item => item.seatIndex),
    ];
    const rows = allIndices.map(index => {
      const person = assigned.get(index);
      const key = person?.key;
      const reserved = index === privateOfficeSeatIndex;
      const isCustom = index >= customSeatIndexStart;
      const expanded = !isCustom && index >= baseWorkstations;
      const zoneTitle = reserved ? '独立办公室'
        : isCustom ? (workstationZoneType(index, items) === 'ai' ? 'AI 运行区 · 自由布置' : '研发协作区 · 自由布置')
          : workstationZoneType(index, items) === 'ai' ? (expanded ? 'AI 运行区 · 扩建' : 'AI 运行区') : '研发协作区';
      const tail = person
        ? `<small>${person.kind === 'agent' ? 'Agent' : '真人'}</small>`
        : expanded
          ? `<button type="button" class="seat-delete-btn" data-action="ws-workstation-delete" data-id="${index}" title="删除此扩建空位">删除</button>`
          : isCustom
            ? `<button type="button" class="seat-delete-btn" data-action="ws-layout-tab" data-id="decorate" title="前往自由布置调整">调整</button>`
            : `<small>${reserved ? '保留' : '空余'}</small>`;
      const caption = `<span class="seat-code">${workstationLabel(index)}</span>
        <span class="seat-occupant"><strong>${escape(person?.name ?? (reserved ? '老板专用' : '空置工位'))}</strong><small>${escape(zoneTitle)}</small></span>
        ${tail}`;
      return person ? `<li><button type="button" data-action="office-person" data-id="${escape(key)}"
        aria-pressed="${ui.selectedOfficeActor() === key}">${caption}</button></li>` : `<li><div>${caption}</div></li>`;
    }).join('');
    const headerControls = mode === 'custom'
      ? `<div class="symbio-workstation-head-actions">${blockButton('ws-layout-tab', '＋ 自由摆放工位', 'decorate', 'primary')}</div>`
      : `<div class="symbio-workstation-head-actions">
        ${removable > 0 ? blockButton('ws-workstations-remove', '− 缩减') : ''}
        ${blockButton('ws-layout-tab', '自由摆放', 'decorate')}
        ${blockButton('ws-workstations-add', '＋ 扩建工位', '', 'primary')}
      </div>`;
    return `<div class="symbio-workstation-grid">
      <section class="symbio-panel symbio-workstation-preview">
        <header class="symbio-panel-head"><h2>3D 工位实景</h2>
          <div class="symbio-workstation-controls">
            <button type="button" data-action="office-orbit" data-id="-1" aria-label="向左旋转">↶</button>
            <button type="button" data-action="office-orbit" data-id="1" aria-label="向右旋转">↷</button>
            <button type="button" data-action="office-zoom-out" aria-label="缩小">−</button>
            <button type="button" data-action="office-zoom-reset" aria-label="还原">还原</button>
            <button type="button" data-action="office-zoom-in" aria-label="放大">＋</button>
          </div></header>
        ${officeViewport('office-3d-viewport','seats','3D 工位实景')}
      </section>
      ${panel('工位分配', `<p class="symbio-muted">共 ${totalDesks} 个实体工位 · 已占 ${assigned.size} · 剩余 ${Math.max(0, totalDesks - assigned.size)}（研发区余 ${workFree} · AI 区余 ${aiFree}）</p>
        ${rows ? `<ul class="symbio-workstation-roster">${rows}</ul>` : empty('自建空间中尚未摆放工位桌椅，前往「自由布置」放置即可自动分配。')}`, headerControls)}
    </div>`;
  }

  function decorateWorkspace(snapshot) {
    const decor = editableDecor();
    const {mode, floors, items, walls, rugs} = decor;
    const isCustom = mode === 'custom';
    const assigned = seatAssignments(snapshot);
    const selectedItem = selectedDecor?.kind === 'item' ? items.find(i => i.id === selectedDecor.id) : null;
    const selectedFloor = selectedDecor?.kind === 'floor' ? floors.find(f => f.id === selectedDecor.id) : null;
    const selectedWall = selectedDecor?.kind === 'wall' ? walls.find(w => w.id === selectedDecor.id) : null;
    const selectedRug = selectedDecor?.kind === 'rug' ? rugs.find(r => r.id === selectedDecor.id) : null;
    const seatItems = furnitureCatalog.filter(item => item.category === 'seat');
    const zoneItems = furnitureCatalog.filter(item => item.category === 'zone');
    const decorItems = furnitureCatalog.filter(item => item.category === 'decor');
    const deskCount = items.filter(i => i.type === 'desk').length;
    const decorCount = items.length - deskCount;

    const buildToolBtn = (tool, title, sub) => `<button type="button" class="symbio-decor-card" data-action="ws-decor-mode" data-id="${tool}" aria-pressed="${designTool === tool}">
      <strong>${escape(title)}</strong><small>${escape(sub)}</small></button>`;
    const catalogButton = (spec, wide = false) => `<button type="button" class="symbio-decor-card${wide ? ' is-wide' : ''}" data-action="ws-decor-tool" data-id="${spec.type}" aria-pressed="${designTool === 'place' && placingType === spec.type}">
      <strong>${escape(spec.name)}</strong>
      <small>${spec.width}×${spec.depth}m${spec.category === 'seat' ? ' · 可入座' : ''}</small>
    </button>`;

    const wallSwatches = designTool === 'wall'
      ? `<div class="symbio-swatch-row" aria-label="墙面颜色">${Object.entries(wallPalette).map(([k, title]) =>
        `<button type="button" class="symbio-swatch" data-swatch="wall-${k}" data-action="ws-wall-color" data-id="${k}" aria-pressed="${wallColor === k}">${escape(title.replace('墙', ''))}</button>`).join('')}</div>`
      : '';
    const floorSwatches = designTool === 'floor'
      ? `<div class="symbio-swatch-row" aria-label="地板材质">${Object.entries(floorPalette).map(([k, title]) =>
        `<button type="button" class="symbio-swatch" data-swatch="floor-${k}" data-action="ws-floor-material" data-id="${k}" aria-pressed="${floorMaterial === k}">${escape(title)}</button>`).join('')}</div>`
      : '';
    const rugSwatches = designTool === 'rug'
      ? `<div class="symbio-swatch-row" aria-label="地毯颜色">${Object.entries(rugPalette).map(([k, title]) =>
        `<button type="button" class="symbio-swatch" data-swatch="rug-${k}" data-action="ws-rug-color" data-id="${k}" aria-pressed="${rugColor === k}">${escape(title.replace('地毯', ''))}</button>`).join('')}</div>`
      : '';

    const modeSwitch = `<div class="symbio-mode-switch" role="group" aria-label="空间建造模式">
      <button type="button" data-action="ws-decor-space-mode" data-id="default" aria-pressed="${!isCustom}">默认户型扩展</button>
      <button type="button" data-action="ws-decor-space-mode" data-id="custom" aria-pressed="${isCustom}">从零自建空间</button>
    </div>`;

    const paletteGroups = isCustom
      ? `<p class="symbio-decor-step-note">按顺序自建办公空间：先画墙体与门洞 → 再铺设地板 → 最后摆放工位与摆件。</p>
        <div class="symbio-decor-group"><h3>1. 绘制墙面（可先于地板）</h3>
          <div class="symbio-decor-catalog">
            ${buildToolBtn('wall', '画正交墙', '拉线建外/隔墙')}
            ${buildToolBtn('door', '开门洞', '1.4m 可通行')}
            ${buildToolBtn('erase-wall', '拆墙', '点击拆除')}
          </div>
          ${wallSwatches}
        </div>
        <div class="symbio-decor-group"><h3>2. 铺设地板与地毯</h3>
          <div class="symbio-decor-catalog">
            ${buildToolBtn('floor', '铺地板', '拖拽铺矩形')}
            ${buildToolBtn('erase-floor', '拆地板', '点击拆除')}
            ${buildToolBtn('rug', '铺地毯', '区域地毯')}
          </div>
          ${floorSwatches}${rugSwatches}
          <button type="button" class="symbio-decor-helper-btn" data-action="ws-floor-autofill"${walls.length < 2 ? ' disabled title="先绘制至少 2 面垂直墙体即可一键按外框铺满地板"' : ''}>✨ 按墙体外框一键铺满地板</button>
        </div>
        <div class="symbio-decor-group"><h3>3. 工位与功能区（需先铺地板）</h3>
          <div class="symbio-decor-catalog">
            ${seatItems.map(spec => catalogButton(spec, true)).join('')}
            ${zoneItems.map(spec => catalogButton(spec, false)).join('')}
          </div>
        </div>
        <div class="symbio-decor-group"><h3>办公摆件与设施</h3>
          <div class="symbio-decor-catalog">${decorItems.map(spec => catalogButton(spec, false)).join('')}</div></div>`
      : `<div class="symbio-decor-group"><h3>空间墙体与地毯</h3>
          <div class="symbio-decor-catalog">
            ${buildToolBtn('wall', '画正交墙', '拉线建隔墙')}
            ${buildToolBtn('door', '开门洞', '1.4m 可通行')}
            ${buildToolBtn('erase-wall', '拆墙', '点击拆除')}
            ${buildToolBtn('rug', '铺地毯', '区域地毯')}
          </div>
          ${wallSwatches}${rugSwatches}
        </div>
        <div class="symbio-decor-group"><h3>可入座工位与功能桌</h3>
          <div class="symbio-decor-catalog">
            ${seatItems.map(spec => catalogButton(spec, true)).join('')}
            ${zoneItems.map(spec => catalogButton(spec, false)).join('')}
          </div>
        </div>
        <div class="symbio-decor-group"><h3>办公装饰与设施</h3>
          <div class="symbio-decor-catalog">${decorItems.map(spec => catalogButton(spec, false)).join('')}</div></div>`;

    const palettePanel = panel(isCustom ? '从零建造工具箱' : '建筑与家具素材',
      `${modeSwitch}<div class="symbio-decor-scroll">${paletteGroups}</div>`,
      designTool !== 'select' ? link('ws-decor-mode', '退出工具', 'select') : label('选择 / 拖拽', 'green'),
      'symbio-region-panel');

    const toolbar = `<div class="symbio-decor-toolbar">
      <button type="button" class="symbio-button${designTool === 'select' ? ' primary' : ''}" data-action="ws-decor-mode" data-id="select">选择 / 拖拽</button>
      <button type="button" class="symbio-button" data-action="ws-decor-rotate" data-id="90"${!(designTool === 'place' && placingType) && !selectedItem ? ' disabled' : ''}>旋转 90° (R)</button>
      <button type="button" class="symbio-button" data-action="ws-decor-undo"${!decorHistory.length ? ' disabled' : ''}>撤销</button>
      <button type="button" class="symbio-button" data-action="ws-decor-redo"${!decorFuture.length ? ' disabled' : ''}>重做</button>
    </div>`;

    const canvasTitle = designTool === 'wall' ? (isCustom ? '第 1 步 · 绘制正交墙面' : '绘制正交墙体')
      : designTool === 'floor' ? '第 2 步 · 拖拽铺设地板区域'
        : designTool === 'erase-floor' ? '点击自定义地板拆除'
          : designTool === 'door' ? '在自定义墙体上开门洞'
            : designTool === 'erase-wall' ? '点击自定义墙体拆除'
              : designTool === 'rug' ? '拖拽铺设区域地毯'
                : designTool === 'place' && placingType ? `点击地板放置：${furnitureByType[placingType]?.name}`
                  : (isCustom ? '从零自建 3D 空间画布（24×20m）' : '3D 自由布置画布');

    const footerHint = designTool === 'wall'
      ? (isCustom ? '在 24×20m 网格上拖拽绘制外墙与隔墙 · 靠近墙角/墙面自动磁吸无缝连接（按住 Alt 临时关闭吸附）' : '在地面拖拽绘制正交墙体 · 靠近墙角/墙面自动磁吸对齐（按住 Alt 临时关闭吸附）')
      : designTool === 'floor' ? '在网格上拖拽矩形铺设地板区块 · 支持多块拼接不同材质 · 也可一键按墙体铺满'
        : designTool === 'erase-floor' ? '点击任意已铺设的地板即可拆除（若其上已有家具请先移走）'
          : designTool === 'door' ? '将光标移至自定义墙体上点击切开 1.4m 门洞 · 角色将自动从门洞穿行'
            : designTool === 'erase-wall' ? '点击任意自定义墙体即可拆除'
              : designTool === 'rug' ? '在地板上点击并拖拽矩形区域铺设地毯 · 不阻挡行走与摆桌'
                : designTool === 'place' && placingType ? `绿色可放置 / 红色冲突 · 按 R 旋转当前朝向（${placingRotation}°）${isCustom && !floors.length ? ' · 请先铺设地板' : ''}`
                  : '拖拽家具移动位置 · 点击墙体/地板/地毯/家具查看属性 · 自动 A* 避障寻路';

    const canvas = `<section class="symbio-panel symbio-layout-preview">
      <header class="symbio-panel-head"><h2>${escape(canvasTitle)}</h2>${toolbar}</header>
      <div class="symbio-layout-stage symbio-layout-stage-3d">
        ${officeViewport('office-3d-viewport', 'decorate', '3D 自由布置画布')}
      </div>
      <footer><span>${escape(footerHint)}</span>
        <div class="symbio-workstation-controls">
          <button type="button" data-action="office-orbit" data-id="-1" aria-label="向左旋转">↶</button>
          <button type="button" data-action="office-orbit" data-id="1" aria-label="向右旋转">↷</button>
          <button type="button" data-action="office-zoom-out" aria-label="缩小">−</button>
          <button type="button" data-action="office-zoom-reset" aria-label="还原视角">还原</button>
          <button type="button" data-action="office-zoom-in" aria-label="放大">＋</button>
        </div></footer>
    </section>`;

    let inspectorBody = '';
    if (selectedItem) {
      const spec = furnitureByType[selectedItem.type];
      const occupant = selectedItem.type === 'desk' && Number.isInteger(selectedItem.seatIndex) ? assigned.get(selectedItem.seatIndex) : null;
      const seatBadge = selectedItem.type === 'desk' && Number.isInteger(selectedItem.seatIndex)
        ? label(`工位 ${workstationLabel(selectedItem.seatIndex)}`, 'green')
        : spec?.category === 'zone' ? label('功能区', 'violet') : label('装饰设施');
      inspectorBody = `<div class="symbio-decor-selected">
        <div class="symbio-inline"><strong>${escape(spec?.name ?? selectedItem.type)}</strong>${seatBadge}</div>
        <p class="symbio-muted">${escape(spec?.description ?? '')}</p>
        <div class="symbio-decor-meta">
          <span>坐标：<code>(${selectedItem.x.toFixed(1)}, ${selectedItem.z.toFixed(1)})</code></span>
          <span>朝向：<code>${selectedItem.rotation}°</code></span>
        </div>
        ${occupant ? `<p class="symbio-muted">当前入座：<strong>${escape(occupant.name)}</strong>（入座工位受保护不可删除）</p>` : ''}
        <div class="symbio-decor-angles">
          ${[0, 90, 180, 270].map(deg => `<button type="button" data-action="ws-decor-angle" data-id="${deg}" aria-pressed="${selectedItem.rotation === deg}">${deg}°</button>`).join('')}
        </div>
        <div class="symbio-seat-summary-actions">
          <button type="button" class="symbio-button danger-btn" data-action="ws-decor-delete" data-id="item:${escape(selectedItem.id)}"${occupant ? ' disabled title="已有员工入座，无法删除"' : ''}>删除此物品</button>
        </div>
      </div>`;
    } else if (selectedFloor) {
      const w = (selectedFloor.x2 - selectedFloor.x1).toFixed(1);
      const d = (selectedFloor.z2 - selectedFloor.z1).toFixed(1);
      inspectorBody = `<div class="symbio-decor-selected">
        <div class="symbio-inline"><strong>自定义地板</strong>${label(`${w}×${d}m`, 'green')}</div>
        <div class="symbio-decor-meta">
          <span>范围 <code>(${selectedFloor.x1.toFixed(1)}, ${selectedFloor.z1.toFixed(1)}) → (${selectedFloor.x2.toFixed(1)}, ${selectedFloor.z2.toFixed(1)})</code></span>
        </div>
        <div class="symbio-swatch-row">${Object.entries(floorPalette).map(([k, title]) =>
          `<button type="button" class="symbio-swatch" data-swatch="floor-${k}" data-action="ws-floor-recolor" data-id="${escape(selectedFloor.id)}:${k}" aria-pressed="${selectedFloor.material === k}">${escape(title)}</button>`).join('')}</div>
        <div class="symbio-seat-summary-actions">
          <button type="button" class="symbio-button danger-btn" data-action="ws-decor-delete" data-id="floor:${escape(selectedFloor.id)}">拆除地板</button>
        </div>
      </div>`;
    } else if (selectedWall) {
      const len = wallLength(selectedWall);
      const axisText = wallAxis(selectedWall) === 'x' ? '东西向隔墙' : '南北向隔墙';
      const canCenterDoor = validateDoorPlacement(selectedWall, len / 2).ok;
      inspectorBody = `<div class="symbio-decor-selected">
        <div class="symbio-inline"><strong>自定义隔墙</strong>${label(`${len.toFixed(1)}m · ${axisText}`, 'green')}</div>
        <div class="symbio-decor-meta">
          <span>起点 <code>(${selectedWall.x1.toFixed(1)}, ${selectedWall.z1.toFixed(1)})</code></span>
          <span>终点 <code>(${selectedWall.x2.toFixed(1)}, ${selectedWall.z2.toFixed(1)})</code></span>
        </div>
        <div class="symbio-swatch-row">${Object.entries(wallPalette).map(([k, title]) =>
          `<button type="button" class="symbio-swatch" data-swatch="wall-${k}" data-action="ws-wall-recolor" data-id="${escape(selectedWall.id)}:${k}" aria-pressed="${selectedWall.color === k}">${escape(title.replace('墙', ''))}</button>`).join('')}</div>
        <div class="symbio-inline">
          <span class="symbio-muted">门洞：${selectedWall.doors?.length ?? 0} 个</span>
          ${canCenterDoor ? link('ws-wall-door-center', '＋ 居中开门洞', selectedWall.id) : ''}
        </div>
        ${selectedWall.doors?.length ? `<div class="symbio-door-chips">${selectedWall.doors.map((offset, idx) =>
          `<button type="button" class="symbio-door-chip" data-action="ws-wall-door-remove" data-id="${escape(selectedWall.id)}:${idx}" title="点击封堵此门洞">门洞 ${offset.toFixed(1)}m ×</button>`).join('')}</div>` : ''}
        <div class="symbio-seat-summary-actions">
          <button type="button" class="symbio-button danger-btn" data-action="ws-decor-delete" data-id="wall:${escape(selectedWall.id)}">拆除墙体</button>
        </div>
      </div>`;
    } else if (selectedRug) {
      const w = (selectedRug.x2 - selectedRug.x1).toFixed(1);
      const d = (selectedRug.z2 - selectedRug.z1).toFixed(1);
      inspectorBody = `<div class="symbio-decor-selected">
        <div class="symbio-inline"><strong>区域地毯</strong>${label(`${w}×${d}m`, 'green')}</div>
        <div class="symbio-swatch-row">${Object.entries(rugPalette).map(([k, title]) =>
          `<button type="button" class="symbio-swatch" data-swatch="rug-${k}" data-action="ws-rug-recolor" data-id="${escape(selectedRug.id)}:${k}" aria-pressed="${selectedRug.color === k}">${escape(title.replace('地毯', ''))}</button>`).join('')}</div>
        <div class="symbio-seat-summary-actions">
          <button type="button" class="symbio-button danger-btn" data-action="ws-decor-delete" data-id="rug:${escape(selectedRug.id)}">移除地毯</button>
        </div>
      </div>`;
    } else {
      inspectorBody = `<p class="symbio-muted">在 3D 场景中点击任意自定义墙体、地板、地毯或家具即可编辑材质、门洞、朝向或删除。</p>`;
    }

    const totalCount = items.length + walls.length + floors.length + rugs.length;
    const listEntries = [
      ...walls.map((wall, idx) => `<li><button type="button" data-action="ws-decor-select" data-id="wall:${escape(wall.id)}" aria-pressed="${selectedDecor?.kind === 'wall' && selectedDecor.id === wall.id}">
        <span><strong>${escape(wallPalette[wall.color] ?? '隔墙')} #${idx + 1}</strong>${wall.doors?.length ? ` <small class="seat-code">${wall.doors.length} 门</small>` : ''}</span>
        <small>${wallLength(wall).toFixed(1)}m</small></button></li>`),
      ...floors.map((floor, idx) => `<li><button type="button" data-action="ws-decor-select" data-id="floor:${escape(floor.id)}" aria-pressed="${selectedDecor?.kind === 'floor' && selectedDecor.id === floor.id}">
        <span><strong>${escape(floorPalette[floor.material] ?? '地板')} #${idx + 1}</strong></span>
        <small>${(floor.x2 - floor.x1).toFixed(1)}×${(floor.z2 - floor.z1).toFixed(1)}m</small></button></li>`),
      ...rugs.map((rug, idx) => `<li><button type="button" data-action="ws-decor-select" data-id="rug:${escape(rug.id)}" aria-pressed="${selectedDecor?.kind === 'rug' && selectedDecor.id === rug.id}">
        <span><strong>${escape(rugPalette[rug.color] ?? '地毯')} #${idx + 1}</strong></span>
        <small>${(rug.x2 - rug.x1).toFixed(1)}×${(rug.z2 - rug.z1).toFixed(1)}m</small></button></li>`),
      ...items.map(item => {
        const spec = furnitureByType[item.type];
        const code = item.type === 'desk' && Number.isInteger(item.seatIndex) ? workstationLabel(item.seatIndex) : '';
        const occupant = code ? assigned.get(item.seatIndex) : null;
        return `<li><button type="button" data-action="ws-decor-select" data-id="item:${escape(item.id)}" aria-pressed="${selectedDecor?.kind === 'item' && selectedDecor.id === item.id}">
          <span><strong>${escape(spec?.name ?? item.type)}</strong>${code ? ` <small class="seat-code">${escape(code)}</small>` : ''}</span>
          <small>${occupant ? escape(occupant.name) : `(${item.x.toFixed(1)}, ${item.z.toFixed(1)})`}</small>
        </button></li>`;
      }),
    ];

    const listRows = listEntries.length
      ? `<ul class="symbio-decor-list">${listEntries.join('')}</ul>`
      : empty(isCustom ? '空白自建画布已就绪：请先用左侧「画正交墙」绘制墙体，再铺设地板与摆放家具。' : '尚未绘制墙体、地毯或自定义家具，可从左侧素材库开始布置。');

    const countSummary = isCustom || floors.length
      ? `共 ${totalCount} 项（墙 ${walls.length} · 地 ${floors.length} · 毯 ${rugs.length} · 桌 ${deskCount} · 装 ${decorCount}）`
      : `共 ${totalCount} 项（墙 ${walls.length} · 毯 ${rugs.length} · 桌 ${deskCount} · 装 ${decorCount}）`;

    const inspectorPanel = panel('已布置清单',
      `${inspectorBody}<div class="symbio-zone-seats"><div class="symbio-inline"><h3>${countSummary}</h3>
        ${decorCount + walls.length + rugs.length + (deskCount === 0 ? floors.length : 0) > 0 ? link('ws-decor-clear', '清空非工位') : ''}</div>${listRows}</div>`,
      '', 'symbio-region-properties');

    return `<div class="symbio-layout-grid">${palettePanel}${canvas}${inspectorPanel}</div>`;
  }

  function layoutDesignConfig() {
    const snapshot = data();
    const decor = editableDecor();
    const wingCount = snapshot.workstationCount ?? baseWorkstations;
    return {
      active: layoutTab === 'decorate',
      mode: decor.mode,
      tool: designTool,
      placingType,
      placingRotation,
      wallColor,
      floorMaterial,
      rugColor,
      selected: selectedDecor,
      floors: decor.floors,
      items: decor.items,
      walls: decor.walls,
      rugs: decor.rugs,
      wingCount,
      onSelect(sel) {
        const same = (!sel && !selectedDecor) || (sel && selectedDecor && sel.kind === selectedDecor.kind && sel.id === selectedDecor.id);
        if (same) return;
        selectedDecor = sel;
        render();
      },
      onPlace(candidate) {
        const id = 'item_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
        const snap = data();
        mutateDecor(draft => {
          const item = {
            id,
            type: candidate.type,
            x: candidate.x,
            z: candidate.z,
            rotation: normalizeRotation(candidate.rotation),
            ...(candidate.type === 'desk' ? {seatIndex: nextDraftSeatIndex(draft.items, snap)} : {}),
          };
          draft.items.push(item);
          selectedDecor = {kind: 'item', id};
        });
      },
      onMove(id, x, z) {
        mutateDecor(draft => {
          const entry = draft.items.find(item => item.id === id);
          if (entry) { entry.x = x; entry.z = z; }
        });
      },
      onAddFloor(floor) {
        const id = 'floor_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
        mutateDecor(draft => {
          draft.floors.push({...floor, id, material: floorMaterial});
          selectedDecor = {kind: 'floor', id};
        });
      },
      onDeleteFloor(floorId) {
        deleteSelectedDecor({kind: 'floor', id: floorId});
      },
      onAddWall(wall) {
        const id = 'wall_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
        mutateDecor(draft => {
          draft.walls.push({...wall, id, color: wallColor, doors: []});
          selectedDecor = {kind: 'wall', id};
        });
      },
      onAddDoor(wallId, offset) {
        mutateDecor(draft => {
          const target = draft.walls.find(w => w.id === wallId);
          if (!target) return;
          target.doors = [...(target.doors ?? []), offset].sort((a, b) => a - b);
          selectedDecor = {kind: 'wall', id: wallId};
        });
      },
      onDeleteWall(wallId) {
        deleteSelectedDecor({kind: 'wall', id: wallId});
      },
      onAddRug(rug) {
        const id = 'rug_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
        mutateDecor(draft => {
          draft.rugs.push({...rug, id, color: rugColor});
          selectedDecor = {kind: 'rug', id};
        });
      },
    };
  }

  function layoutEditor() {
    const draft = editableLayout();
    if (!draft) return empty('请重启服务以加载空间与工位。');
    const snapshot = data();
    const layout = snapshot.layout;
    const count = snapshot.workstationCount ?? baseWorkstations;
    const officeMode = snapshot.officeMode === 'custom' ? 'custom' : 'default';
    const assigned = seatAssignments(snapshot);
    const removable = removableWorkstations(snapshot, assigned);
    const customDeskCount = (snapshot.officeItems ?? []).filter(item => item.type === 'desk').length;
    const totalPhysicalDesks = officeMode === 'custom' ? customDeskCount : count + customDeskCount;
    const totalRemaining = Math.max(0, totalPhysicalDesks - assigned.size);
    const selected = draft.zones.find(zone => zone.id === selectedZone) ?? draft.zones[0];
    const selectedStats = zoneSeatStats(selected, snapshot, assigned);
    const sameTypeZones = draft.zones.filter(zone => zone.type === selected.type);
    const isDuplicateZone = sameTypeZones.length > 1 && sameTypeZones[0].id !== selected.id;
    const toolRow = `<div class="symbio-layout-tabs">${tabs([['space','空间布局'],['decorate','自由布置'],['seats','工位管理'],['widgets','监控组件']], layoutTab, 'ws-layout-tab')}
      <div>${blockButton('ws-layout-name', draft.title, '', 'chevron-trigger')}${label(layoutTab === 'decorate' ? (decorDirty ? '布置待保存' : (editableDecor().mode === 'custom' ? '从零自建' : '3D 已同步')) : (layoutDirty ? '待保存' : officeMode === 'custom' ? '自建空间' : layout.publishedAt ? '已发布' : '默认布局'), 'green')}</div></div>`;
    const regionPanel = panel('空间区域',
      `<p class="symbio-muted">${totalPhysicalDesks} 个 3D 实体工位 · 已入座 ${assigned.size} · 剩余 ${totalRemaining} 空位</p>
      <div class="symbio-zones">${draft.zones.map((zone, index) => {
        const stats = zoneSeatStats(zone, snapshot, assigned);
        const detail = stats.isDeskZone
          ? `共 ${stats.total} 工位 · 已占 ${stats.occupied} · 剩余 ${stats.remaining}`
          : `${stats.total} 个共享席位 · ${stats.occupied ? stats.occupied + ' 人使用中' : '当前空闲'}`;
        return `<button type="button" data-action="ws-zone" data-id="${escape(zone.id)}" aria-pressed="${zone.id === selected.id}">
          <span>${pad(index + 1)}</span><span><strong>${escape(zone.name)}</strong>
          <small>${detail}</small></span></button>`;
      }).join('')}</div>
      <div class="symbio-zone-tools"><h3>3D 实体工位管理</h3>
        <p class="symbio-muted">${officeMode === 'custom'
          ? '当前使用「从零自建空间」，可在「自由布置」中绘制墙面、地板并自由增减工位与功能桌。'
          : '席位与 3D 实景桌椅一一对应；通过 3D 东侧扩建的空余工位也可随时删减。'}</p>
        ${officeMode === 'custom'
          ? blockButton('ws-layout-tab', '前往自由布置 →', 'decorate', 'primary')
          : blockButton('ws-workstations-add', '＋ 在 3D 图中新增工位', '', 'primary') +
            (removable > 0 ? blockButton('ws-workstations-remove', `− 缩减扩建工位（可删 ${removable}）`) : '')}</div>`,
      '', 'symbio-region-panel');
    const canvas = `<section class="symbio-panel symbio-layout-preview"><header class="symbio-panel-head"><h2>3D 空间预览</h2>${link('ws-layout-preview', '↗ 放大预览')}</header>
      <div class="symbio-layout-stage symbio-layout-stage-3d">
        ${officeViewport('office-3d-viewport','space','3D 空间布局')}
      </div>
      <footer><span>点击区域标牌查看实时工位与入座成员</span><div class="symbio-workstation-controls">
        <button type="button" data-action="office-orbit" data-id="-1" aria-label="向左旋转">↶</button>
        <button type="button" data-action="office-orbit" data-id="1" aria-label="向右旋转">↷</button>
        <button type="button" data-action="office-zoom-out" aria-label="缩小">−</button>
        <button type="button" data-action="office-zoom-reset" aria-label="还原视角">还原</button>
        <button type="button" data-action="office-zoom-in" aria-label="放大">＋</button>
      </div></footer>
      </section>`;
    const teams = [['', '未分配'], ...snapshot.teams.map(team => [team.id, team.name])];
    const zoneSeatsHtml = selectedStats.isDeskZone ? `<div class="symbio-zone-seats">
      <div class="symbio-inline"><h3>本区工位与入座成员</h3>${link('ws-layout-tab', '工位总览 →', 'seats')}</div>
      <ul>${selectedStats.indices.map(index => {
        const person = assigned.get(index);
        const code = workstationLabel(index);
        if (person) {
          return `<li><button type="button" data-action="office-person" data-id="${escape(person.key)}" aria-pressed="${ui.selectedOfficeActor() === person.key}">
            <span class="seat-code">${escape(code)}</span><strong>${escape(person.name)}</strong><small>${person.kind === 'agent' ? 'Agent' : '真人'}</small>
          </button></li>`;
        }
        const isCustom = index >= customSeatIndexStart;
        const canDelete = !isCustom && index >= baseWorkstations;
        return `<li class="seat-empty"><div><span class="seat-code">${escape(code)}</span><span>${isCustom ? '自由布置工位' : canDelete ? '扩建空位' : '空置工位'}</span>${canDelete
          ? `<button type="button" class="seat-delete-btn" data-action="ws-workstation-delete" data-id="${index}">删除</button>`
          : isCustom ? `<button type="button" class="seat-delete-btn" data-action="ws-layout-tab" data-id="decorate">调整</button>` : '<small>剩余</small>'}</div></li>`;
      }).join('')}</ul></div>` : '';
    const properties = panel('区域属性', `<div class="symbio-zone-properties">
      <div class="symbio-inline">${label(zoneNames[selected.type] ?? selected.type, 'green')}${isDuplicateZone ? link('ws-zone-remove', '移除多余区域', selected.id) : ''}</div>
      <label>区域名称<input data-zone-field="name" maxlength="36" value="${escape(selected.name)}"></label>
      <div class="symbio-seat-summary">
        <div class="symbio-inline"><span>${selectedStats.isDeskZone ? '3D 实体工位（自动同步）' : '3D 固定席位'}</span><strong>共 ${selectedStats.total} 个</strong></div>
        <p>${selectedStats.isDeskZone
          ? `已入座 ${selectedStats.occupied} 人 · 剩余 ${selectedStats.remaining} 个空位。不可手动虚增，如需扩充请先在 3D 图中新增工位。`
          : `由 3D 房间内实际家具决定（当前 ${selectedStats.occupied ? selectedStats.occupied + ' 人使用中' : '全部空闲'}）。`}</p>
        ${selectedStats.isDeskZone ? `<div class="symbio-seat-summary-actions">
          ${officeMode === 'custom'
            ? blockButton('ws-layout-tab', '前往自由布置 →', 'decorate')
            : blockButton('ws-workstations-add', '＋ 扩建 3D 工位') +
              (removable > 0 ? blockButton('ws-workstations-remove', '− 缩减工位') : '')}
        </div>` : ''}
      </div>
      <label>分配团队<span class="select-control"><select data-zone-field="teamId">${teams.map(([id, title]) =>
        `<option value="${escape(id)}"${id === (selected.teamId ?? '') ? ' selected' : ''}>${escape(title)}</option>`).join('')}</select></span></label>
      <div class="symbio-zone-toggles"><label>在实时大屏中显示<input data-zone-field="visible" type="checkbox" role="switch"${selected.visible ? ' checked' : ''}></label>
        <label>允许 Agent 自动入驻<input data-zone-field="autoAssign" type="checkbox" role="switch"${selected.autoAssign ? ' checked' : ''}></label></div>
      ${zoneSeatsHtml}
      </div>`, '', 'symbio-region-properties');
    const widgets = panel('监控组件', `<div class="symbio-widget-settings">${[
      ['metrics','关键指标','展示在线员工、执行中任务、完成数和人工介入'],['activity','协作动态','展示最近的任务与协作事件'],
      ['attention','需要你关注','展示任务验收和截止提醒'],
    ].map(([key, title, description]) => `<label><span><strong>${title}</strong><small>${description}</small></span>
      <input type="checkbox" role="switch" data-widget="${key}"${draft.widgets[key] ? ' checked' : ''}></label>`).join('')}</div>`);
    const topActions = layoutTab === 'seats' ? ''
      : layoutTab === 'decorate'
        ? `<span class="symbio-muted">${decorDirty ? '有未保存的 3D 布置修改' : '修改保存后立即同步到办公室'}</span>` +
          (decorDirty ? blockButton('ws-decor-reset', '放弃修改') : '') +
          blockButton('ws-decor-save', '保存 3D 布置', '', 'primary')
        : `<span class="symbio-muted">${layoutDirty ? '有未保存的修改' : layout.savedAt ? '已保存于 ' + escape(localTime(layout.savedAt).slice(0, 5)) : '工作空间布局'}</span>` +
          blockButton('ws-layout-save','保存草稿') + blockButton('ws-layout-publish','发布布局 ↗','','primary');
    return intro('5:21', '空间与工位', '查看 3D 办公室真实工位与入座分布，支持在 3D 图中自由拖拽摆放工位与装饰。',
      topActions,
      toolRow + (layoutTab === 'space' ? `<div class="symbio-layout-grid">${regionPanel}${canvas}${properties}</div>`
        : layoutTab === 'decorate' ? decorateWorkspace(snapshot)
          : layoutTab === 'seats' ? workstations(snapshot) : widgets),
      'symbio-layout');
  }

  function help() {
    return intro('help', '帮助中心', '管理项目、团队、Agent 和数字办公室。',
      '', `<div class="symbio-help-grid">${[
      ['项目与任务','创建项目，分配任务并验收 Agent 交付。','tasks'],
      ['员工与小队','维护真人档案、Agent 员工和团队归属。','people'],
      ['发现与接入','配对采集客户端并接入运行器；员工在智能体中创建和绑定。','discovery'],
      ['办公室布局','编辑区域与组件，保存草稿或发布到办公室。','layout'],
      ['设置','管理成员、任务配置、MCP 和个人偏好。','settings'],
      ['聊天','发起双人交流或多人会议，并查看发言记录。','conversations'],
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
          ${blockButton('agent-edit','创建 Agent 员工')}${blockButton('goto-discovery','接入运行器')}</div>`);
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
      case 'ws-decor-space-mode': {
        const nextMode = id === 'custom' ? 'custom' : 'default';
        const current = editableDecor();
        if (current.mode === nextMode) break;
        const snap = data();
        const assigned = seatAssignments(snap);
        mutateDecor(draft => {
          draft.mode = nextMode;
          if (nextMode === 'custom') {
            const occupiedDesks = draft.items.filter(item => item.type === 'desk' && Number.isInteger(item.seatIndex) && assigned.has(item.seatIndex));
            draft.walls = [];
            draft.rugs = [];
            draft.items = occupiedDesks;
            if (occupiedDesks.length) {
              const xs = occupiedDesks.map(i => i.x);
              const zs = occupiedDesks.map(i => i.z);
              draft.floors = [normalizeFloor({
                id: 'floor_' + Date.now().toString(36),
                x1: Math.min(...xs) - 2,
                z1: Math.min(...zs) - 2,
                x2: Math.max(...xs) + 2,
                z2: Math.max(...zs) + 2,
                material: floorMaterial,
              })];
            } else {
              draft.floors = [];
            }
            designTool = 'wall';
            placingType = null;
            selectedDecor = null;
          } else {
            draft.floors = [];
            const wingCount = snap.workstationCount ?? baseWorkstations;
            draft.walls = draft.walls.filter(w => validateWallPlacement(w, [], [], wingCount, w.id, 'default').ok);
            draft.rugs = draft.rugs.filter(r => validateRugPlacement(r, wingCount, 'default', []).ok);
            draft.items = draft.items.filter(item =>
              (item.type === 'desk' && Number.isInteger(item.seatIndex) && assigned.has(item.seatIndex)) ||
              validateItemPlacement(item, [], wingCount, item.id, draft.walls, 'default', []).ok
            );
            designTool = 'select';
            placingType = null;
            selectedDecor = null;
          }
        });
        break;
      }
      case 'ws-decor-mode':
        designTool = designTool === id && id !== 'select' ? 'select' : (id || 'select');
        placingType = null;
        if (designTool !== 'select') selectedDecor = null;
        render();
        break;
      case 'ws-decor-tool':
        if (id && !(designTool === 'place' && placingType === id)) {
          designTool = 'place';
          placingType = id;
          selectedDecor = null;
        } else {
          designTool = 'select';
          placingType = null;
        }
        render();
        break;
      case 'ws-wall-color':
        wallColor = id;
        render();
        break;
      case 'ws-floor-material':
        floorMaterial = id;
        render();
        break;
      case 'ws-rug-color':
        rugColor = id;
        render();
        break;
      case 'ws-floor-recolor': {
        const [floorId, nextMaterial] = id.split(':');
        mutateDecor(draft => {
          const f = draft.floors.find(entry => entry.id === floorId);
          if (f) f.material = nextMaterial;
        });
        break;
      }
      case 'ws-floor-autofill': {
        const current = editableDecor();
        if (current.walls.length < 2) throw new Error('请先绘制至少 2 面垂直墙体，再一键按外框铺满地板');
        const xs = current.walls.flatMap(w => [w.x1, w.x2]);
        const zs = current.walls.flatMap(w => [w.z1, w.z2]);
        const draftFloor = normalizeFloor({
          x1: Math.min(...xs),
          z1: Math.min(...zs),
          x2: Math.max(...xs),
          z2: Math.max(...zs),
          material: floorMaterial,
        });
        const check = validateFloorPlacement(draftFloor);
        if (!check.ok) throw new Error('当前墙体尚未围出有效空间（宽深至少 1.5m），请补画垂直墙或手动拖拽铺地板');
        const floorId = 'floor_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
        mutateDecor(draft => {
          draft.floors.push({...check.floor, id: floorId});
          selectedDecor = {kind: 'floor', id: floorId};
          designTool = 'select';
          placingType = null;
        });
        break;
      }
      case 'ws-wall-recolor': {
        const [wallId, nextColor] = id.split(':');
        mutateDecor(draft => {
          const w = draft.walls.find(entry => entry.id === wallId);
          if (w) w.color = nextColor;
        });
        break;
      }
      case 'ws-rug-recolor': {
        const [rugId, nextColor] = id.split(':');
        mutateDecor(draft => {
          const r = draft.rugs.find(entry => entry.id === rugId);
          if (r) r.color = nextColor;
        });
        break;
      }
      case 'ws-wall-door-center': {
        const decor = editableDecor();
        const wall = decor.walls.find(w => w.id === id);
        if (!wall) break;
        const check = validateDoorPlacement(wall, wallLength(wall) / 2);
        if (!check.ok) throw new Error(check.reason);
        mutateDecor(draft => {
          const target = draft.walls.find(w => w.id === id);
          if (target) target.doors = [...(target.doors ?? []), check.offset].sort((a, b) => a - b);
        });
        break;
      }
      case 'ws-wall-door-remove': {
        const [wallId, idxStr] = id.split(':');
        const idx = Number(idxStr);
        mutateDecor(draft => {
          const target = draft.walls.find(w => w.id === wallId);
          if (target?.doors) target.doors.splice(idx, 1);
        });
        break;
      }
      case 'ws-decor-select': {
        const [kind, targetId] = id.split(':');
        designTool = 'select';
        placingType = null;
        selectedDecor = selectedDecor?.kind === kind && selectedDecor?.id === targetId ? null : {kind, id: targetId};
        render();
        break;
      }
      case 'ws-decor-rotate':
        rotateSelectedOrPlacing(Number(id) || 90);
        break;
      case 'ws-decor-angle': {
        if (selectedDecor?.kind !== 'item') break;
        const decor = editableDecor();
        const target = decor.items.find(item => item.id === selectedDecor.id);
        if (!target) break;
        const deg = normalizeRotation(Number(id));
        const check = validateItemPlacement({...target, rotation: deg}, decor.items, data().workstationCount ?? baseWorkstations, target.id, decor.walls, decor.mode, decor.floors);
        if (!check.ok) throw new Error('旋转后' + check.reason);
        mutateDecor(draft => {
          const entry = draft.items.find(item => item.id === selectedDecor.id);
          if (entry) entry.rotation = deg;
        });
        break;
      }
      case 'ws-decor-delete': {
        const [kind, targetId] = id.includes(':') ? id.split(':') : ['item', id];
        deleteSelectedDecor({kind, id: targetId});
        break;
      }
      case 'ws-decor-clear':
        mutateDecor(draft => {
          draft.items = draft.items.filter(item => item.type === 'desk');
          draft.walls = [];
          draft.rugs = [];
          if (!draft.items.length) draft.floors = [];
          if (selectedDecor && (selectedDecor.kind !== 'item' || !draft.items.some(i => i.id === selectedDecor.id))) {
            selectedDecor = null;
          }
        });
        break;
      case 'ws-decor-undo':
        if (!decorHistory.length) break;
        decorFuture.push(structuredClone(editableDecor()));
        decorDraft = decorHistory.pop();
        decorDirty = true;
        selectedDecor = null;
        render();
        break;
      case 'ws-decor-redo':
        if (!decorFuture.length) break;
        decorHistory.push(structuredClone(editableDecor()));
        decorDraft = decorFuture.pop();
        decorDirty = true;
        selectedDecor = null;
        render();
        break;
      case 'ws-decor-reset':
        decorDirty = false;
        decorDraft = null;
        decorHistory = [];
        decorFuture = [];
        designTool = 'select';
        placingType = null;
        selectedDecor = null;
        render();
        break;
      case 'ws-decor-save': {
        const current = editableDecor();
        const result = await api('layout/items', {
          mode: current.mode,
          floors: current.floors,
          items: current.items,
          walls: current.walls,
          rugs: current.rugs,
        });
        decorDraft = {
          mode: result.mode === 'custom' ? 'custom' : 'default',
          floors: structuredClone(result.floors ?? []),
          items: structuredClone(result.items ?? []),
          walls: structuredClone(result.walls ?? []),
          rugs: structuredClone(result.rugs ?? []),
        };
        decorDirty = false;
        decorHistory = [];
        decorFuture = [];
        designTool = 'select';
        placingType = null;
        selectedDecor = null;
        break;
      }
      case 'ws-workstations-add':
        edit('在 3D 图中扩建工位', input('新增实体工位数量','amount',2,{type:'number',min:1,max:24,required:true}) +
          '<p class="description">将在 3D 办公室东侧（AI 运行区）实际扩建对应数量的工位桌椅，并自动计入可用空位。</p>',
        form => api('layout/workstations',{amount:Number(form.get('amount'))}), '扩建 3D 工位');
        break;
      case 'ws-workstations-remove': {
        const removable = removableWorkstations(data());
        if (!removable) throw new Error('没有可删除的空余扩建工位（基础 12 个工位或已入座工位不可删除）');
        edit('缩减 3D 扩建工位', input('删除空余扩建工位数量', 'amount', Math.min(2, removable), {type:'number', min:1, max:removable, required:true}) +
          `<p class="description">当前可删除 ${removable} 个通过 3D 图扩建的空余工位；基础 12 个工位与已入座工位受保护不可删除。</p>`,
        form => api('layout/workstations/remove', {amount: Number(form.get('amount'))}), '确认删除');
        break;
      }
      case 'ws-workstation-delete':
        await api('layout/workstations/remove', {index: Number(id)});
        break;
      case 'ws-zone': selectedZone = id; render(); break;
      case 'ws-zone-remove': mutateLayout(draft => {
        if (draft.zones.length <= 1) return;
        draft.zones = draft.zones.filter(zone => zone.id !== id);
        if (selectedZone === id) selectedZone = draft.zones[0].id;
      }); break;
      case 'ws-layout-name': edit('空间名称', input('名称','title',editableLayout().title,{required:true}),
        form => mutateLayout(draft => { draft.title = form.get('title').trim(); })); break;
      case 'ws-layout-preview': {
        const draft = editableLayout();
        const snapshot = data();
        const assigned = seatAssignments(snapshot);
        ui.showPanel('布局预览 · ' + draft.title,
          `<div class="symbio-layout-stage symbio-layout-stage-3d symbio-layout-modal">
            ${officeViewport('office-layout-dialog-viewport','space','3D 布局预览')}
          </div>
          <div class="stack">${draft.zones.map(zone => {
            const stats = zoneSeatStats(zone, snapshot, assigned);
            return `<div class="symbio-inline"><strong>${escape(zone.name)}</strong><span>${stats.isDeskZone ? `共 ${stats.total} 工位 · 余 ${stats.remaining}` : `${stats.total} 个共享席位`}</span></div>`;
          }).join('')}</div>`);
        break;
      }
      case 'ws-layout-save':
      case 'ws-layout-publish': {
        const currentCount = data().workstationCount ?? baseWorkstations;
        const currentItems = data().officeItems ?? [];
        const currentMode = data().officeMode === 'custom' ? 'custom' : 'default';
        const syncedDraft = structuredClone(editableLayout());
        for (const zone of syncedDraft.zones) zone.capacity = Math.max(1, physicalZoneCapacity(zone.type, currentCount, currentItems, currentMode));
        const saved = await api('layout/' + (type === 'ws-layout-save' ? 'draft' : 'publish'), {
          revision: layoutRevision, draft: syncedDraft,
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
    const profileMenu = document.getElementById('profile-menu');
    const profileTrigger = document.querySelector('.symbio-profile');
    profileMenu.addEventListener('beforetoggle', event => {
      const opening = event.newState === 'open';
      profileTrigger.setAttribute('aria-expanded', String(opening));
      if (!opening) return;
      const user = data().user;
      const items = [['account-open','个人资料','', 'account'],
        ...(user.role === 'admin' ? [
          ['account-users','账号与权限','', 'users'], ['ws-nav','设置','settings','settings'],
        ] : []), ['account-logout','退出登录','','logout']];
      const icons = {
        account:'<circle cx="10" cy="6" r="3"/><path d="M4 17v-2a6 6 0 0 1 12 0v2"/>',
        users:'<circle cx="7" cy="6" r="3"/><path d="M1 17v-2a6 6 0 0 1 12 0v2M13 3a3 3 0 0 1 0 6m2 3a5 5 0 0 1 4 5"/>',
        settings:'<path d="M3 5h14M3 10h14M3 15h14M7 3v4m6 1v4m-6 1v4"/>',
        finance:'<rect x="3" y="2" width="14" height="16" rx="2"/><path d="M6 6h8M6 10h3m3 0h2m-8 4h3m3 0h2"/>',
        discovery:'<circle cx="9" cy="9" r="6"/><path d="m14 14 4 4M6 9h6M9 6v6"/>',
        chat:'<path d="M4 3h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8l-5 3v-3a2 2 0 0 1-1-2V5a2 2 0 0 1 2-2Z"/>',
        logout:'<path d="M8 3H3v14h5m-1-7h11m-4-4 4 4-4 4"/>',
      };
      profileMenu.innerHTML = `<div class="profile-menu-heading" role="presentation"><strong>${escape(user.name)}</strong><small>${user.role === 'admin' ? '工作空间管理员' : '工作空间成员'}</small></div>` +
        items.map(([type,title,id,icon],index) => `<button type="button" role="menuitem" ${index === 0 ? 'autofocus' : ''}
          class="profile-menu-item ${icon === 'logout' ? 'profile-menu-logout' : ''}" data-action="${type}" data-id="${id}">
          <svg viewBox="0 0 20 20" aria-hidden="true">${icons[icon]}</svg><span>${title}</span></button>`).join('');
      const bounds = profileTrigger.getBoundingClientRect();
      profileMenu.style.right = Math.max(12, window.innerWidth - bounds.right) + 'px';
      profileMenu.style.top = Math.min(bounds.bottom + 12, window.innerHeight - 100) + 'px';
      profileMenu.style.maxHeight = Math.max(80, window.innerHeight - bounds.bottom - 24) + 'px';
    });
    profileMenu.addEventListener('click', event => {
      if (event.target.closest('[role="menuitem"]')) profileMenu.hidePopover();
    });
    profileMenu.addEventListener('keydown', event => {
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const items = [...profileMenu.querySelectorAll('[role="menuitem"]')];
      const current = items.indexOf(document.activeElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[index]?.focus();
    });
    profileTrigger.addEventListener('keydown', event => {
      if (!['ArrowDown','ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      profileMenu.showPopover();
      const items = profileMenu.querySelectorAll('[role="menuitem"]');
      items[event.key === 'ArrowUp' ? items.length - 1 : 0]?.focus();
    });
    window.addEventListener('resize', () => profileMenu.hidePopover());
    window.addEventListener('hashchange', () => profileMenu.hidePopover());
    document.getElementById('workspace-search-input').addEventListener('input', searchResults);
    document.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && data() && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        ui.action('ws-search');
        return;
      }
      if (layoutTab !== 'decorate' || !document.querySelector('[data-layout-preview="decorate"]') || document.querySelector('dialog[open]')) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      const key = event.key.toLowerCase();
      if (key === 'r') {
        event.preventDefault();
        rotateSelectedOrPlacing(90);
      } else if (key === 'escape') {
        if (designTool !== 'select' || placingType || selectedDecor) {
          designTool = 'select';
          placingType = null;
          selectedDecor = null;
          render();
        }
      } else if ((key === 'delete' || key === 'backspace') && selectedDecor) {
        event.preventDefault();
        try { deleteSelectedDecor(selectedDecor); } catch {}
      } else if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        action(event.shiftKey ? 'ws-decor-redo' : 'ws-decor-undo');
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
  }

  function closeMobile() {
    mobileOpen = false;
    document.body.classList.remove('symbio-mobile-open');
    document.querySelector('.symbio-mobile-menu').setAttribute('aria-expanded','false');
  }

  return {renderShell, workbench, people, agentPage, layoutEditor, layoutSceneZones, layoutSceneDesks, layoutDesignConfig,
    activeOfficeDecor: () => layoutTab === 'decorate' ? editableDecor() : {
      mode: data()?.officeMode === 'custom' ? 'custom' : 'default',
      floors: data()?.officeFloors ?? [],
      items: data()?.officeItems ?? [],
      walls: data()?.officeWalls ?? [],
      rugs: data()?.officeRugs ?? [],
    },
    help, action, hydrate, bind,
    selectLayoutTab(tab) { layoutTab = ['decorate','seats','widgets'].includes(tab) ? tab : 'space'; },
    dragging: () => false, closeMobile};
}
