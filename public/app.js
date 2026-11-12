import { createOverview, officeOverview } from './overview.js';
import { createWorkspaceView } from './workspace.js';
import { avatarFields, officeAvatars, resolveAvatar } from './office-avatars.js';
import { createOfficeStrolls, officePresence } from './office-presence.js';

const el = id => document.getElementById(id);
const modalOpeners = new WeakMap();

function openModal(id) {
  const modal = el(id);
  if (modal.open) return;
  modalOpeners.set(modal, document.activeElement);
  modal.showModal();
  modal.querySelector('.modal-body').scrollTop = 0;
}
const providerLabels = {
  codex: 'Codex', pi: 'Pi', claude: 'Claude Code', gemini: 'Gemini CLI', opencode: 'OpenCode',
  aider: 'Aider', cursor: 'Cursor Agent', copilot: 'Copilot CLI', qwen: 'Qwen Code',
  kiro: 'Kiro CLI', openclaw: 'OpenClaw',
};
const runtimeLabels = {codex: 'Codex', pi: 'Pi', demo: '演示运行器', observed: '仅采集'};
const machineLabels = {awaiting: '等待配对', online: '在线', offline: '离线', revoked: '已撤销'};
const roleLabels = {worker: '执行员工', lead: '项目负责人', hr: '人事', finance: '财务'};
const labels = {
  backlog: '待规划', todo: '待办', in_progress: '进行中', review: '审核中', done: '已完成', blocked: '已阻塞',
  queued: '排队中', running: '运行中', stopping: '正在停止', completed: '已完成',
  failed: '失败', interrupted: '意外中断', cancelled: '已取消', active: '讨论中',
  paused: '已暂停', closed: '已结束',
};
const eventLabels = {
  'run.queued': '排队', 'run.started': '启动', 'run.workspace': '工作目录', 'run.activity': '运行器状态',
  'run.completed': '执行完成', 'run.failed': '执行失败', 'run.stopping': '请求停止',
  'run.cancelled': '执行取消', 'run.interrupted': '执行中断', 'plan.updated': '计划更新',
  'tool.started': '工具开始', 'tool.completed': '工具完成', 'tool.failed': '工具失败',
  'message.final': '收到最终输出', 'usage.updated': '收到 Token 用量', 'artifact.created': '产出文件',
  'runtime.error': '运行器报错', 'runtime.warning': '运行器提示',
  'runtime.input': '提交任务输入', 'runtime.first_output': '收到首段可见文本', 'runtime.finished': '运行器返回',
  'space.delivery': '归档项目交付', 'space.conflict': '发布版本冲突', 'space.published': '发布项目文件', 'space.returned': '退回项目交付',
  'task.saved': '保存任务', 'agent.saved': '保存员工', 'budget.updated': '更新预算',
};
let data, page = 'overview', feed, selectedRun, refreshTimer, refreshPending, saveForm, noticeTimer;
let refreshAgain = false;
let settingsPage = 'workspace', inboxData, auditData;
let signedInUser, usersData, accountMode, reloadingAccount = false;
let overviewData, overviewDetails, officeZoom = 100, fullscreenMode;
let officeScene, officeModule, figurePreview, officeFlat = false, office3dUnavailable = false;
let sceneActors = [], selectedActor;
const officeStrolls = createOfficeStrolls();
let fullTaskBoard = false;
let taskFilters = {}, taskFilterDraft = {};
let boardScope = 'all', boardFilterOpen = false, boardShowMeta = true, boardHideEmpty = false;
let boardMenuAnchor, boardSubmenuAnchor;
const boardScopes = {all: '全部', assigned: '已分配', unassigned: '未分配', project: '项目任务'};
const priorityLabels = {none: '无', low: '低', medium: '中', high: '高', urgent: '紧急'};
const propertyLabels = {text: '文本', number: '数字', select: '单选'};
const notificationLabels = {review: '任务待验收', failures: '执行失败或中断', hiring: '入职档案待确认', machines: '采集机器离线',
  mentions: '任务评论中的 @ 提及'};
const settingsGroups = {
  '个人': {account: '我的账户', preferences: '偏好', notifications: '通知'},
  '工作区': {workspace: '基本资料', workflow: '任务流程', labels: '标签', properties: '自定义字段'},
  '管理': {users: '用户管理', runtime: '运行与采集', organization: '组织与预算', audit: '变更记录'},
};
const settingsTitles = Object.assign({}, ...Object.values(settingsGroups));
const memberPages = new Set(['tasks', 'settings', 'inbox', 'help']);
const memberSettings = new Set(['account', 'preferences']);
const accountRoles = {admin:'管理员', member:'普通成员'};
const accountStates = {pending:'待审批', active:'已启用', disabled:'已停用'};
const memberActions = new Set([
  'account-open', 'account-password', 'account-mention-email', 'account-logout', 'settings-section', 'setting-edit', 'inbox-read',
  'ws-mobile-menu', 'ws-profile', 'ws-period', 'ws-all-tasks', 'ws-projects', 'ws-day', 'ws-month',
  'project-tasks', 'project-space', 'space-tab', 'space-preview', 'space-delivery', 'space-compare',
  'task-view', 'task-discussion-view', 'task-filters-clear', 'task-view-switch', 'task-jump-comment',
  'task-reply', 'task-remove-mention', 'task-compose', 'board-scope', 'board-filter', 'board-display',
  'board-show-meta', 'board-hide-empty', 'board-task-menu', 'board-copy-link', 'board-column-menu', 'board-column-filter',
]);
const isMember = () => signedInUser?.role === 'member';
const actionAllowed = (type, id) => !isMember() || (memberActions.has(type) &&
  (!['setting-edit', 'settings-section'].includes(type) || memberSettings.has(id)));

function restrictMemberControls(root) {
  if (!isMember()) return;
  for (const button of root.querySelectorAll('button[data-action], button[data-page], button[data-board-submenu]')) {
    if (button.dataset.boardSubmenu || (button.dataset.page && !memberPages.has(button.dataset.page)) ||
        (button.dataset.action && !actionAllowed(button.dataset.action, button.dataset.id))) {
      button.classList.add('account-restricted');
    }
  }
}
const prefDefaults = {theme: 'system', taskView: 'board', timeZone: 'local'};
let preferences = {...prefDefaults};
try {
  preferences = {...preferences, ...JSON.parse(localStorage.getItem('office.preferences') ?? '{}')};
} catch {}
const darkMode = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  document.documentElement.dataset.theme = preferences.theme === 'system'
    ? (darkMode.matches ? 'dark' : 'light') : preferences.theme;
}
applyTheme();
darkMode.addEventListener('change', applyTheme);
const active = ['queued', 'running', 'stopping'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const find = (collection, id) => data[collection]?.find(record => record.id === id);
const name = (collection, id) => find(collection, id)?.name ?? '—';
const badge = (status, label = labels[status] ?? status) =>
  `<span class="badge ${escape(status)}">${escape(label)}</span>`;
const btn = (action, label, id = '', primary = false) =>
  `<button type="button" data-action="${escape(action)}" data-id="${escape(id)}"${primary ? ' class="primary"' : ''}>${escape(label)}</button>`;
const actions = (...items) => `<div class="actions">${items.join('')}</div>`;
const empty = text => `<p class="empty">${escape(text)}</p>`;
const section = (title, desc, controls = '') =>
  `<div class="section-head"><div><h1>${title}</h1><p>${desc}</p></div>${controls}</div>`;
const timeOptions = () => preferences.timeZone === 'local' ? {} : {timeZone: preferences.timeZone};
const localTime = value => new Date(value).toLocaleTimeString('zh-CN', {hour12: false, ...timeOptions()});
const localDateTime = value => new Date(value).toLocaleString('zh-CN', timeOptions());
const number = value => value == null ? '—' : value.toLocaleString('zh-CN');
const overview = createOverview({escape, btn, number, name, find, empty,
  localTime: value => new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false, ...timeOptions(),
  })});

function overviewOptions() {
  return {zoom: officeZoom, live: feed?.readyState === EventSource.OPEN, fullscreen: Boolean(fullscreenMode),
    flat:officeFlat, sceneUnavailable:office3dUnavailable, actors:sceneActors, selectedActor, ...timeOptions()};
}

function overviewScreen() {
  const model = officeOverview(data, overviewData, timeOptions());
  sceneActors = officePresence(data, model);
  return overview.render(data, overviewData, overviewOptions(), model);
}

const loadOffice3d = () => officeModule ??= import('./office-scene.js');

function officeSceneHost() {
  if (el('overview-dialog').open && el('office-layout-dialog-viewport')) return el('office-layout-dialog-viewport');
  return el('office-3d-viewport');
}

function renderOfficeScene() {
  const host = officeSceneHost();
  if (!host) {
    officeScene?.dispose();
    officeScene = undefined;
    return;
  }
  const mount = factory => {
    if (officeSceneHost() !== host) return;
    officeScene ??= factory(host,officeStrolls);
    officeScene.mount(host);
    if (host.hasAttribute('data-layout-preview')) sceneActors = officePresence(data,officeOverview(data,null,timeOptions()));
    const {visible,total} = officeScene.update(sceneActors,officeZoom,selectedActor,data.workstationCount);
    officeScene.updateZones(host.dataset.layoutPreview === 'space' ? workspaceView.layoutSceneZones() : []);
    const capacity = el('office-scene-capacity');
    if (capacity && visible < total) {
      capacity.hidden = false;
      capacity.textContent = `场景显示 ${visible} / ${total} 名角色，全部角色可在上方列表查看。`;
    }
  };
  if (officeScene) {
    mount();
    return;
  }
  loadOffice3d().then(({createOfficeScene}) => mount(createOfficeScene)).catch(() => {
    if (officeSceneHost() !== host) return;
    if (host.hasAttribute('data-layout-preview')) {
      host.querySelector('.office-scene-loading').textContent = '当前浏览器无法显示 3D 预览。';
      return;
    }
    office3dUnavailable = officeFlat = true;
    render();
  });
}

function renderAvatarPreview() {
  figurePreview?.dispose();
  figurePreview = undefined;
  const field = el('fields').querySelector('[data-avatar-field]');
  if (!field) return;
  const host = field.querySelector('[data-avatar-preview]');
  const controls = field.querySelector('[data-avatar-state]');
  function update() {
    const choice = field.querySelector('input:checked')?.value;
    const id = choice && choice !== 'auto' ? choice : field.dataset.defaultAvatar;
    const avatar = officeAvatars.find(item => item.id === id);
    host.querySelector('span').textContent = avatar.name + ' · ' + avatar.detail;
    figurePreview?.preview(avatar,controls.value);
  }
  field.addEventListener('change', update);
  update();
  loadOffice3d().then(({createFigurePreview}) => {
    if (!field.isConnected || !el('dialog').open) return;
    figurePreview = createFigurePreview(host);
    update();
  }).catch(() => {});
}

function showOverviewDetails(id) {
  const {title, body} = overview.details(id, data, overviewData, overviewOptions());
  showPanel(title, body);
  overviewDetails = id;
}

function showPanel(title, body) {
  overviewDetails = undefined;
  el('overview-dialog-title').textContent = title;
  el('overview-dialog-body').innerHTML = body;
  restrictMemberControls(el('overview-dialog-body'));
  openModal('overview-dialog');
  if (el('office-layout-dialog-viewport')) renderOfficeScene();
}

function endOverviewFullscreen() {
  fullscreenMode = undefined;
  document.body.classList.remove('overview-expanded', 'office-map-focus');
  if (document.fullscreenElement === el('main')) document.exitFullscreen().catch(() => {});
}

function toggleOverviewFullscreen(mode) {
  if (fullscreenMode === mode) {
    endOverviewFullscreen();
  } else {
    fullscreenMode = mode;
    document.body.classList.add('overview-expanded');
    document.body.classList.toggle('office-map-focus', mode === 'map');
    if (!document.fullscreenElement && el('main').requestFullscreen) {
      el('main').requestFullscreen().catch(() => {});
    }
  }
  render();
}

async function api(path, payload) {
  const options = payload === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload),
  };
  const result = await fetch('/api/' + path, options);
  const value = await result.json();
  if ([401, 428].includes(result.status) && signedInUser && !path.startsWith('auth/')) reloadAccount();
  if (!result.ok) throw Object.assign(new Error(value.error || '请求失败'), {status:result.status});
  return value;
}

function reloadAccount() {
  if (reloadingAccount) return;
  reloadingAccount = true;
  feed?.close();
  location.reload();
}

function errorNotice(error) {
  el('notice').textContent = error.message;
  el('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el('notice').hidden = true; }, 5000);
}

const workflowName = status => data.settings?.workflow.names[status] ?? labels[status];
const taskKey = task => task.number ? (data.settings?.workspace.taskPrefix ?? 'AG') + '-' + task.number : '';
const taskPriority = task => task.priority && task.priority !== 'none' ? priorityLabels[task.priority] : '';
const assignedName = task => [task.assigneeId ? name('agents', task.assigneeId) : '',
  task.humanId ? name('humans', task.humanId) : ''].filter(Boolean).join(' · ') || '—';
const labelBadges = task => (task.labelIds ?? []).map(id => data.settings?.labels.find(item => item.id === id))
  .filter(Boolean).map(item => badge('label-' + item.color, item.name)).join('');
const taskFields = task => (data.settings?.properties ?? []).filter(item => task.properties?.[item.id] != null)
  .map(item => [item.name + (item.archived ? '（已归档）' : ''), String(task.properties[item.id])]);
const unresolvedSubtasks = id => data.tasks.some(task => task.parentId === id && !['done', 'cancelled'].includes(task.status));

function taskActions(task, run) {
  return actions(
    btn('task-view', '详情', task.id),
    task.status !== 'in_progress' ? btn('task-edit', '编辑', task.id) : '',
    task.assigneeId && ['todo', 'blocked'].includes(task.status) && !awaitingSchedule(task)
      ? btn('task-run', task.status === 'blocked' ? '重试' : '启动', task.id, true) : '',
    task.status === 'review' ? btn('task-done', '验收', task.id, true) : '',
    ['review', 'done', 'cancelled', 'backlog'].includes(task.status) ? btn('task-reopen', '移至待办', task.id) : '',
    run ? btn('run-view', '执行详情', run.id) : '',
  );
}

const boardIcons = {
  list: '<path d="M8 6h12M8 12h12M8 18h12M3 6h1M3 12h1M3 18h1"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-16v16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
  filter: '<path d="M3 4h18l-7 8v5l-4 3v-8z"/>',
  display: '<path d="M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6"/>',
  user: '<circle cx="10" cy="7" r="3"/><path d="M3 20v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2m2-12h3m-1.5-1.5v3"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2 2"/>',
  edit: '<path d="m14 6 4 4M4 20l4-1 12-12a1.4 1.4 0 0 0 0-2l-1-1a1.4 1.4 0 0 0-2 0L5 16z"/>',
  play: '<path d="m8 5 12 7-12 7z"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  link: '<path d="m10 14 4-4m-6 6-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m2 6a3 3 0 0 0 4 0l4-4a3 3 0 0 0-4-4l-1 1"/>',
  external: '<path d="M13 4h7v7m0-7-9 9m9 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/>',
  arrow: '<path d="m14 6-6 6 6 6"/>',
};
const boardIcon = icon => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${boardIcons[icon]}</svg>`;
const stateMarks = {
  in_progress: '<path d="M8 3.2a4.8 4.8 0 0 1 0 9.6z" fill="currentColor" stroke="none"/>',
  review: '<path d="M8 3.2a4.8 4.8 0 1 1-4.8 4.8H8z" fill="currentColor" stroke="none"/>',
  blocked: '<path d="m3.6 3.6 8.8 8.8"/>',
  done: '<path d="m4.7 8.1 2.1 2.2 4.6-4.7" stroke="white"/>',
  cancelled: '<path d="m5.7 5.7 4.6 4.6m0-4.6-4.6 4.6"/>',
};
const statusIcon = status => `<svg class="task-state-icon" data-status="${escape(status)}" viewBox="0 0 16 16"
  fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="8" cy="8" r="6.35"/>${stateMarks[status] ?? ''}</svg>`;

function priorityIcon(priority = 'none') {
  const level = {low: 1, medium: 2, high: 3}[priority];
  const mark = level ? [4, 7, 10].map((height, index) =>
    `<rect x="${2 + index * 4.5}" y="${13 - height}" width="3" height="${height}" rx=".65" opacity="${index < level ? 1 : .28}"/>`).join('')
    : priority === 'urgent' ? '<path d="M8 3.6v5.1m0 2.8v.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
      : '<path d="M3.5 8h9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>';
  return `<svg class="task-priority-icon" data-priority="${escape(priority)}" viewBox="0 0 16 16"
    fill="currentColor" aria-hidden="true">${mark}</svg>`;
}

function boardButton(action, label, id = '', icon = '', {compact = false, active = false, popup = false} = {}) {
  return `<button type="button" class="task-board-button${compact ? ' icon-only' : ''}${action === 'board-task-field' ? ' chevron-trigger chevron-next' : ''}" data-action="${action}" data-id="${escape(id)}"
    ${compact ? `aria-label="${escape(label)}" title="${escape(label)}"` : ''}
    ${active ? 'aria-pressed="true"' : ''}${popup ? 'aria-controls="task-board-menu" aria-expanded="false"' : ''}>
    ${icon ? boardIcon(icon) : ''}${compact ? '' : escape(label)}</button>`;
}

function taskUpdated(task) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(task.updatedAt ?? task.createdAt)) / 60_000));
  if (!Number.isFinite(minutes)) return '—';
  if (!minutes) return '刚刚更新';
  if (minutes < 60) return `更新于 ${minutes} 分钟前`;
  if (minutes < 1440) return `更新于 ${Math.floor(minutes / 60)} 小时前`;
  return `更新于 ${Math.floor(minutes / 1440)} 天前`;
}

function taskCard(task) {
  const run = find('runs', task.lastRunId);
  const owner = find('agents', task.assigneeId) ?? find('humans', task.humanId);
  const ownerName = owner?.name ?? '未分配';
  const team = owner?.teamId ? name('teams', owner.teamId) : ownerName;
  return `<article class="task-board-card" data-task-card="${escape(task.id)}">
    <div class="task-board-card-head"><span>${escape(taskKey(task))}</span>
      ${taskPriority(task) ? `<span class="task-board-value" title="${escape(taskPriority(task))}优先级" aria-label="${escape(taskPriority(task))}优先级">
        ${priorityIcon(task.priority)}</span>` : ''}
      ${boardButton('board-task-menu', '任务操作', task.id, 'more', {compact:true,popup:true})}
    </div>
    <button type="button" class="task-board-card-title" data-action="task-view" data-id="${escape(task.id)}">${escape(task.title)}</button>
    ${task.scheduledAt ? `<p class="task-board-activity">${escape(taskScheduleLabel(task))}</p>` : ''}
    ${run && active.includes(run.status) ? `<p class="task-board-activity">${escape(run.activity || labels[run.status])}</p>` : ''}
    ${boardShowMeta ? `<div class="task-board-card-meta">
      <span title="${escape(ownerName)}">${boardIcon('user')} <span>${escape(team)}</span></span>
      <time datetime="${escape(task.updatedAt ?? task.createdAt)}" title="${escape(localDateTime(task.updatedAt ?? task.createdAt))}">${escape(taskUpdated(task))}</time>
    </div>` : ''}
  </article>`;
}

function filteredTasks() {
  const {q, project, assignee, priority, label, status} = taskFilters;
  const query = q?.trim().toLowerCase();
  const priorityRank = Object.keys(priorityLabels);
  return data.tasks.filter(task => !task.parentId).filter(task => {
    const assigned = task.assigneeId || task.humanId;
    const inScope = boardScope === 'all' || (boardScope === 'assigned' && assigned) ||
      (boardScope === 'unassigned' && !assigned) || (boardScope === 'project' && task.projectId);
    return inScope && (!project || task.projectId === project) && (!status || task.status === status) &&
      (!assignee || [task.assigneeId, task.humanId].includes(assignee)) && (!priority || (task.priority || 'none') === priority) &&
      (!label || task.labelIds?.includes(label)) &&
      (!query || [taskKey(task), task.title, task.description, ...taskFields(task).map(([, value]) => value)]
        .join(' ').toLowerCase().includes(query));
  })
    .sort((a, b) => priorityRank.indexOf(b.priority || 'none') - priorityRank.indexOf(a.priority || 'none') ||
      (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (b.number ?? 0) - (a.number ?? 0));
}

function taskFilterBar() {
  const tags = (data.settings?.labels ?? []).filter(item => !item.archived).map(item => [item.id, item.name]);
  return `<form id="task-filters" class="task-filters">
    ${input('搜索任务', 'q', taskFilterDraft.q, {type: 'search'})}
    ${select('项目', 'project', [['', '全部'], ...options('projects')], taskFilterDraft.project)}
    ${select('负责人', 'assignee', [['', '全部'], ...options('agents'), ...options('humans')], taskFilterDraft.assignee)}
    ${select('状态', 'status', [['', '全部'], ...data.taskStates.map(status => [status, workflowName(status)])], taskFilterDraft.status)}
    ${select('优先级', 'priority', [['', '全部'], ...Object.entries(priorityLabels)], taskFilterDraft.priority)}
    ${select('标签', 'label', [['', '全部'], ...tags], taskFilterDraft.label)}
    <button type="submit">筛选</button>${btn('task-filters-clear', '清空')}
  </form>`;
}

function tasksList(items) {
  if (!items.length) return empty('没有匹配的任务。');
  return `<div class="table"><table><thead><tr><th>编号</th><th>任务</th><th>状态</th><th>负责人</th>
    <th>优先级</th><th>截止日期</th><th>标签</th><th>操作</th></tr></thead>
    <tbody>${items.map(task => `<tr>
    <td class="task-key">${escape(taskKey(task))}</td><td>${escape(task.title)}
      ${task.scheduledAt ? `<small class="task-board-activity">${escape(taskScheduleLabel(task))}</small>` : ''}</td>
    <td><span class="task-board-value">${statusIcon(task.status)}${escape(workflowName(task.status))}</span></td><td>${escape(assignedName(task))}</td>
    <td><span class="task-board-value">${priorityIcon(task.priority)}${escape(taskPriority(task) || '无优先级')}</span></td><td>${escape(task.dueDate || '—')}</td>
    <td>${labelBadges(task)}</td><td>${taskActions(task, find('runs', task.lastRunId))}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

let taskView;
function tasks() {
  const running = new Set(data.runs.filter(run => ['running', 'stopping'].includes(run.status)).map(run => run.agentId)).size;
  const items = filteredTasks();
  const view = taskView ?? preferences.taskView;
  const filterCount = Object.values(taskFilters).filter(Boolean).length;
  return `<header class="task-board-header">
    <div>${boardButton('ws-nav', '返回项目工作台', 'tasks', 'arrow', {compact:true})}<h1>我的任务</h1></div>
    ${boardButton('task-edit', '新建任务', '', 'plus')}
  </header>
  <div class="task-board-toolbar">
    <div class="task-board-controls" aria-label="任务范围">${Object.entries(boardScopes).map(([scope, label]) =>
      boardButton('board-scope', label, scope, '', {active:boardScope === scope})).join('')}</div>
    <div class="task-board-controls">
      <span class="task-board-running"><i></i>${running} 个智能体工作中</span>
      ${boardButton('board-filter', '筛选' + (filterCount ? ' · ' + filterCount : ''), '', 'filter', {active:boardFilterOpen})}
      ${boardButton('board-display', '显示', '', 'display', {popup:true})}
      ${boardButton('task-view-switch', view === 'list' ? '列表' : '看板', '', view === 'list' ? 'list' : 'board')}
    </div>
  </div>${boardFilterOpen ? taskFilterBar() : ''}
  ${view === 'list' ? `<div class="task-board-list">${tasksList(items)}</div>` :
    `<div class="board task-lanes" tabindex="0" aria-label="按状态分组的任务">${data.taskStates.map(status => {
      const column = items.filter(task => task.status === status);
      if (boardHideEmpty && !column.length) return '';
      return `<section class="column task-lane" data-state="${status}"><header>
        ${statusIcon(status)}<h2>${escape(workflowName(status))}</h2><span>${column.length}</span>
        <div class="task-lane-actions">${boardButton('board-column-menu', workflowName(status) + '列操作', status, 'more', {compact:true,popup:true})}
          ${boardButton('board-new-task', '新建待办任务', status, 'plus', {compact:true})}</div>
        </header><div class="task-lane-cards">${column.map(taskCard).join('') || '<p class="task-lane-empty">无任务</p>'}</div></section>`;
    }).join('') || '<p class="task-lane-empty">没有匹配的任务</p>'}</div>`}`;
}

const boardTaskLink = id => new URL('/office#tasks/all/' + id, location.href).href;

function closeBoardSubmenu(restoreFocus = false) {
  el('task-board-submenu').hidden = true;
  if (boardSubmenuAnchor?.isConnected) {
    boardSubmenuAnchor.setAttribute('aria-expanded', 'false');
    delete boardSubmenuAnchor.dataset.submenuSide;
    if (restoreFocus) boardSubmenuAnchor.focus({preventScroll:true});
  }
  boardSubmenuAnchor = undefined;
}

function closeBoardMenu(restoreFocus = false) {
  const menu = el('task-board-menu');
  if (menu.hidden) return;
  closeBoardSubmenu();
  menu.hidden = true;
  if (boardMenuAnchor?.isConnected) {
    boardMenuAnchor.setAttribute('aria-expanded', 'false');
    if (restoreFocus) boardMenuAnchor.focus({preventScroll:true});
  }
  boardMenuAnchor = undefined;
}

function showBoardMenu(html, anchor, point) {
  const toggling = boardMenuAnchor === anchor && !point;
  const focusFirst = !point && anchor.matches(':focus-visible');
  closeBoardMenu();
  if (toggling) return;
  const menu = el('task-board-menu');
  menu.innerHTML = html;
  restrictMemberControls(menu);
  menu.hidden = false;
  boardMenuAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  const rect = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(point?.clientX ?? rect.right - menu.offsetWidth,
    window.innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(point?.clientY ?? rect.bottom + 5,
    window.innerHeight - menu.offsetHeight - 8)) + 'px';
  if (focusFirst) menu.querySelector('button:not(.account-restricted), a')?.focus({preventScroll:true});
}

function boardSubmenuButton(kind, id, label, icon) {
  return `<button type="button" class="chevron-trigger chevron-next" data-board-submenu="${kind}" data-id="${escape(id)}" aria-expanded="false"
    aria-controls="task-board-submenu">${icon}${label}</button>`;
}

function boardOption(action, id, label, icon, selected, unavailable = '') {
  return `<button type="button" data-action="${action}" data-id="${escape(id)}" aria-pressed="${selected}"
    ${unavailable ? `disabled title="${escape(unavailable)}"` : ''}>${icon}<span>${escape(label)}</span>
    ${selected ? '<span class="task-board-option-check" aria-hidden="true">✓</span>' : ''}</button>`;
}

function statusOptions(task, locked) {
  const humanCanAdvance = task.humanId && !task.assigneeId && !['done', 'backlog', 'cancelled'].includes(task.status);
  return data.taskStates.map(status => {
    const selected = status === task.status;
    const canRun = status === 'in_progress' && task.assigneeId && ['todo', 'blocked'].includes(task.status) && !awaitingSchedule(task);
    let unavailable = '';
    if (!selected) {
      if (locked) unavailable = '请先结束当前执行';
      else if (status === 'done' && task.status !== 'review') unavailable = '只有审核中的任务可以验收';
      else if (['done', 'cancelled'].includes(status) && unresolvedSubtasks(task.id)) unavailable = '请先验收或取消所有子任务';
      else if (['in_progress', 'review'].includes(status) && !humanCanAdvance && !canRun) {
        unavailable = '该状态由派单或提交审核进入';
      }
    }
    return boardOption(canRun ? 'task-run' : 'board-set-status', canRun ? task.id : task.id + ':' + status,
      workflowName(status), statusIcon(status), selected, unavailable);
  }).join('');
}

function openBoardSubmenu(anchor, focus = false) {
  const menu = el('task-board-submenu');
  if (boardSubmenuAnchor !== anchor) {
    const task = find('tasks', anchor.dataset.id);
    if (!task) return;
    const locked = active.includes(find('runs', task.lastRunId)?.status);
    closeBoardSubmenu();
    if (anchor.dataset.boardSubmenu === 'status') {
      menu.innerHTML = statusOptions(task, locked);
      menu.setAttribute('aria-label', '任务状态');
    } else {
      const current = task.priority ?? 'none';
      menu.innerHTML = ['none', 'urgent', 'high', 'medium', 'low'].map(priority =>
        boardOption('board-set-priority', task.id + ':' + priority,
          priority === 'none' ? '无优先级' : priorityLabels[priority], priorityIcon(priority), priority === current,
          locked && priority !== current ? '请先结束当前执行' : '')).join('');
      menu.setAttribute('aria-label', '任务优先级');
    }
    menu.hidden = false;
    boardSubmenuAnchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    const parentMenu = el('task-board-menu');
    const parent = parentMenu.getBoundingClientRect();
    const row = anchor.getBoundingClientRect();
    const width = menu.offsetWidth;
    const right = parent.right - 3;
    const left = parent.left - width + 3;
    let position = right + width + 8 <= innerWidth ? right : left;
    if (position < 8) {
      const parentLeft = Math.max(8, innerWidth - parent.width - width - 5);
      parentMenu.style.left = parentLeft + 'px';
      position = parentLeft + parent.width - 3;
    }
    anchor.dataset.submenuSide = position === left ? 'left' : 'right';
    menu.style.left = Math.max(8, Math.min(position, innerWidth - width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(row.top - 3, innerHeight - menu.offsetHeight - 8)) + 'px';
  }
  if (focus) {
    const item = menu.querySelector('[aria-pressed="true"]:not(:disabled)') ?? menu.querySelector('button:not(:disabled)');
    item?.focus({preventScroll:true});
  }
}

function showBoardTaskMenu(id, anchor, point) {
  const task = find('tasks', id);
  if (!task) return;
  const run = find('runs', task.lastRunId);
  const locked = run && active.includes(run.status);
  showBoardMenu(
    boardSubmenuButton('status', id, '状态', statusIcon(task.status)) +
    boardSubmenuButton('priority', id, '优先级', priorityIcon(task.priority)) +
    (!locked ? [
      boardButton('board-task-field', '负责人', id + ':owner', 'user'),
      boardButton('board-task-field', '截止日期', id + ':dueDate', 'clock'),
      boardButton('task-edit', '编辑任务', id, 'edit'),
      '<hr>',
    ].join('') : '') +
    (task.assigneeId && ['todo', 'blocked'].includes(task.status) && !awaitingSchedule(task)
      ? boardButton('task-run', task.status === 'blocked' ? '重试任务' : '启动执行', id, 'play') : '') +
    (task.status === 'review' ? boardButton('task-done', '验收任务', id, 'check') : '') +
    boardButton('task-view', '任务详情', id, 'list') +
    (run ? boardButton('run-view', '执行详情', run.id, 'clock') : '') +
    `<hr><a href="${escape(boardTaskLink(id))}" target="_blank" rel="noopener">${boardIcon('external')}在新标签页打开</a>` +
    boardButton('board-copy-link', '复制链接', id, 'link'), anchor, point);
}

function editBoardTaskField(key) {
  const [id, field] = key.split(':');
  const task = find('tasks', id);
  const fields = {
    owner: ['负责人', select('Agent 负责人', 'assigneeId', [['', '未分配'], ...assignableOptions()], task.assigneeId) +
      select('真人负责人或协作者', 'humanId', optional('humans'), task.humanId)],
    dueDate: ['截止日期', input('截止日期', 'dueDate', task.dueDate, {type:'date'})],
  };
  const [label, html] = fields[field];
  edit('更改' + label, html, form => {
    const {properties: _properties, ...current} = find('tasks', id);
    return api('tasks', {...current, ...Object.fromEntries(form)});
  });
}

function showLinkedTask() {
  const [, , id, commentId] = location.hash.slice(1).split('/');
  if (!fullTaskBoard || !/^[a-f0-9-]+$/.test(id ?? '')) return;
  if (id !== selectedTask) viewTask(id, commentId).catch(errorNotice);
  else if (commentId) {
    if (el('comment-' + commentId)) jumpToComment(commentId);
    else selectedComment = commentId;
  }
}

const taskScheduleLabel = task => (task.scheduleStartedAt ? '已定时派发 · ' : '定时 · ') + localDateTime(task.scheduledAt);
const awaitingSchedule = task => task.scheduledAt && !task.scheduleStartedAt && Date.parse(task.scheduledAt) > Date.now();
let selectedTask, selectedComment, replyToId, replyMentionKey, lastTaskDetailCursor;
const taskDetailMarkup = new Map();
let taskMentionTargets = [];
let taskComments = [];
const draftMentions = new Map();
const commentForm = el('task-comment');

function toggleMentionPicker(open, focus = false) {
  el('task-mention-picker').hidden = !open;
  el('task-mention-button').setAttribute('aria-expanded', String(open));
  if (open && focus) el('task-mention-select').focus();
}

function showDraftMentions() {
  const container = el('task-comment-mentions');
  container.hidden = !draftMentions.size;
  container.innerHTML = [...draftMentions].map(([key, person]) =>
    `<button type="button" class="task-mention" data-action="task-remove-mention" data-id="${escape(key)}"
      aria-label="移除 @${escape(person.name)}">@${escape(person.name)} ×</button>`).join('');
}

function setReplyTarget(comment) {
  if (replyMentionKey) draftMentions.delete(replyMentionKey);
  replyMentionKey = undefined;
  const recipient = taskMentionTargets.find(person => person.key === comment?.authorKey &&
    person.key !== 'user:' + signedInUser.id && person.key !== 'operator:local');
  if (recipient && !draftMentions.has(recipient.key)) {
    replyMentionKey = recipient.key;
    draftMentions.set(recipient.key, recipient);
  }
  showDraftMentions();
  replyToId = comment?.id;
  const target = el('task-reply-target');
  target.hidden = !replyToId;
  target.querySelector('span').textContent = comment ? '回复 ' + comment.author : '';
}

function clearTaskComposer() {
  commentForm.reset();
  commentForm.querySelector('.error').textContent = '';
  draftMentions.clear();
  setReplyTarget();
  toggleMentionPicker(false);
}

function discussionHtml(comments, runs) {
  if (!comments.length) return empty('还没有讨论。可以 @ 真人或 Agent 发起交流。');
  const byId = new Map(comments.map(comment => [comment.id, comment]));
  const replies = Map.groupBy(comments.filter(comment => comment.threadId), comment => comment.threadId);
  const byRun = new Map(runs.map(run => [run.id, run]));
  const renderComment = comment => {
    const parent = byId.get(comment.replyToId);
    const mentions = (comment.mentions ?? []).map(person =>
      `<span class="task-mention">@${escape(person.name)}</span>`).join('');
    const responses = (comment.responseRunIds ?? []).map(id => byRun.get(id)).filter(run => run && run.status !== 'completed');
    return `<article class="task-post" id="comment-${escape(comment.id)}" tabindex="-1">
      <div class="task-post-meta"><span class="task-post-avatar" data-kind="${comment.authorKind === 'agent' ? 'agent' : 'human'}"
        aria-hidden="true">${escape(Array.from(comment.author || '·')[0])}</span><strong>${escape(comment.author)}</strong>
        <span class="task-post-role">${comment.authorKind === 'agent' ? 'Agent' : '真人'}${comment.authorUsername ? ' · ' + escape(comment.authorUsername) : ''}</span>
        <time datetime="${escape(comment.createdAt)}">${escape(localDateTime(comment.createdAt))}</time></div>
      ${parent ? `<button type="button" class="task-post-reference" data-action="task-jump-comment" data-id="${escape(parent.id)}">↳ 回复 ${escape(parent.author)}</button>` : ''}
      <p>${escape(comment.text)}</p>
      ${mentions ? `<div class="task-comment-mentions">${mentions}</div>` : ''}
      <div class="task-post-actions">${btn('task-reply', '回复', comment.id)}
        ${responses.map(run => btn('task-run-view', name('agents', run.agentId) + ' · ' + (labels[run.status] ?? run.status), run.id)).join('')}</div>
    </article>`;
  };
  return `<div class="task-forum">${comments.filter(comment => !comment.threadId).map(comment => {
    const thread = replies.get(comment.id) ?? [];
    return `<div class="task-thread">${renderComment(comment)}
      ${thread.length ? `<div class="task-replies" aria-label="回复">${thread.map(renderComment).join('')}</div>` : ''}</div>`;
  }).join('')}</div>`;
}

function jumpToComment(id) {
  const post = el('comment-' + id);
  if (!post) return;
  setTaskProperties(false);
  post.focus({preventScroll:true});
  post.scrollIntoView({block:'nearest'});
}

function setTaskProperties(open) {
  el('task-inspection').classList.toggle('show-task-properties', open);
  const toggle = el('task-properties-toggle');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? '返回详情' : '属性与执行';
}

function renderTaskRegion(id, markup) {
  if (taskDetailMarkup.get(id) === markup) return;
  const region = el(id);
  const focused = region.contains(document.activeElement) ? document.activeElement : null;
  const postId = focused?.closest('.task-post')?.id;
  const foldKey = focused?.closest('details[data-task-fold]')?.dataset.taskFold;
  const openFolds = new Set([...region.querySelectorAll('details[open][data-task-fold]')].map(fold => fold.dataset.taskFold));
  region.innerHTML = markup;
  restrictMemberControls(region);
  taskDetailMarkup.set(id, markup);
  for (const fold of region.querySelectorAll('details[data-task-fold]')) {
    fold.open = openFolds.has(fold.dataset.taskFold);
  }
  if (focused?.dataset.action) {
    const replacement = [...region.querySelectorAll('[data-action]')].find(button =>
      button.dataset.action === focused.dataset.action && button.dataset.id === focused.dataset.id);
    if (replacement) {
      replacement.focus({preventScroll:true});
      return;
    }
  }
  if (postId) el(postId)?.focus({preventScroll:true});
  if (foldKey) region.querySelector(`[data-task-fold="${foldKey}"] > summary`)?.focus({preventScroll:true});
}

async function loadTaskDetail(id) {
  showTaskDetail(id, await api('tasks/' + id));
}

function taskDetailOverview(task, parent, subtasks, delivery) {
  const resolved = subtasks.filter(child => ['done', 'cancelled'].includes(child.status)).length;
  const description = escape(task.description);
  const longDescription = task.description?.length > 300 || task.description?.split('\n').length > 5;
  const deliveryLabel = delivery && (deliveryStates[delivery.status] ?? delivery.status);
  return `${parent ? `<div class="task-parent">${btn('task-view', '‹ ' + taskKey(parent) + ' · ' + parent.title, parent.id)}</div>` : ''}
    <header class="task-detail-heading">
      <div class="task-heading-meta"><span class="task-key">${escape(taskKey(task))}</span>
        <span class="task-detail-status" data-status="${escape(task.status)}">${statusIcon(task.status)}${escape(workflowName(task.status))}</span></div>
      <h3>${escape(task.title)}</h3>
      ${actions(
      ['backlog', 'cancelled'].includes(task.status) ? btn('task-reopen', '移至待办', task.id, true) : '',
      task.status === 'review' && resolved === subtasks.length ? btn('task-done', '验收任务', task.id, true) : '',
      task.assigneeId && ['todo','blocked'].includes(task.status) && !awaitingSchedule(task) ? btn('task-run', '启动执行', task.id, true) : '',
      !task.assigneeId && task.humanId && ['todo','blocked'].includes(task.status) ? btn('task-manual-start', '开始任务', task.id, true) : '',
      !task.assigneeId && task.humanId && task.status === 'in_progress' ? btn('task-manual-review', '提交验收', task.id, true) : '',
      task.status !== 'in_progress' ? btn('task-edit', '编辑任务', task.id) : '')}
    </header>
    ${delivery ? `<div class="task-delivery-row">
      <span class="task-delivery-icon">${boardIcon('list')}</span>
      <div><strong>项目交付</strong><span>${escape(deliveryLabel)} · ${number(delivery.count)} 个文件</span></div>
      ${btn('space-delivery', '查看交付', delivery.projectId + ':' + delivery.id)}</div>` : ''}
    <section class="task-detail-section" aria-labelledby="task-brief-title">
      <h4 id="task-brief-title">任务描述</h4>
      ${longDescription ? `<details class="task-brief-fold" data-task-fold="description">
        <summary aria-label="任务描述全文"><span class="task-brief-preview">${description}</span>
          <span class="task-fold-label chevron-trigger"><span>展开描述</span><span>收起描述</span></span></summary>
        <p class="task-detail-prose">${description}</p>
      </details>` : description ? `<p class="task-detail-prose">${description}</p>` : empty('暂无任务描述。')}
      ${task.acceptance ? `<div class="task-acceptance"><h4>验收标准</h4><p class="task-detail-prose">${escape(task.acceptance)}</p></div>` : ''}
    </section>
    <section class="task-detail-section" aria-labelledby="task-subtasks-title">
      <div class="card-head"><h4 id="task-subtasks-title">子任务 <span class="task-section-count">${resolved} / ${subtasks.length}</span></h4>
        ${!['done','cancelled'].includes(task.status) ? btn('task-child-add', '＋ 添加子任务', task.id) : ''}</div>
      ${task.status === 'review' && resolved < subtasks.length ? '<p class="description">子任务全部验收或取消后，才能验收当前任务。</p>' : ''}
      ${subtasks.length ? `<ul class="task-subtasks">${subtasks.map(child => {
        const run = find('runs', child.lastRunId);
        const info = [taskKey(child), assignedName(child), run && active.includes(run.status) ? run.activity : ''].filter(Boolean);
        return `<li>${statusIcon(child.status)}<div>${btn('task-view', child.title, child.id)}<small>${escape(info.join(' · '))}</small></div>
          ${badge(child.status, workflowName(child.status))}</li>`;
      }).join('')}</ul>` : empty('尚无子任务。')}
    </section>`;
}

function taskDetailRail(task, parent, runs) {
  const properties = [
    ['状态', `<span class="task-rail-value">${statusIcon(task.status)}${escape(workflowName(task.status))}</span>`],
    ['优先级', `<span class="task-rail-value">${priorityIcon(task.priority)}${escape(taskPriority(task) || '无优先级')}</span>`],
    ['负责人', escape(assignedName(task))],
    ['项目', escape(name('projects', task.projectId))],
    ['截止日期', escape(task.dueDate || '—')],
    ...(task.scheduledAt ? [['定时派发', escape(taskScheduleLabel(task))]] : []),
    ...taskFields(task).map(([label, value]) => [label, escape(value)]),
  ];
  const tags = labelBadges(task);
  if (tags) properties.push(['标签', `<div class="tags">${tags}</div>`]);
  const currentRuns = runs.filter(run => active.includes(run.status));
  const pastRuns = runs.filter(run => !active.includes(run.status));
  const visibleRuns = currentRuns.length ? currentRuns : pastRuns.slice(0, 1);
  const olderRuns = currentRuns.length ? pastRuns : pastRuns.slice(1);
  const runList = items => `<ul class="task-run-list">${items.map(run => {
    const agentName = name('agents', run.agentId);
    const activity = active.includes(run.status) && find('runs', run.id)?.activity;
    return `<li><button type="button" data-action="task-run-view" data-id="${escape(run.id)}">
      <span class="task-run-line"><strong>${escape(agentName)}</strong>${badge(run.status)}</span>
      <span class="task-run-line task-run-meta"><span>${run.kind === 'comment' ? '评论回复' : run.kind === 'conversation' ? '协作会话' : '任务执行'}</span>
      <time datetime="${escape(run.createdAt)}">${escape(localDateTime(run.createdAt))}</time></span>
      ${activity ? `<span class="task-run-meta task-run-activity">${escape(activity)}</span>` : ''}
    </button></li>`;
  }).join('')}</ul>`;
  const usage = runs.map(run => find('runs', run.id)?.usage?.totalTokens).filter(Number.isFinite);
  return `<section class="task-rail-section" aria-labelledby="task-properties-title">
      <h4 id="task-properties-title">属性</h4>
      <dl class="task-property-list">${properties.map(([label, value]) =>
        `<div><dt>${escape(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>
    </section>
    ${isMember() ? '' : `<section class="task-rail-section" aria-labelledby="task-runs-title">
      <h4 id="task-runs-title">执行记录 <span class="task-section-count">${runs.length}</span></h4>
      ${visibleRuns.length ? runList(visibleRuns) : empty('尚无执行。')}
      ${olderRuns.length ? `<details class="task-run-fold" data-task-fold="runs">
        <summary class="disclosure-chevron">更早的执行 <span class="task-section-count">${olderRuns.length}</span></summary>${runList(olderRuns)}</details>` : ''}
      ${usage.length ? `<p class="task-token-summary"><span>本任务 Token</span><strong>${number(usage.reduce((sum, value) => sum + value, 0))}</strong></p>` : ''}
    </section>`}
    <section class="task-rail-section" aria-labelledby="task-facts-title">
      <h4 id="task-facts-title">详情</h4>
      <dl class="task-property-list">
        <div><dt>来源</dt><dd>${parent ? '父任务拆分' : task.scheduledAt ? '定时任务' : '手动创建'}</dd></div>
        <div><dt>创建于</dt><dd>${escape(localDateTime(task.createdAt))}</dd></div>
        ${task.updatedAt ? `<div><dt>更新于</dt><dd>${escape(localDateTime(task.updatedAt))}</dd></div>` : ''}
      </dl>
    </section>`;
}

function showTaskDetail(id, {task, cursor, parent, subtasks, comments, runs, delivery, mentionTargets}) {
  if (id !== selectedTask || !el('task-inspection').open || cursor < lastTaskDetailCursor) return;
  lastTaskDetailCursor = cursor;
  taskComments = comments;
  taskMentionTargets = mentionTargets;
  const mentionSelect = el('task-mention-select');
  const mentionOptions = '<option value="">选择成员…</option>' + mentionTargets.map(person =>
    `<option value="${escape(person.key)}">${escape(person.name)} · ${person.kind === 'agent' ? 'Agent' : '真人'}</option>`).join('');
  if (mentionSelect.dataset.options !== mentionOptions) {
    mentionSelect.dataset.options = mentionOptions;
    mentionSelect.innerHTML = mentionOptions;
  }
  el('task-inspection-title').textContent = '任务详情 / ' + taskKey(task);
  renderTaskRegion('task-body', taskDetailOverview(task, parent, subtasks, delivery));
  renderTaskRegion('task-detail-rail', taskDetailRail(task, parent, runs));
  renderTaskRegion('task-discussion-feed', `<div class="task-discussion-heading card-head">
    <h4>动态 <span class="task-section-count">${comments.length} 条评论</span></h4>
    ${actions(comments.length ? btn('task-jump-comment', '最新动态', comments.at(-1).id) : '', btn('task-compose', '写评论'))}
    </div>${discussionHtml(comments, runs)}`);
  el('task-discussion').hidden = false;
  if (selectedComment) {
    jumpToComment(selectedComment);
    selectedComment = undefined;
  }
}

async function viewTask(id, commentId) {
  selectedTask = id;
  selectedComment = commentId;
  taskDetailMarkup.clear();
  lastTaskDetailCursor = 0;
  taskComments = [];
  taskMentionTargets = [];
  el('task-mention-select').dataset.options = '';
  el('task-mention-select').innerHTML = '';
  el('task-inspection-title').textContent = '任务详情';
  el('task-body').innerHTML = empty('正在加载任务…');
  el('task-detail-rail').replaceChildren();
  el('task-discussion-feed').replaceChildren();
  el('task-discussion').hidden = true;
  setTaskProperties(false);
  el('task-detail-content').scrollTop = 0;
  clearTaskComposer();
  openModal('task-inspection');
  el('task-inspection-title').focus({preventScroll:true});
  await loadTaskDetail(id);
}

function runTable(runs) {
  if (!runs.length) return empty('任务启动后，执行过程会显示在这里。');
  return `<div class="table"><table><thead><tr><th>任务</th><th>员工</th><th>状态</th><th>当前活动</th><th></th></tr></thead>
    <tbody>${runs.map(run => `<tr><td>${escape(find('tasks', run.taskId)?.title)}</td>
    <td>${escape(name('agents', run.agentId))}</td><td>${badge(run.status)}</td>
    <td>${escape(run.activity ?? '—')}</td><td>${btn('run-view', '查看', run.id)}</td></tr>`).join('')}</tbody></table></div>`;
}

function namedCard(kind, record) {
  return `<article class="card"><div class="card-head"><h3>${escape(record.name)}</h3>${btn(kind + '-edit', '编辑', record.id)}</div>
    ${record.description ? `<p>${escape(record.description)}</p>` : ''}</article>`;
}

function candidatePresence(candidate) {
  const machine = find('machines', candidate.machineId);
  if (machine?.status !== 'online') return badge('offline', '来源离线');
  if (candidate.kind === 'process' && machine.processScan !== 'ok') return badge('paused', '进程状态未知');
  if (!candidate.present) return badge('offline', candidate.kind === 'process' ? '进程已退出' : '未检测到安装');
  return candidate.kind === 'process' ? badge('running', '检测到进程') : badge('idle', '已安装');
}

function discovery() {
  const machines = data.machines ?? [];
  const candidates = (data.candidates ?? []).filter(item => item.status === 'review' ||
    (item.status === 'discovered' && item.present && find('machines', item.machineId)?.status !== 'revoked'));
  const collector = data.collector;
  const endpoint = collector?.listening
    ? `采集端口 ${collector.port}（${collector.protocol.toUpperCase()}）${collector.loopback ? ' · 仅回环' : ''}`
    : '远程接收端未启动';
  const hasHr = data.agents.some(agent => agent.role === 'hr' && agent.runtime === 'codex');
  return section('发现与入职', '本机与已配对机器持续扫描。候选通过入职确认后才会进入员工名单。',
    actions(btn('scan-local', '立即扫描本机'), collector?.listening ? btn('machine-pair', '配对新机器', '', true) : '')) +
    `<section class="panel"><div class="card-head"><h2>待处理候选</h2><span class="badge">${candidates.length}</span></div>
    ${candidates.length ? `<div class="table"><table>
      <thead><tr><th>Agent</th><th>来源</th><th>发现状态</th><th>人事状态</th><th>操作</th></tr></thead>
      <tbody>${candidates.map(item => `<tr><td>${escape(providerLabels[item.provider])}
        ${item.kind === 'process' ? `<span class="badge">PID ${item.pid}</span>` : ''}</td>
      <td>${escape(name('machines', item.machineId))}</td><td>${candidatePresence(item)}</td>
      <td>${item.status === 'review' ? badge('review', '待确认') : badge('todo', '待建档')}</td>
      <td>${actions(btn('candidate-review', item.draft ? '编辑档案' : '填写档案', item.id),
        item.status === 'review' ? btn('candidate-approve', '确认入职', item.id, true) : '',
        item.status === 'discovered' && hasHr ? btn('candidate-assign', '交给人事', item.id) : '',
        btn('candidate-dismiss', '忽略', item.id))}</td></tr>`).join('')}</tbody></table></div>` : empty('暂无待处理候选。')}
    </section>
    <section class="panel"><div class="card-head"><h2>采集机器</h2>
      <a href="/downloads/office-collector.mjs" download>下载采集客户端</a></div>
    <p class="description">${escape(endpoint)}</p>
    ${machines.length ? `<div class="table"><table>
      <thead><tr><th>机器</th><th>系统</th><th>状态</th><th>最近上报</th><th></th></tr></thead>
      <tbody>${machines.map(machine => `<tr><td>${escape(machine.name)}${machine.hostname ? ' · ' + escape(machine.hostname) : ''}</td>
        <td>${escape(machine.platform ?? '—')}</td>
        <td>${badge(machine.status, machineLabels[machine.status])} ${machine.processScan === 'unavailable' && machine.status === 'online'
          ? badge('paused', '进程扫描不可用') : ''}</td>
        <td>${machine.seenAt ? escape(localDateTime(machine.seenAt)) : '—'}</td>
        <td>${!machine.local && machine.status !== 'revoked' ? btn('machine-revoke', '撤销配对', machine.id) : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('正在等待本机首次扫描。')}
    </section>`;
}

function finance() {
  return section('财务账本', '本机 Codex 和 Pi 的累计 Token 用量与内部额度。', btn('budget-edit', '设置预算', '', true)) +
    `<section class="panel table"><table><thead><tr><th>范围</th><th>对象</th><th>预算</th><th>已上报</th><th>仍预留</th><th>可分配</th><th>用量未上报</th></tr></thead>
    <tbody>${data.ledger.map(row => `<tr><td>${{company: '公司', team: '小组', agent: '员工'}[row.scope]}</td>
      <td>${escape(row.scope === 'company' ? '本机公司' : name(row.scope + 's', row.id))}</td>
      ${[row.limit, row.spent, row.reserved, row.available, row.unknown].map(value =>
        `<td class="number${value < 0 ? ' error' : ''}">${number(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>
    <section class="panel"><h2>用量明细</h2>${data.runs.some(run => run.usage) ? `<div class="table"><table>
    <thead><tr><th>员工</th><th>输入</th><th>缓存输入</th><th>输出</th><th>总 Token</th><th></th></tr></thead>
    <tbody>${data.runs.filter(run => run.usage).slice(0, 40).map(run => `<tr>
      <td>${escape(name('agents', run.agentId))}</td>${['inputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens'].map(key =>
        `<td class="number">${number(run.usage[key])}</td>`).join('')}<td>${btn('run-view', '查看', run.id)}</td>
    </tr>`).join('')}</tbody></table></div>` : empty('运行器上报 Token 后会显示记录。') }</section>`;
}

function conversations() {
  return section('协作会话', '双人交流与多人会议按轮次安排真实发言。', btn('conversation-new', '发起讨论', '', true)) +
    (data.conversations.length ? `<div class="stack">${[...data.conversations].reverse().map(conversation => {
      const run = find('runs', conversation.currentRunId);
      return `<article class="card">
        <div class="card-head"><h3>${escape(conversation.topic)}</h3>
          <div>${badge(conversation.mode, conversation.mode === 'face_to_face' ? '双人交流' : '会议室')} ${badge(conversation.status)}</div></div>
        <p>${escape(conversation.participantIds.map(id => name('agents', id)).join('、'))} · ${conversation.rounds} 轮</p>
        ${conversation.taskId ? `<p>关联任务 ${escape(find('tasks', conversation.taskId)?.title)}</p>` : ''}
        ${run ? `<p>${escape(name('agents', run.agentId))} · ${labels[run.status]} · ${escape(run.activity)}</p>` : ''}
        ${conversation.error ? `<p class="error">${escape(conversation.error)}</p>` : ''}
        <div class="messages">${conversation.messages.map(message => `<div class="message">
          <h3>${escape(name('agents', message.agentId))} ${badge(message.status)}</h3>
          <p>${escape(message.text)}</p>
        </div>`).join('')}</div>
        ${actions(
          run ? btn('run-view', '当前发言', run.id) : '',
          ['active', 'paused'].includes(conversation.status) ? btn('conversation-add', '加入员工', conversation.id) : '',
          conversation.status === 'paused' ? btn('conversation-resume', '继续讨论', conversation.id, true) : '',
          ['active', 'paused'].includes(conversation.status) ? btn('conversation-close', '结束讨论', conversation.id) : '',
          btn('conversation-task', '创建后续任务', conversation.id),
        )}
      </article>`;
    }).join('')}</div>` : empty('发起讨论并选中至少两名员工。'));
}

const rows = pairs => `<dl class="setting-rows">${pairs.map(([label, value]) =>
  `<div><dt>${escape(label)}</dt><dd>${escape(value || '—')}</dd></div>`).join('')}</dl>`;
const settingsPanel = (title, body, controls = '') =>
  `<section class="panel"><div class="card-head"><h2>${escape(title)}</h2>${controls}</div>${body}</section>`;
const editSetting = id => btn('setting-edit', '编辑', id, true);

function cataloguePanel(kind) {
  const isLabel = kind === 'label';
  const items = data.settings[isLabel ? 'labels' : 'properties'];
  const title = isLabel ? '任务标签' : '自定义字段';
  const content = items.length ? `<div class="table"><table>
    <thead><tr><th>名称</th><th>${isLabel ? '颜色' : '字段类型'}</th><th>说明</th><th>状态</th><th></th></tr></thead>
    <tbody>${items.map(item => `<tr><td>${escape(item.name)}</td><td>${isLabel
      ? badge('label-' + item.color, '标签') : escape(propertyLabels[item.type])}</td>
      <td>${escape(item.description || '—')}</td><td>${item.archived ? '已归档' : '使用中'}</td>
      <td>${actions(btn(kind + '-edit', '编辑', item.id),
        btn(kind + '-archive', item.archived ? '恢复' : '归档', item.id))}</td></tr>`).join('')}</tbody></table></div>`
    : empty(isLabel ? '创建标签后，可在任务上选择并按标签筛选。' : '创建文本、数字或单选字段，让任务记录你关心的信息。');
  return settingsPanel(title, content, btn(kind + '-edit', isLabel ? '新建标签' : '新建字段', '', true));
}

function settingsBody() {
  const {workspace, workflow, runtime, notifications, runtimeConcurrencyLocked} = data.settings;
  switch (settingsPage) {
    case 'account':
      return settingsPanel('我的账户', rows([
        ['显示名称', signedInUser.name], ['用户名', signedInUser.username],
        ['邮箱', signedInUser.email || '—'],
        ['@ 邮件通知', signedInUser.mentionEmail ? '已开启' : '已关闭'],
        ['角色', accountRoles[signedInUser.role]], ['注册时间', localDateTime(signedInUser.createdAt)],
      ]), actions(btn('account-mention-email', signedInUser.mentionEmail ? '关闭 @ 邮件通知' : '开启 @ 邮件通知'),
        btn('account-password', '修改密码'), btn('account-logout', '退出登录')));
    case 'users': return userManagement();
    case 'workspace':
      return settingsPanel('工作区资料', rows([
        ['名称', workspace.name], ['简介', workspace.description], ['本机操作者', workspace.operator],
        ['任务编号示例', workspace.taskPrefix + '-1'], ['提供给 Agent 的工作区上下文', workspace.context],
      ]), editSetting('workspace'));
    case 'preferences':
      return settingsPanel('此浏览器的偏好', rows([
        ['外观', {system: '跟随系统', light: '浅色', dark: '深色'}[preferences.theme]],
        ['任务默认视图', {board: '看板', list: '列表'}[preferences.taskView]],
        ['显示时区', preferences.timeZone === 'local' ? '跟随浏览器' : preferences.timeZone],
      ]), editSetting('preferences'));
    case 'notifications':
      return settingsPanel('收件箱通知', rows(Object.entries(notificationLabels)
        .map(([key, label]) => [label, notifications[key] ? '开启' : '关闭'])),
      actions(btn('goto-inbox', '打开收件箱'), editSetting('notifications')));
    case 'workflow':
      return settingsPanel('任务流程', rows([
        ...data.taskStates.map(status => [labels[status], workflow.names[status]]),
        ['新任务默认优先级', priorityLabels[workflow.defaultPriority]],
      ]), editSetting('workflow'));
    case 'labels': return cataloguePanel('label');
    case 'properties': return cataloguePanel('property');
    case 'runtime': {
      const online = (data.machines ?? []).filter(machine => machine.status === 'online').length;
      return settingsPanel('运行策略', rows([
        ['并发上限', runtime.concurrency + ' 项' + (runtimeConcurrencyLocked ? '（环境变量覆盖）' : '')],
        ['执行时限', runtime.timeoutMinutes + ' 分钟'],
        ['任务默认预留', number(runtime.reserve) + ' Token'],
        ['会议发言默认预留', number(runtime.meetingReserve) + ' Token'],
        ['本机自动发现', runtime.autoScan ? '每 ' + runtime.scanSeconds + ' 秒扫描' : '仅手动扫描'],
      ]), editSetting('runtime')) + settingsPanel('采集连接', rows([
        ['在线机器', String(online)],
        ['远程采集接收端', data.collector?.listening ? data.collector.protocol.toUpperCase() + ' · 端口 ' + data.collector.port : '未启用'],
      ]), actions(btn('goto-discovery', '查看采集机器'), btn('scan-local', '立即扫描')));
    }
    case 'organization': {
      const budget = data.ledger.find(item => item.scope === 'company');
      return settingsPanel('组织与权限', rows([
        ['员工', data.agents.length + ' 名'], ['小组', data.teams.length + ' 个'], ['技能', data.skills.length + ' 项'],
      ]), actions(btn('goto-people', '管理员工'), btn('team-edit', '创建小组'), btn('skill-edit', '创建技能'))) +
        settingsPanel('团队', data.teams.length ? `<div class="grid">${data.teams.map(team => namedCard('team', team)).join('')}</div>` : empty('暂无团队。')) +
        settingsPanel('技能', data.skills.length ? `<div class="grid">${data.skills.map(skill => namedCard('skill', skill)).join('')}</div>` : empty('暂无技能。')) +
        settingsPanel('Token 预算', rows([
          ['公司总额度', budget?.limit == null ? '未设置' : number(budget.limit)],
          ['可分配额度', number(budget?.available)],
        ]), actions(btn('budget-edit', '设置预算'), btn('goto-finance', '查看账本')));
    }
    case 'audit':
      return settingsPanel('最近 100 条管理变更', auditData?.length ? `<div class="table"><table>
        <thead><tr><th>时间</th><th>操作</th><th>对象</th></tr></thead>
        <tbody>${auditData.map(event => `<tr><td>${escape(localDateTime(event.time))}</td>
          <td>${escape(managementEventName(event))}</td><td>${escape(event.payload.name ||
            settingsTitles[event.payload.section] || name('machines', event.payload.machineId || event.payload.target))}</td></tr>`).join('')}</tbody></table></div>`
        : empty(auditData ? '暂无变更记录。' : '正在加载变更记录…'));
  }
}

function userManagement() {
  if (!usersData) return settingsPanel('用户管理', empty('正在加载账户…'));
  const ordered = [...usersData].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));
  const pending = ordered.filter(user => user.status === 'pending').length;
  return settingsPanel('用户管理', `<p class="description">${ordered.length} 个账户，${pending} 个等待审批。</p>
    <div class="table"><table><thead><tr><th>账户</th><th>邮箱</th><th>角色</th><th>状态</th><th>注册时间</th><th>操作</th></tr></thead>
    <tbody>${ordered.map(user => `<tr><td><strong>${escape(user.name)}</strong><small class="account-username">${escape(user.username)}</small></td>
      <td>${escape(user.email || '—')}</td><td>${accountRoles[user.role]}</td><td>${badge({pending:'review',active:'completed',disabled:'blocked'}[user.status], accountStates[user.status])}</td>
      <td>${escape(localDateTime(user.createdAt))}</td>
      <td>${user.id === signedInUser.id ? '当前账户' : btn('account-edit', user.status === 'pending' ? '审批' : '管理', user.id)}</td></tr>`).join('')}
    </tbody></table></div>`);
}

function editAccount(id) {
  const user = usersData?.find(item => item.id === id);
  if (!user) return;
  const pending = user.status === 'pending';
  edit(pending ? '审批账户' : '管理账户',
    `<p class="description">${escape(user.name)} · ${escape(user.username)}</p>` +
    select('角色', 'role', Object.entries(accountRoles), user.role) +
    select('状态', 'status', Object.entries(accountStates), pending ? 'active' : user.status),
    form => api('users/' + id, {role:form.get('role'), status:form.get('status'), version:user.version}));
}

function editAccountPassword() {
  edit('修改密码',
    '<label>当前密码<input name="currentPassword" type="password" maxlength="128" autocomplete="current-password" required></label>' +
    '<label>新密码<input name="newPassword" type="password" minlength="15" maxlength="128" autocomplete="new-password" required></label>' +
    '<label>确认新密码<input name="confirmPassword" type="password" minlength="15" maxlength="128" autocomplete="new-password" required></label>',
    async form => {
      if (form.get('newPassword') !== form.get('confirmPassword')) throw new Error('两次输入的新密码不一致');
      await api('auth/password', {currentPassword:form.get('currentPassword'), newPassword:form.get('newPassword')});
      el('editor').reset();
      connect();
    });
}

function managementEventName(event) {
  return ({
    'settings.updated': '保存设置', 'catalogue.saved': '保存分类配置',
    'catalogue.archived': event.payload.archived ? '归档分类配置' : '恢复分类配置',
    'agent.saved': '保存员工', 'team.saved': '保存小组', 'skill.saved': '保存技能',
    'machine.paired': '创建机器配对', 'machine.revoked': '撤销机器配对',
    'candidate.reviewed': '提交入职档案', 'candidate.approved': '确认入职',
    'candidate.dismissed': '忽略候选', 'budget.updated': '更新预算',
    'human.saved': '保存真人员工', 'schedule.saved': '保存日程', 'agent.dispatch': '更新 Agent 派发',
    'layout.saved': '保存布局草稿', 'layout.published': '发布办公室布局',
    'account.registered': '注册账户', 'account.updated': '更新账户权限', 'account.email-bound': '绑定账户邮箱',
  })[event.type] ?? event.type;
}

function settingsScreen() {
  if (!data.settings) return empty('请重启工作台服务以加载设置。');
  const groups = isMember() ? {'个人':{account:settingsTitles.account, preferences:settingsTitles.preferences}} : settingsGroups;
  return section('设置', isMember() ? '管理个人账户和浏览器偏好。' : '管理个人账户、工作区权限和 Agent 运行。') +
    `<div class="settings-layout">
      <nav class="settings-nav" aria-label="设置导航">${Object.entries(groups).map(([group, sections]) =>
        `<p>${escape(group)}</p>${Object.entries(sections).map(([key, label]) =>
          `<button data-action="settings-section" data-id="${key}"${settingsPage === key ? ' aria-current="true"' : ''}>${escape(label)}</button>`).join('')}`).join('')}
      </nav>
      <div class="settings-content">${settingsBody()}</div>
    </div>`;
}

function inboxScreen() {
  const events = inboxData?.events ?? [];
  return section('收件箱', `${data.unread ?? 0} 条未读通知`, actions(
    btn('goto-notifications', '通知设置'),
    data.unread > 0 && events.length ? btn('inbox-read', '标记全部已读', '', true) : '',
  )) + (events.length ? `<div class="stack">${events.map(event => {
    const task = find('tasks', event.task_id);
    const run = find('runs', event.run_id);
    const candidate = find('candidates', event.payload.candidateId);
    const titles = {'task.status': '任务待验收', 'run.failed': '执行失败', 'run.interrupted': '执行中断',
      'task.mention': '评论中的 @ 提及', 'task.schedule_failed': '定时派发失败',
      'candidate.reviewed': '入职档案待确认', 'machine.status': '采集机器离线'};
    const target = task?.title ?? (candidate ? providerLabels[candidate.provider]
      : run ? name('agents', run.agentId) : name('machines', event.payload.machineId));
    const details = event.type === 'task.mention' ? btn('task-discussion-view', '查看评论', event.task_id + ':' + event.payload.id)
      : run ? btn('run-view', '查看执行', run.id)
      : task ? btn('task-view', '查看任务', task.id)
      : candidate?.status === 'review' ? btn('candidate-approve', '查看档案', candidate.id)
      : event.type === 'machine.status' ? btn('goto-discovery', '查看机器') : '';
    return `<article class="card inbox-entry${event.seq > inboxData.seenThrough ? ' unread' : ''}">
      <div><h3>${escape(titles[event.type])} · ${escape(target)}</h3>
      <time>${escape(localDateTime(event.time))}</time>
      ${event.payload.error ? `<p>${escape(event.payload.error)}</p>` : ''}
      ${event.type === 'task.mention' ? `<p>${escape(event.payload.author)} 提及了 ${escape(event.payload.recipients.join('、'))}</p>` : ''}</div>${details}</article>`;
  }).join('')}</div>` : empty(inboxData ? '暂无通知。' : '正在加载通知…'));
}

const workspaceView = createWorkspaceView({data: () => data, escape, btn, input: (...args) => input(...args),
  select, empty, number, localTime, localDateTime, edit, api, render, navigate, find, name, editTask,
  editNamed, taskKey, workflowName, timeZone: () => timeOptions().timeZone, showPanel, openModal, action, runTable,
  selectedOfficeActor:() => selectedActor});
const renderers = {overview: overviewScreen, tasks: () => fullTaskBoard ? tasks() : workspaceView.workbench(),
  people: workspaceView.people, agents: workspaceView.agentPage, layout: workspaceView.layoutEditor, help: workspaceView.help,
  discovery, finance, conversations, settings: settingsScreen, inbox: inboxScreen};

function route() {
  if (!signedInUser) return;
  const [requested, child] = location.hash.slice(1).split('/');
  page = isMember() && !memberPages.has(requested) ? 'tasks' : Object.hasOwn(renderers, requested) ? requested : 'overview';
  fullTaskBoard = page === 'tasks' && child === 'all';
  closeBoardMenu();
  workspaceView.closeMobile();
  if (page !== 'overview' && fullscreenMode) endOverviewFullscreen();
  if (page === 'settings') settingsPage = isMember() ? (memberSettings.has(child) ? child : 'account')
    : Object.hasOwn(settingsTitles, child) ? child : 'workspace';
  if (page === 'layout') workspaceView.selectLayoutTab(child);
  render();
  if (data) {
    showLinkedTask();
    scheduleRefresh();
  }
}

function navigate(page, child) {
  const hash = '#' + page + (child ? '/' + child : '');
  if (location.hash === hash) route();
  else location.hash = hash;
}
function render() {
  if (!data) return;
  document.body.classList.toggle('office-overview-active', page === 'overview');
  el('main').classList.toggle('office-overview-main', page === 'overview');
  el('main').classList.toggle('task-board-page', fullTaskBoard);
  el('main').classList.toggle('workspace-designed', ['people','agents','layout','help'].includes(page) ||
    (page === 'tasks' && !fullTaskBoard));
  const workspaceName = data.settings?.workspace.name || 'Agent 公司';
  el('workspace-name').textContent = workspaceName;
  document.title = workspaceName + ' · 本机工作台';
  const unread = el('inbox-count');
  unread.hidden = !(data.unread > 0);
  unread.textContent = data.unread > 99 ? '99+' : (data.unread ?? '');
  workspaceView.renderShell(page, data);
  if (page === 'layout' && workspaceView.dragging()) return;
  const focus = document.activeElement;
  const key = el('main').contains(focus) ? focus.dataset : {};
  const filterFocus = focus?.form?.id === 'task-filters' ? focus.name : '';
  const selection = focus?.type === 'search' ? [focus.selectionStart, focus.selectionEnd] : null;
  const boardLeft = el('main').querySelector('.board')?.scrollLeft;
  const boardAnchor = boardMenuAnchor?.dataset;
  const menuOpen = el('main').querySelector('.office-menu')?.open;
  const officeRoster = el('main').querySelector('.office-live-roster')?.scrollLeft;
  const workstationScroll = el('main').querySelector('.symbio-workstation-roster')?.scrollTop;
  el('main').innerHTML = renderers[page]();
  renderOfficeScene();
  if (workstationScroll && el('main').querySelector('.symbio-workstation-roster')) {
    el('main').querySelector('.symbio-workstation-roster').scrollTop = workstationScroll;
  }
  if (officeRoster && el('main').querySelector('.office-live-roster')) {
    el('main').querySelector('.office-live-roster').scrollLeft = officeRoster;
  }
  restrictMemberControls(el('office-shell'));
  workspaceView.hydrate();
  if (page === 'overview' && menuOpen) el('main').querySelector('.office-menu').open = true;
  if (boardAnchor) {
    boardMenuAnchor = [...el('main').querySelectorAll('[aria-controls="task-board-menu"]')].find(button =>
      button.dataset.action === boardAnchor.action && button.dataset.id === boardAnchor.id);
    if (boardMenuAnchor) boardMenuAnchor.setAttribute('aria-expanded', 'true');
    else closeBoardMenu();
  }
  if (boardLeft) {
    const board = el('main').querySelector('.board');
    if (board) board.scrollLeft = boardLeft;
  }
  if (filterFocus) {
    const filter = el('task-filters')?.elements[filterFocus];
    filter?.focus({preventScroll: true});
    if (selection) filter?.setSelectionRange(...selection);
  } else if (key.action) {
    const next = [...el('main').querySelectorAll('[data-action]')].find(button =>
      button.dataset.action === key.action && button.dataset.id === key.id);
    next?.focus({preventScroll: true});
  }
}

function duration(start, end) {
  const ms = Math.max(0, (end == null ? Date.now() : Date.parse(end)) - Date.parse(start));
  if (ms < 1000) return ms + ' 毫秒';
  if (ms < 60_000) return (ms / 1000).toFixed(2) + ' 秒';
  return Math.floor(ms / 60_000) + ' 分 ' + Math.floor(ms / 1000 % 60) + ' 秒';
}

function elapsed(start, end, ticking = false) {
  if (!start || (!end && !ticking)) return '—';
  return `<span class="run-duration"${ticking && !end ? ' data-elapsed-from="' + escape(start) + '"' : ''}>${duration(start, end)}</span>`;
}

function runTiming(run, {stages, prompt}) {
  const running = active.includes(run.status);
  return `<section class="card run-timing">
    <div class="card-head"><h3>阶段耗时</h3><strong>总耗时 ${elapsed(run.createdAt, run.endedAt, running)}</strong></div>
    <dl class="run-stages">${stages.map(stage => `<div>
      <dt>${escape(stage.label)}${!stage.end && running ? ' <small>进行中</small>' : ''}</dt>
      <dd>${elapsed(stage.start, stage.end, running)}</dd>
    </div>`).join('')}</dl>
    ${prompt.submittedAt ? `<p>任务输入提交于 ${localTime(prompt.submittedAt)}</p>` : ''}
  </section>`;
}

function runPanel({run, trace}) {
  const output = escape(run.output);
  return `<div class="card-head"><div><h3>${escape(run.agent.name)} · ${escape(find('tasks', run.taskId)?.title ?? '会话发言')}</h3>
    <p class="description">${runtimeLabels[run.agent.runtime]} · 配置版本 ${run.agent.version}${run.usage ? ' · ' + number(run.usage.totalTokens) + ' Token' : ''}</p></div>
    ${actions(badge(run.status), active.includes(run.status) && run.status !== 'stopping' ? btn('run-stop', '停止', run.id) : '')}</div>
    ${run.activity ? `<p>${escape(run.activity)}</p>` : ''}
    ${run.error ? `<p class="error">${escape(run.error)}</p>` : ''}
    ${trace ? runTiming(run, trace) : ''}
    ${run.plan.length ? `<div class="card"><h3>计划</h3>${run.plan.map(step =>
      `<p>${escape({pending: '○', inProgress: '◐', completed: '✓'}[step.status] || '·')} ${escape(step.step)}</p>`).join('')}</div>` : ''}
    <h3>运行输出</h3>${output ? `<pre>${output}</pre>` : empty('等待输出')}`;
}

function runPromptPanel({run, trace}) {
  if (!trace) return '';
  const {instructions, input, reconstructed} = trace.prompt;
  return `<details class="card run-prompt">
    <summary class="disclosure-chevron">提示词与任务输入</summary>
    <p class="description">${reconstructed ? '历史指令按入队时的员工配置还原。' : '内容取自本次执行入队时的快照。'}
    ${run.agent.runtime === 'demo' ? '演示运行器使用任务输入。' : '范围为工作台注入的指令与提交给运行器的输入。'}</p>
    ${instructions ? `<h4>工作台指令</h4><pre>${escape(instructions)}</pre>` : ''}
    <h4>任务或会话输入</h4><pre>${escape(input)}</pre>
  </details>`;
}

function runEventsPanel({run, events, trace}) {
  const artifacts = run.artifacts ?? [];
  const workspace = run.workspace ?? events.find(event => event.type === 'run.workspace')?.payload.cwd;
  const toolStatus = {running: '进行中', completed: '已完成', failed: '失败', unreported: '结束时间未记录'};
  return `${trace?.tools.length ? `<section class="card run-tools">
    <h3>工具调用</h3>
    ${trace.toolsTruncated ? '<p class="description">显示最近 300 条工具事件。</p>' : ''}
    <ul>${trace.tools.map(tool => `<li>
      <div><strong>${escape(tool.label)}</strong> <small>${toolStatus[tool.status]}${tool.exitCode == null ? '' : ' · 退出码 ' + escape(tool.exitCode)}</small>
        ${tool.summary ? `<p>${escape(tool.summary)}</p>` : ''}</div>
      ${elapsed(tool.start, tool.end, tool.status === 'running')}
    </li>`).join('')}</ul>
  </section>` : ''}
    ${workspace ? `<div class="card"><h3>执行目录与产出</h3><pre>${escape(workspace)}</pre>
      ${artifacts.map(path => `<p>${escape(path)}</p>`).join('')}</div>` : ''}
    <h3>实时事件</h3><div class="events">${[...events].reverse().filter(event => event.type !== 'message.delta').slice(0, 100).map(event => {
      const p = event.payload;
      return `<div class="event"><time datetime="${escape(event.time)}">${localTime(event.time)}</time><strong>${escape(eventLabels[event.type] ?? event.type)}</strong>
        <span>${escape(p.summary || p.label || p.error || p.path || (p.totalTokens != null ? number(p.totalTokens) + ' Token' : ''))}</span></div>`;
    }).join('')}</div>`;
}

function showRunDetail(detail) {
  if (selectedRun !== detail.run.id || !el('inspection').open) return;
  const body = el('run-body');
  if (!body.firstElementChild?.matches('.run-live')) {
    body.innerHTML = `<div class="run-stack run-live"></div>${runPromptPanel(detail)}<div class="run-stack run-events"></div>`;
  }
  body.firstElementChild.innerHTML = runPanel(detail);
  body.lastElementChild.innerHTML = runEventsPanel(detail);
}

async function refresh() {
  if (refreshPending) {
    refreshAgain = true;
    return refreshPending;
  }
  const runId = selectedRun;
  const taskId = selectedTask;
  refreshPending = (async () => {
    const auxiliary = page === 'overview' ? 'overview' : page === 'inbox' ? 'inbox'
      : page === 'settings' && settingsPage === 'users' ? 'users'
      : page === 'settings' && settingsPage === 'audit' ? 'settings/audit' : '';
    const [snapshot, detail, extra, task] = await Promise.all([
      api('state'), runId ? api('runs/' + runId) : null, auxiliary ? api(auxiliary) : null,
      taskId ? api('tasks/' + taskId) : null,
    ]);
    data = snapshot;
    signedInUser = snapshot.user;
    if (auxiliary === 'overview') overviewData = extra;
    if (auxiliary === 'inbox') inboxData = extra;
    if (auxiliary === 'settings/audit') auditData = extra;
    if (auxiliary === 'users') usersData = extra;
    render();
    if (!officeScene && !isMember()) {
      const actors = officePresence(snapshot,officeOverview(snapshot,null,timeOptions()));
      const idle = new Set(actors.filter(actor => actor.state === 'idle' && Number.isInteger(actor.seatIndex)).map(actor => actor.key));
      officeStrolls(idle,performance.now());
    }
    if (overviewDetails && el('overview-dialog').open) showOverviewDetails(overviewDetails);
    if (task) showTaskDetail(taskId, task);
    if (detail) showRunDetail(detail);
  })();
  try {
    await refreshPending;
  } finally {
    refreshPending = null;
    if (refreshAgain) {
      refreshAgain = false;
      scheduleRefresh();
    }
  }
}

function scheduleRefresh() {
  if (!refreshTimer) refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refresh().catch(errorNotice);
  }, 120);
}

function connect() {
  feed?.close();
  feed = new EventSource('/api/events?after=' + data.cursor);
  feed.onopen = () => {
    el('connection').className = 'connection online';
    el('connection').innerHTML = '<i></i> 系统连接正常';
    if (page === 'overview') render();
    scheduleRefresh();
  };
  feed.onmessage = scheduleRefresh;
  feed.onerror = () => {
    el('connection').className = 'connection';
    el('connection').innerHTML = '<i></i> 正在重连';
    if (page === 'overview') render();
    api('auth/session').then(({user}) => { if (!user) reloadAccount(); }).catch(() => {});
  };
}

const input = (label, key, value = '', {required = false, type = 'text', min, max, step} = {}) =>
  `<label>${escape(label)}<input name="${escape(key)}" type="${type}" value="${escape(value)}"${required ? ' required' : ''}${min == null ? '' : ` min="${min}"`}${max == null ? '' : ` max="${max}"`}${step ? ` step="${step}"` : ''}></label>`;
const area = (label, key, value = '', required = false) =>
  `<label>${label}<textarea name="${key}" maxlength="8000"${required ? ' required' : ''}>${escape(value)}</textarea></label>`;
function select(label, key, options, value, {multiple = false, required = false} = {}) {
  const selected = multiple ? value ?? [] : [value];
  const field = `<select name="${escape(key)}"${multiple ? ' multiple size="4"' : ''}${required ? ' required' : ''}>
    ${options.map(([id, text]) => `<option value="${escape(id)}"${selected.includes(id) ? ' selected' : ''}>${escape(text)}</option>`).join('')}</select>`;
  return `<label>${escape(label)}${multiple ? field : `<span class="select-control">${field}</span>`}</label>`;
}
const options = (collection, label = 'name') => data[collection].map(record => [record.id, record[label]]);
const optional = collection => [['', '—'], ...options(collection)];
const assignableOptions = () => data.agents.filter(agent => agent.runtime !== 'observed')
  .map(agent => [agent.id, agent.name]);
const budgetInput = (label, key, value, min = 1) => input(label, key, value, {type: 'number', required: true, min, max: 1e12});

function edit(title, html, handler, submit = '保存') {
  el('dialog-title').textContent = title;
  el('fields').innerHTML = html;
  el('form-error').textContent = '';
  const button = el('editor').querySelector('[type=submit]');
  button.textContent = submit;
  button.disabled = false;
  saveForm = handler;
  openModal('dialog');
  renderAvatarPreview();
}

function editNamed(kind, id) {
  const label = {project: '项目', team: '小组', skill: '技能'}[kind];
  const value = find(kind + 's', id) ?? {};
  const projectFields = kind === 'project' ? input('负责人', 'owner', value.owner) +
    input('截止日期', 'dueDate', value.dueDate, {type:'date'}) +
    input('Git 仓库地址（可选）', 'repositoryUrl', value.repositoryUrl, {type:'url'}) : '';
  edit((id ? '编辑' : '新建') + label, input('名称', 'name', value.name, {required: true}) +
    area('说明', 'description', value.description) + projectFields,
  form => api(kind + 's', {...Object.fromEntries(form), id}));
}

const spaceRoot = id => 'projects/' + id + '/space';
const spaceFile = (id, query) => spaceRoot(id) + '/file?' + new URLSearchParams(query);
const spaceTabs = {materials:'共享资料', pending:'待发布', published:'已发布'};
const deliveryStates = {pending:'待验收', conflict:'待合并', published:'已发布', returned:'已退回'};
const versionLabel = version => version == null ? '—' : 'v' + version;
let activeSpaceReview;

function spaceDownload(projectId, query) {
  return `<a class="space-link" href="/api/${escape(spaceFile(projectId, query))}" download>下载</a>`;
}

async function showProjectSpace(id, tab = 'materials') {
  const {project, files, versions, deliveries} = await api(spaceRoot(id));
  activeSpaceReview = undefined;
  const pending = deliveries.filter(item => ['pending', 'conflict'].includes(item.status));
  const rows = tab === 'materials' ? files : versions;
  const table = rows.length ? `<div class="table"><table><thead><tr><th>文件</th><th>版本</th><th>发布时间</th><th>操作</th></tr></thead>
    <tbody>${rows.map(file => {
      const version = file.versionId ?? file.id;
      return `<tr><td>${escape(file.path)}</td><td>${versionLabel(file.number)}</td><td>${escape(localDateTime(file.createdAt))}</td>
        <td>${actions(btn('space-preview', '查看', id + ':' + version), spaceDownload(id, {version}))}</td></tr>`;
    }).join('')}</tbody></table></div>` : empty('暂无共享文件。');
  const queue = pending.length ? `<div class="stack">${pending.map(delivery => `<article class="card">
    <div class="card-head"><h3>${escape(find('tasks', delivery.taskId)?.title ?? '任务交付')}</h3>
      ${badge(delivery.status === 'conflict' ? 'blocked' : 'review', deliveryStates[delivery.status])}</div>
    <p>${delivery.files.length} 个文件 · ${escape(localDateTime(delivery.createdAt))}</p>
    ${actions(btn('space-delivery', '查看交付', id + ':' + delivery.id))}</article>`).join('')}</div>` : empty('暂无待发布交付。');
  showPanel(project.name + ' · 公共工作区', `<div class="card-head">
    <div class="actions space-tabs" aria-label="工作区视图">${Object.entries(spaceTabs).map(([key, label]) =>
      `<button type="button" data-action="space-tab" data-id="${id}:${key}" aria-pressed="${tab === key}">${label}${key === 'pending' && pending.length ? ' ' + pending.length : ''}</button>`).join('')}</div>
    ${tab === 'materials' ? btn('space-upload', '上传文件', id, true) : ''}</div>
    ${project.repositoryUrl ? `<p class="description"><a class="space-link" href="${escape(project.repositoryUrl)}" target="_blank" rel="noopener noreferrer">打开 Git 仓库</a></p>` : ''}
    ${tab === 'pending' ? queue : table}`);
}

async function showSpaceDelivery(projectId, deliveryId) {
  const space = await api(spaceRoot(projectId));
  const delivery = space.deliveries.find(item => item.id === deliveryId);
  if (!delivery) throw new Error('交付不存在');
  const current = new Map(space.files.map(file => [file.path.normalize('NFC').toLowerCase(), file]));
  const reviewedHeads = [];
  const files = delivery.files.map((file, index) => {
    const head = current.get(file.path.normalize('NFC').toLowerCase());
    const changed = (head?.versionId ?? null) !== file.baseId;
    if (changed) reviewedHeads.push({path:file.path, currentId:head?.versionId ?? null});
    return `<tr><td>${escape(file.path)}</td><td>${versionLabel(file.baseNumber)}</td><td>${versionLabel(head?.number)}</td>
      <td>${delivery.status === 'published' ? '已发布' : changed ? '有版本冲突' : file.baseId ? '更新文件' : '新增文件'}</td>
      <td>${actions(btn('space-compare', '对比', projectId + ':' + deliveryId + ':' + index),
        spaceDownload(projectId, {delivery:deliveryId, path:file.path}))}</td></tr>`;
  }).join('');
  activeSpaceReview = {projectId, deliveryId, taskId:delivery.taskId, reviewedHeads};
  const open = ['pending', 'conflict'].includes(delivery.status);
  const controls = open ? actions(btn('space-return', '退回重跑', deliveryId),
    delivery.status === 'conflict' ? btn('space-resolve', '确认以此交付发布新版本', deliveryId, true)
      : btn('space-approve', '验收并发布', deliveryId, true)) : '';
  showPanel('项目交付 · ' + (find('tasks', delivery.taskId)?.title ?? space.project.name),
    `${actions(btn('space-tab', '返回待发布', projectId + ':pending'), badge(delivery.status === 'conflict' ? 'blocked' : 'review', deliveryStates[delivery.status]))}
    ${open && reviewedHeads.length ? '<p class="description">共享文件已有更新。对比基线、当前版本和交付后，可退回重跑，或确认将交付发布为新版本。</p>' : ''}
    <div class="table"><table><thead><tr><th>文件</th><th>开工基线</th><th>当前版本</th><th>变更</th><th>操作</th></tr></thead>
    <tbody>${files}</tbody></table></div>${controls}`);
}

function spacePreviewCard(label, file) {
  const content = file?.text == null ? empty(file ? '文件可下载查看' : '该版本没有此文件') :
    `<pre>${escape(file.text)}</pre>${file.truncated ? '<p class="description">仅显示前 64 KiB</p>' : ''}`;
  return `<article class="card"><h3>${escape(label)}</h3>${content}</article>`;
}

async function compareSpaceFile(projectId, deliveryId, index) {
  const space = await api(spaceRoot(projectId));
  const file = space.deliveries.find(item => item.id === deliveryId)?.files[index];
  if (!file) throw new Error('交付文件不存在');
  const current = space.files.find(item => item.path.normalize('NFC').toLowerCase() === file.path.normalize('NFC').toLowerCase());
  const preview = query => api(spaceFile(projectId, {...query, preview:'1'}));
  const [base, latest, draft] = await Promise.all([
    file.baseId ? preview({version:file.baseId}) : null,
    current ? preview({version:current.versionId}) : null,
    preview({delivery:deliveryId, path:file.path}),
  ]);
  showPanel(file.path, actions(btn('space-delivery', '返回交付', projectId + ':' + deliveryId)) +
    `<div class="space-compare">${spacePreviewCard('开工基线 ' + versionLabel(file.baseNumber), base)}
    ${spacePreviewCard('当前版本 ' + versionLabel(current?.number), latest)}${spacePreviewCard('本次交付', draft)}</div>`);
}

async function uploadSpaceFile(projectId) {
  const {files} = await api(spaceRoot(projectId));
  edit('上传共享文件',
    '<label>文件<input type="file" name="file" required></label>' +
    input('共享路径（留空使用文件名）', 'path') +
    '<p class="description">每个文件最多 16 MiB。使用已有路径会保留旧版并发布新版本。</p>', async form => {
      const file = form.get('file');
      const path = String(form.get('path')).trim() || file.name;
      const existing = files.find(item => item.path.normalize('NFC').toLowerCase() === path.normalize('NFC').toLowerCase());
      const response = await fetch('/api/' + spaceFile(projectId, {path, base:existing?.versionId ?? ''}),
        {method:'PUT', headers:{'Content-Type':'application/octet-stream'}, body:file});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '上传失败');
      await showProjectSpace(projectId);
    }, '上传');
}

const runtimeOptions = [['codex', '本机 Codex（新会话）'], ['pi', '本机 Pi（仅文本）'], ['demo', '演示运行器']];
const observedOption = ['observed', '仅采集（无平台执行权限）'];

function agentFields(agent, runtimes, required = false) {
  return input('姓名', 'name', agent.name, {required: true}) +
    select('岗位', 'role', Object.entries(roleLabels), agent.role) +
    select('小组', 'teamId', optional('teams'), agent.teamId) +
    avatarFields(agent) +
    area('人格', 'personality', agent.personality, required) +
    area('职责范围', 'scope', agent.scope, required) +
    select('技能（多选）', 'skillIds', options('skills'), agent.skillIds, {multiple: true}) +
    select('运行方式', 'runtime', runtimes, agent.runtime) +
    (runtimes.some(([runtime]) => runtime !== 'observed') ? input('模型（可选，留空沿用本机配置）', 'model', agent.model) : '') +
    (runtimes.some(([runtime]) => runtime === 'codex' || runtime === 'demo')
      ? select('文件权限', 'sandbox', [['read-only', '只读'], ['workspace-write', '执行目录可写']], agent.sandbox)
      : '') +
    '<p class="description">Pi 仅处理文本。仅采集的员工没有平台执行权限。人事与财务的 Codex 执行使用只读权限。</p>';
}

function updateFilePermission() {
  const {runtime, sandbox} = el('editor').elements;
  if (!sandbox) return;
  const update = () => { sandbox.disabled = runtime.value === 'pi'; };
  runtime.addEventListener('change', update);
  update();
}

function editAgent(id) {
  const agent = find('agents', id) ?? {};
  const runtimes = agent.candidateId
    ? [observedOption, ...runtimeOptions].filter(([id]) => id === agent.runtime) : runtimeOptions;
  edit(id ? '员工配置' : '创建员工', agentFields(agent, runtimes, Boolean(agent.candidateId)),
    form => api('agents', {...Object.fromEntries(form), id, skillIds: form.getAll('skillIds')}));
  updateFilePermission();
}

function editCandidate(id) {
  const candidate = find('candidates', id);
  const runtimes = [observedOption];
  if (candidate.machineId === 'local' && candidate.kind === 'installation') {
    runtimes.push(...runtimeOptions.filter(([id]) => id === candidate.provider));
  }
  const profile = candidate.draft ?? {name: providerLabels[candidate.provider], runtime: 'observed'};
  edit('人事入职档案',
    `<p class="description">${escape(name('machines', candidate.machineId))} · ${escape(providerLabels[candidate.provider])}</p>` +
    agentFields(profile, runtimes, true),
    form => api('candidates/' + id + '/review', {...Object.fromEntries(form), skillIds: form.getAll('skillIds')}),
    '提交入职档案');
  updateFilePermission();
}

function approveCandidate(id) {
  const {draft, reviewVersion} = find('candidates', id);
  edit('确认入职', `<div class="card"><h3>${escape(draft.name)} · ${escape(roleLabels[draft.role])}</h3>
    <p>人格 ${escape(draft.personality)}</p><p>职责 ${escape(draft.scope)}</p>
    <p>小组 ${escape(name('teams', draft.teamId))}</p>
    <p>人物形象 ${escape(resolveAvatar(draft).name)}</p>
    <p>技能 ${escape(draft.skillIds.map(id => name('skills', id)).join('、') || '—')}</p>
    <p>权限 ${draft.runtime === 'observed' ? '仅采集' : draft.runtime === 'pi' ? '本机仅文本执行' : draft.sandbox === 'workspace-write' ? '本机执行目录可写' : '本机只读执行'}</p></div>`,
    () => api('candidates/' + id + '/approve', {reviewVersion}), '批准入职');
}

function pairMachine() {
  edit('配对新机器', input('机器名称', 'name', '', {required: true}) +
    '<p class="description">把采集客户端复制到目标机器，安装时输入配对密钥。</p>',
    async form => {
      const {token} = await api('machines', {name: form.get('name')});
      const {loopback, protocol, port} = data.collector;
      const address = loopback ? `${protocol}://127.0.0.1:${port}` : `${protocol}://接收主机地址:${port}`;
      el('pair-token').value = token;
      el('pair-command').textContent = `node office-collector.mjs install ${address}${!loopback && protocol === 'http' ? ' --allow-http' : ''}\nnode office-collector.mjs run` +
        (loopback ? '\n\n远程机器需要先建立到接收端的 SSH 转发。' : '');
      openModal('pairing');
    }, '生成配对密钥');
}

function editTask(id, conversationId = '', preset = {}) {
  const task = find('tasks', id) ?? preset;
  const parent = find('tasks', task.parentId);
  const canSchedule = !task.parentId && !task.lastRunId && !['done','cancelled'].includes(task.status);
  const scheduleDate = task.scheduledAt ? new Date(task.scheduledAt) : null;
  const scheduleValue = scheduleDate ?
    new Date(scheduleDate.getTime() - scheduleDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '';
  const conversation = find('conversations', conversationId);
  const tags = (data.settings?.labels ?? []).filter(item => !item.archived);
  const fields = (data.settings?.properties ?? []).filter(item => !item.archived);
  const properties = fields.map(field => {
    const key = 'property-' + field.id;
    const value = task.properties?.[field.id];
    return field.type === 'select'
      ? select(field.name, key, [['', '—'], ...field.options.map(value => [value, value])], value)
      : input(field.name, key, value, field.type === 'number' ? {type: 'number', step: 'any'} : {});
  }).join('');
  edit(id ? '编辑任务' : parent ? '添加子任务' : '新建任务',
    (parent ? `<p class="description">父任务 · ${escape(parent.title)}</p>` : '') +
    input('标题', 'title', task.title ?? (conversation ? conversation.topic + ' · 后续工作' : ''), {required: true}) +
    area('任务描述', 'description', task.description) + area('验收标准', 'acceptance', task.acceptance) +
    select('负责人', 'assigneeId', [['', '—'], ...assignableOptions()], task.assigneeId) +
    select('真人负责人或协作者', 'humanId', [['', '—'], ...(data.humans ?? []).map(person => [person.id, person.name])], task.humanId) +
    (!parent ? select('项目', 'projectId', optional('projects'), task.projectId) : '') +
    (canSchedule ? input('定时派发（本机时间，留空则手动）', 'scheduledAt', scheduleValue, {type:'datetime-local'})
      : task.scheduledAt ? `<p class="description">${escape(taskScheduleLabel(task))}</p>` : '') +
    select('优先级', 'priority', Object.entries(priorityLabels), task.priority ?? data.settings?.workflow.defaultPriority) +
    input('截止日期', 'dueDate', task.dueDate, {type: 'date'}) +
    (tags.length ? select('标签（多选）', 'labelIds', tags.map(tag => [tag.id, tag.name]), task.labelIds, {multiple: true}) : '') +
    properties +
    select('前置任务（多选）', 'dependencyIds', options('tasks', 'title').filter(([taskId]) => taskId !== id),
      task.dependencyIds, {multiple: true}),
    form => {
      const payload = {
        id, conversationId, title: form.get('title'), description: form.get('description'),
        acceptance: form.get('acceptance'), assigneeId: form.get('assigneeId'), humanId: form.get('humanId'), projectId: form.get('projectId'),
        priority: form.get('priority'), dueDate: form.get('dueDate'),
        dependencyIds: form.getAll('dependencyIds'), labelIds: form.getAll('labelIds'),
        properties: Object.fromEntries(fields.map(field => {
          const value = form.get('property-' + field.id);
          return [field.id, field.type === 'number' && value !== '' ? Number(value) : value];
        })),
      };
      if (!id && parent) payload.parentId = parent.id;
      const scheduled = form.get('scheduledAt');
      if (scheduled != null && scheduled !== scheduleValue) payload.scheduledAt = scheduled ? new Date(scheduled).toISOString() : '';
      return api('tasks', payload);
    });
}

function editBudget() {
  const targets = [['company:local', '公司总预算'],
    ...options('teams').map(([id, label]) => ['team:' + id, '小组 · ' + label]),
    ...options('agents').map(([id, label]) => ['agent:' + id, '员工 · ' + label])];
  edit('设置累计 Token 预算', select('对象', 'target', targets, 'company:local') +
    budgetInput('Token 上限', 'limit', data.ledger[0].limit ?? 100_000, 0), form => {
    const [scope, targetId] = form.get('target').split(':');
    return api('budgets', {scope, targetId, limit: Number(form.get('limit'))});
  });
  const form = el('editor');
  form.elements.target.onchange = () => {
    const [scope, id] = form.elements.target.value.split(':');
    form.elements.limit.value = data.ledger.find(row => row.scope === scope && row.id === id)?.limit ?? '';
  };
}

function newConversation() {
  edit('发起讨论', input('主题', 'topic', '', {required: true}) +
    select('参与员工（至少两人）', 'participantIds', assignableOptions(), [], {multiple: true}) +
    select('关联任务', 'taskId', [['', '—'], ...options('tasks', 'title')], '') +
    input('讨论轮数', 'rounds', 1, {type: 'number', required: true, min: 1, max: 3}) +
    budgetInput('每人每轮预留 Token', 'reserve', data.settings?.runtime.meetingReserve ?? 5000),
    form => api('conversations', {...Object.fromEntries(form), participantIds: form.getAll('participantIds'),
      rounds: Number(form.get('rounds')), reserve: Number(form.get('reserve'))}), '发起讨论');
}

const checkbox = (label, key, checked) =>
  `<label class="checkbox"><input name="${key}" type="checkbox"${checked ? ' checked' : ''}> ${escape(label)}</label>`;

function editSettings(id) {
  const cfg = data.settings[id];
  const required = {required: true};
  switch (id) {
    case 'workspace':
      edit('编辑工作区资料', input('名称', 'name', cfg.name, required) +
        input('本机操作者', 'operator', cfg.operator, required) + input('任务编号前缀', 'taskPrefix', cfg.taskPrefix, required) +
        area('简介', 'description', cfg.description) + area('工作区上下文', 'context', cfg.context) +
        '<p class="description">工作区上下文会提供给后续排队的 Codex 和 Pi 执行。修改编号前缀后，所有任务使用新前缀。</p>',
      form => api('settings/workspace', Object.fromEntries(form)));
      break;
    case 'preferences': {
      const zones = ['UTC', ...Intl.supportedValuesOf('timeZone')];
      edit('编辑浏览器偏好',
        select('外观', 'theme', [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']], preferences.theme) +
        select('任务默认视图', 'taskView', [['board', '看板'], ['list', '列表']], preferences.taskView) +
        select('时区', 'timeZone', [['local', '跟随浏览器'], ...zones.map(zone => [zone, zone])], preferences.timeZone), form => {
          preferences = Object.fromEntries(form);
          localStorage.setItem('office.preferences', JSON.stringify(preferences));
          taskView = undefined;
          applyTheme();
          render();
        });
      break;
    }
    case 'workflow':
      edit('编辑任务流程', data.taskStates.map(status => input(labels[status] + '的显示名称', status,
        cfg.names[status], required)).join('') +
        select('新任务默认优先级', 'defaultPriority', Object.entries(priorityLabels), cfg.defaultPriority) +
        '<p class="description">列名可按团队习惯设置。执行、验收和依赖仍遵循对应阶段的规则。</p>',
      form => api('settings/workflow', {names: Object.fromEntries(data.taskStates.map(status => [status, form.get(status)])),
        defaultPriority: form.get('defaultPriority')}));
      break;
    case 'runtime': {
      const locked = data.settings.runtimeConcurrencyLocked;
      edit('编辑运行策略', (locked ? '<p class="description">并发上限由 OFFICE_CONCURRENCY 指定。</p>'
        : input('并发上限', 'concurrency', cfg.concurrency, {type: 'number', required: true, min: 1, max: 16})) +
        input('执行时限（分钟）', 'timeoutMinutes', cfg.timeoutMinutes, {type: 'number', required: true, min: 1, max: 120}) +
        budgetInput('任务默认预留 Token', 'reserve', cfg.reserve) +
        budgetInput('会议发言默认预留 Token', 'meetingReserve', cfg.meetingReserve) +
        checkbox('自动扫描本机', 'autoScan', cfg.autoScan) +
        input('本机扫描间隔（秒）', 'scanSeconds', cfg.scanSeconds, {type: 'number', required: true, min: 5, max: 120}),
      form => api('settings/runtime', {concurrency: locked ? cfg.concurrency : Number(form.get('concurrency')),
        timeoutMinutes: Number(form.get('timeoutMinutes')), reserve: Number(form.get('reserve')),
        meetingReserve: Number(form.get('meetingReserve')), autoScan: form.has('autoScan'), scanSeconds: Number(form.get('scanSeconds'))}));
      break;
    }
    case 'notifications':
      edit('编辑通知偏好', Object.entries(notificationLabels).map(([key, label]) => checkbox(label, key, cfg[key])).join('') +
        '<p class="description">开关决定收件箱显示哪些事件，执行记录和变更记录会继续保留。</p>',
      form => api('settings/notifications', Object.fromEntries(Object.keys(notificationLabels).map(key => [key, form.has(key)]))));
      break;
  }
}

function editCatalogue(kind, id) {
  const collection = kind === 'label' ? data.settings.labels : data.settings.properties;
  const item = collection.find(item => item.id === id) ?? {};
  const isLabel = kind === 'label';
  const typeControl = item.type ? `<p class="description">字段类型 ${propertyLabels[item.type]}</p>`
    : select('类型', 'type', Object.entries(propertyLabels), 'text');
  const fields = isLabel ? select('颜色', 'color', [['green', '绿'], ['blue', '蓝'], ['amber', '黄'],
    ['red', '红'], ['gray', '灰']], item.color)
    : typeControl + (item.type && item.type !== 'select' ? '' : area('单选选项（每行一个）', 'options', item.options?.join('\n')));
  edit((id ? '编辑' : '新建') + (isLabel ? '标签' : '自定义字段'),
    input('名称', 'name', item.name, {required: true}) + area('说明', 'description', item.description) + fields, form => {
      const payload = {id, name: form.get('name'), description: form.get('description')};
      if (isLabel) payload.color = form.get('color');
      else {
        payload.type = item.type ?? form.get('type');
        payload.options = (form.get('options') ?? '').split('\n').map(text => text.trim()).filter(Boolean);
      }
      return api('settings/' + kind, payload);
    });
}

function archiveCatalogue(kind, id) {
  const collection = kind === 'label' ? data.settings.labels : data.settings.properties;
  const item = collection.find(item => item.id === id);
  if (item.archived) return api('settings/' + kind + '/' + id + '/archive', {archived: false});
  edit('归档 ' + item.name, '<p>归档后将从任务选择项中隐藏。现有任务上的值会保留，可随时恢复。</p>',
    () => api('settings/' + kind + '/' + id + '/archive', {archived: true}), '确认归档');
}

async function action(type, id, anchor) {
  if (!actionAllowed(type, id)) return;
  if (await workspaceView.action(type, id)) return;
  switch (type) {
    case 'account-open': navigate('settings', 'account'); break;
    case 'account-users': navigate('settings', 'users'); break;
    case 'account-edit': editAccount(id); break;
    case 'account-password': editAccountPassword(); break;
    case 'account-mention-email': {
      const {user} = await api('auth/mention-email', {enabled:!signedInUser.mentionEmail});
      signedInUser = user;
      render();
      break;
    }
    case 'account-logout':
      await api('auth/logout', {});
      reloadAccount();
      break;
    case 'overview-details': showOverviewDetails(id); break;
    case 'overview-refresh': await refresh(); break;
    case 'overview-tasks': navigate('tasks'); break;
    case 'overview-settings': navigate('settings'); break;
    case 'overview-conversations': navigate('conversations'); break;
    case 'overview-fullscreen': toggleOverviewFullscreen(id); break;
    case 'office-view':
      officeFlat = !officeFlat;
      if (!officeFlat) office3dUnavailable = false;
      render();
      break;
    case 'office-person':
      selectedActor = selectedActor === id ? undefined : id;
      render();
      break;
    case 'office-orbit': officeScene?.rotate(Number(id)); break;
    case 'office-zoom-out':
    case 'office-zoom-in':
    case 'office-zoom-reset':
      officeZoom = type === 'office-zoom-reset' ? 100 : Math.max(80, Math.min(140, officeZoom + (type === 'office-zoom-in' ? 10 : -10)));
      if (type === 'office-zoom-reset') officeScene?.rotate(0);
      render();
      break;
    case 'settings-section': navigate('settings', id); break;
    case 'setting-edit': editSettings(id); break;
    case 'label-edit': editCatalogue('label', id); break;
    case 'property-edit': editCatalogue('property', id); break;
    case 'label-archive': await archiveCatalogue('label', id); break;
    case 'property-archive': await archiveCatalogue('property', id); break;
    case 'goto-inbox': navigate('inbox'); break;
    case 'goto-notifications': navigate('settings', 'notifications'); break;
    case 'goto-discovery': navigate('discovery'); break;
    case 'goto-people': navigate('people'); break;
    case 'goto-finance': navigate('finance'); break;
    case 'inbox-read': await api('inbox/read', {through: inboxData.events[0].seq}); break;
    case 'task-view': await viewTask(id); break;
    case 'project-tasks':
      taskFilters = {project:id};
      taskFilterDraft = {...taskFilters};
      boardScope = 'all';
      boardFilterOpen = true;
      navigate('tasks', 'all');
      break;
    case 'task-discussion-view': await viewTask(...id.split(':')); break;
    case 'task-child-add': editTask('', '', {parentId:id}); break;
    case 'task-jump-comment': jumpToComment(id); break;
    case 'task-compose':
      commentForm.elements.text.focus();
      break;
    case 'task-reply':
      setReplyTarget(taskComments.find(comment => comment.id === id));
      commentForm.elements.text.focus();
      break;
    case 'task-remove-mention':
      draftMentions.delete(id);
      if (replyMentionKey === id) replyMentionKey = undefined;
      showDraftMentions();
      commentForm.elements.text.focus();
      break;
    case 'task-run-view':
      await action('run-view', id);
      break;
    case 'task-filters-clear': taskFilters = {}; taskFilterDraft = {}; render(); break;
    case 'board-scope': boardScope = id; render(); break;
    case 'board-filter': boardFilterOpen = !boardFilterOpen; render(); break;
    case 'board-show-meta': boardShowMeta = !boardShowMeta; render(); break;
    case 'board-hide-empty': boardHideEmpty = !boardHideEmpty; render(); break;
    case 'board-new-task': editTask('', '', {projectId:taskFilters.project}); break;
    case 'board-display':
      showBoardMenu(boardButton('board-show-meta', (boardShowMeta ? '隐藏' : '显示') + '卡片信息') +
        boardButton('board-hide-empty', boardHideEmpty ? '显示空列' : '隐藏空列') + '<hr>' +
        boardButton('board-run-list', '执行记录', '', 'clock') +
        boardButton('ws-projects', '查看项目') + boardButton('project-edit', '新建项目', '', 'plus'), anchor);
      break;
    case 'board-run-list':
      showPanel('任务执行记录', runTable(data.runs.filter(run => run.kind === 'task').slice(0, 40)));
      break;
    case 'board-task-menu': showBoardTaskMenu(id, anchor); break;
    case 'board-column-menu':
      showBoardMenu(boardButton('board-column-filter', '筛选本列任务', id, 'filter') +
        boardButton('board-new-task', '新建待办任务', id, 'plus'), anchor);
      break;
    case 'board-column-filter':
      taskFilters = {...taskFilters, status:id};
      taskFilterDraft = {...taskFilters};
      boardFilterOpen = true;
      render();
      break;
    case 'board-set-status':
    case 'board-set-priority': {
      const [taskId, value] = id.split(':');
      const field = type === 'board-set-status' ? 'status' : 'priority';
      const task = find('tasks', taskId);
      if ((task[field] ?? 'none') === value) break;
      if (field === 'status' && value === 'done') return action('task-done', taskId);
      const updated = await api('tasks/' + taskId + '/' + field, {[field]:value});
      data.tasks = data.tasks.map(item => item.id === taskId ? updated : item);
      render();
      break;
    }
    case 'board-task-field': editBoardTaskField(id); break;
    case 'board-copy-link': await navigator.clipboard.writeText(boardTaskLink(id)); break;
    case 'task-view-switch':
      taskView = (taskView ?? preferences.taskView) === 'list' ? 'board' : 'list';
      render();
      break;
    case 'agent-edit': editAgent(id); break;
    case 'scan-local': await api('discovery/scan', {}); break;
    case 'machine-pair': pairMachine(); break;
    case 'machine-revoke':
      edit('撤销机器配对', `<p>停止接收 ${escape(name('machines', id))} 的上报。</p>`,
        () => api('machines/' + id + '/revoke', {}), '撤销配对');
      break;
    case 'candidate-review': editCandidate(id); break;
    case 'candidate-approve': approveCandidate(id); break;
    case 'candidate-dismiss':
      await api('candidates/' + id + '/dismiss', {});
      break;
    case 'candidate-assign': {
      const candidate = find('candidates', id);
      const hr = data.agents.find(agent => agent.role === 'hr' && agent.runtime === 'codex');
      editTask('', '', {title: `拟定入职档案 · ${providerLabels[candidate.provider]}`, assigneeId: hr.id,
        description: `请为候选 Agent ${candidate.id} 拟定姓名、人格、职责和适用技能，并使用 office_review_candidate 提交。最终由管理员确认入职。`,
        acceptance: '候选进入待确认状态。'});
      break;
    }
    case 'team-edit':
    case 'skill-edit':
    case 'project-edit': editNamed(type.split('-')[0], id); break;
    case 'task-edit': editTask(id); break;
    case 'conversation-task': editTask('', id); break;
    case 'budget-edit': editBudget(); break;
    case 'conversation-new': newConversation(); break;
    case 'conversation-add': {
      const conversation = find('conversations', id);
      const available = assignableOptions().filter(([agentId]) => !conversation.participantIds.includes(agentId));
      if (!available.length) throw new Error('全部员工已在讨论中');
      edit('加入员工', select('员工', 'agentId', available), form => api('conversations/' + id + '/add', {
        agentId: form.get('agentId'),
      }), '加入');
      break;
    }
    case 'conversation-close': await api('conversations/' + id + '/close', {}); break;
    case 'conversation-resume': await api('conversations/' + id + '/resume', {}); break;
    case 'project-space': await showProjectSpace(id); break;
    case 'space-tab': await showProjectSpace(...id.split(':')); break;
    case 'space-upload': await uploadSpaceFile(id); break;
    case 'space-delivery': await showSpaceDelivery(...id.split(':')); break;
    case 'space-compare': await compareSpaceFile(...id.split(':')); break;
    case 'space-preview': {
      const [projectId, version] = id.split(':');
      const file = await api(spaceFile(projectId, {version, preview:'1'}));
      showPanel(file.path, actions(btn('project-space', '返回工作区', projectId), spaceDownload(projectId, {version})) +
        spacePreviewCard('文件内容', file));
      break;
    }
    case 'space-return':
    case 'space-approve':
    case 'space-resolve': {
      const review = activeSpaceReview;
      if (review?.deliveryId !== id) break;
      const payload = {status:type === 'space-return' ? 'todo' : 'done', deliveryId:id};
      if (type === 'space-resolve') payload.reviewedHeads = review.reviewedHeads;
      try {
        await api('tasks/' + review.taskId + '/status', payload);
      } catch (error) {
        if (error.status === 409) await showSpaceDelivery(review.projectId, id);
        throw error;
      }
      await showProjectSpace(review.projectId, type === 'space-return' ? 'pending' : 'published');
      break;
    }
    case 'task-done': {
      const {delivery, subtasks} = await api('tasks/' + id);
      if (subtasks.some(child => !['done','cancelled'].includes(child.status))) {
        if (selectedTask !== id) await viewTask(id);
        break;
      }
      if (delivery && ['pending', 'conflict'].includes(delivery.status)) {
        await showSpaceDelivery(delivery.projectId, delivery.id);
      } else {
        await api('tasks/' + id + '/status', {status:'done'});
      }
      break;
    }
    case 'task-manual-start': await api('tasks/' + id + '/status', {status: 'in_progress'}); break;
    case 'task-manual-review': await api('tasks/' + id + '/status', {status: 'review'}); break;
    case 'task-reopen': await api('tasks/' + id + '/status', {status: 'todo'}); break;
    case 'task-run': {
      const task = find('tasks', id);
      const agent = find('agents', task.assigneeId);
      edit('启动执行', `<p class="description">${escape(task.title)} · ${escape(agent.name)} · ${runtimeLabels[agent.runtime]}</p>` +
        budgetInput('预留 Token', 'reserve', data.settings?.runtime.reserve ?? 10_000),
        form => api('tasks/' + id + '/run', {reserve: Number(form.get('reserve'))}), '启动');
      break;
    }
    case 'run-stop': await api('runs/' + id + '/stop', {}); break;
    case 'run-view':
      selectedRun = id;
      el('run-body').innerHTML = empty('正在加载执行…');
      openModal('inspection');
      showRunDetail(await api('runs/' + id));
      break;
  }
}

el('pairing').addEventListener('close', () => { el('pair-token').value = ''; });
el('overview-dialog').addEventListener('close', () => {
  if (el('overview-dialog').open) return;
  overviewDetails = undefined;
  if (el('office-layout-dialog-viewport')) renderOfficeScene();
});
document.addEventListener('close', event => {
  const modal = event.target;
  if (!(modal instanceof HTMLDialogElement) || modal.open) return;
  const opener = modalOpeners.get(modal);
  modalOpeners.delete(modal);
  // The discrete exit transition can keep the previously focused input in the top layer.
  Promise.allSettled(modal.getAnimations().map(animation => animation.finished)).then(() => {
    requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (document.querySelector('.modal[open]') || (activeElement !== document.body && !modal.contains(activeElement))) return;
      const trigger = opener?.isConnected && opener !== document.body ? opener
        : [...el('main').querySelectorAll('[data-action]')].find(button =>
          button.dataset.action === opener?.dataset?.action && button.dataset.id === opener?.dataset?.id);
      (trigger ?? document.querySelector('.symbio-navigation [aria-current="page"]'))?.focus({preventScroll:true});
    });
  });
}, true);
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && fullscreenMode) {
    endOverviewFullscreen();
    render();
  }
});
document.addEventListener('keydown', event => {
  const submenu = el('task-board-submenu');
  if (event.key === 'Escape' && !submenu.hidden) {
    event.preventDefault();
    closeBoardSubmenu(true);
    return;
  }
  if (event.key === 'Escape') closeBoardMenu(true);
  if (event.key === 'ArrowLeft' && submenu.contains(event.target)) {
    event.preventDefault();
    closeBoardSubmenu(true);
  }
  if (event.key === 'ArrowRight' && event.target.dataset.boardSubmenu) {
    event.preventDefault();
    openBoardSubmenu(event.target, true);
  }
  if (event.key === 'Escape' && fullscreenMode && !document.fullscreenElement && !document.querySelector('dialog[open]')) {
    endOverviewFullscreen();
    render();
  }
});
setInterval(() => { if (page === 'discovery') scheduleRefresh(); }, 10000);
setInterval(() => {
  if (!el('inspection').open) return;
  for (const timer of el('run-body').querySelectorAll('[data-elapsed-from]')) {
    timer.textContent = duration(timer.dataset.elapsedFrom, null);
  }
}, 1000);
el('inspection').addEventListener('close', () => {
  if (!el('inspection').open) selectedRun = undefined;
});
window.addEventListener('resize', () => closeBoardMenu());
document.addEventListener('scroll', event => {
  if (event.target === document) closeBoardMenu();
}, true);
document.addEventListener('wheel', event => {
  if (!event.target.closest('.task-board-menu')) closeBoardMenu();
}, {passive:true});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.task-board-menu, [aria-controls="task-board-menu"]')) closeBoardMenu();
});
el('task-board-menu').addEventListener('pointerover', event => {
  if (event.pointerType === 'touch') return;
  const row = event.target.closest('button, a');
  if (row?.dataset.boardSubmenu) openBoardSubmenu(row);
  else if (row) closeBoardSubmenu();
});
document.addEventListener('contextmenu', event => {
  const card = event.target.closest('[data-task-card]');
  if (!card || !fullTaskBoard) return;
  event.preventDefault();
  showBoardTaskMenu(card.dataset.taskCard, card.querySelector('[data-action="board-task-menu"]'), event);
});
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (button?.hasAttribute('data-modal-close')) {
    button.closest('.modal')?.close();
    return;
  }
  if (!data) return;
  if (!button) {
    const card = event.target.closest('[data-task-card]');
    if (card) viewTask(card.dataset.taskCard).catch(errorNotice);
    return;
  }
  if (button.dataset.boardSubmenu) {
    openBoardSubmenu(button, button.matches(':focus-visible'));
    return;
  }
  if (button.dataset.page) {
    navigate(button.dataset.page);
  }
  if (button.dataset.action) {
    try {
      const type = button.dataset.action;
      if (button.closest('.task-board-menu')) closeBoardMenu();
      const menu = button.closest('.office-menu');
      if (menu) menu.open = false;
      if (button.closest('#overview-dialog') && !['overview-details', 'project-space'].includes(type) && !type.startsWith('space-')) {
        el('overview-dialog').close();
      }
      await action(type, button.dataset.id, button);
      scheduleRefresh();
    } catch (error) {
      errorNotice(error);
    }
  }
});
el('task-inspection').addEventListener('close', () => {
  if (!el('task-inspection').open) selectedTask = undefined;
});
el('dialog').addEventListener('close', () => {
  if (el('dialog').open) return;
  figurePreview?.dispose();
  figurePreview = undefined;
});
el('task-properties-toggle').addEventListener('click', event => {
  setTaskProperties(event.currentTarget.getAttribute('aria-expanded') !== 'true');
});
el('task-reply-clear').addEventListener('click', () => {
  setReplyTarget();
  commentForm.elements.text.focus();
});
el('task-mention-button').addEventListener('click', () => toggleMentionPicker(el('task-mention-picker').hidden, true));
commentForm.elements.text.addEventListener('input', event => {
  if (/(^|\s)@$/.test(event.target.value)) toggleMentionPicker(true);
});
el('task-mention-select').addEventListener('change', event => {
  const person = taskMentionTargets.find(target => target.key === event.target.value);
  if (!person) return;
  if (!draftMentions.has(person.key) && draftMentions.size >= 8) {
    commentForm.querySelector('.error').textContent = '每条评论最多 @ 8 名成员';
    return;
  }
  draftMentions.set(person.key, person);
  showDraftMentions();
  commentForm.elements.text.value = commentForm.elements.text.value.replace(/(^|\s)@$/, '$1');
  event.target.value = '';
  toggleMentionPicker(false);
  commentForm.elements.text.focus();
});
commentForm.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = event.submitter ?? form.querySelector('[type=submit]');
  const id = selectedTask;
  const error = form.querySelector('.error');
  if (!id || submit.disabled) return;
  submit.disabled = true;
  error.textContent = '';
  try {
    const comment = await api('tasks/' + id + '/comments', {text:new FormData(form).get('text'),
      replyToId, mentions:[...draftMentions.keys()], emailMentions:form.elements.emailMentions.checked});
    if (id === selectedTask) {
      clearTaskComposer();
      selectedComment = comment.id;
    }
    await loadTaskDetail(id);
  } catch (err) {
    if (id === selectedTask) error.textContent = err.message;
  } finally {
    submit.disabled = false;
  }
});
document.addEventListener('submit', event => {
  if (event.target.id !== 'task-filters') return;
  event.preventDefault();
  taskFilters = Object.fromEntries(new FormData(event.target));
  taskFilterDraft = {...taskFilters};
  render();
});
document.addEventListener('input', event => {
  if (event.target.form?.id === 'task-filters') taskFilterDraft = Object.fromEntries(new FormData(event.target.form));
});
el('editor').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter;
  const handler = saveForm;
  if (!handler || submit?.disabled) return;
  if (submit) submit.disabled = true;
  el('form-error').textContent = '';
  try {
    await handler(new FormData(event.currentTarget));
    if (saveForm === handler && el('dialog').open) el('dialog').close();
    scheduleRefresh();
  } catch (error) {
    if (saveForm === handler && el('dialog').open) el('form-error').textContent = error.message;
    else errorNotice(error);
  } finally {
    if (submit && saveForm === handler) submit.disabled = false;
  }
});

window.addEventListener('hashchange', route);
workspaceView.bind();

function accountFeedback(message, error = false) {
  const feedback = el('account-feedback');
  feedback.textContent = message;
  feedback.hidden = !message;
  feedback.toggleAttribute('data-error', error);
}

let emailAvailable = false, sendingCode = false, codeTimer;
const codeCooldowns = new Map();
const registrationCodeKey = (mode, email) => mode + ':' + email.trim().toLowerCase();

function updateCodeButton() {
  clearTimeout(codeTimer);
  const button = el('account-send-code');
  const email = el('account-form').elements.email.value;
  const deadline = codeCooldowns.get(registrationCodeKey(accountMode, email)) ?? 0;
  const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  button.disabled = !emailAvailable || sendingCode || remaining > 0;
  button.textContent = sendingCode ? '发送中…' : remaining ? remaining + ' 秒后重发' : '发送验证码';
  if (remaining && accountMode !== 'login') codeTimer = setTimeout(updateCodeButton, 1000);
}

function showAccountForm(mode) {
  accountMode = mode;
  const binding = mode === 'bind-email';
  const creating = mode === 'setup' || mode === 'register';
  const needsEmail = creating || binding;
  const copy = {
    setup:['创建首位管理员', '验证邮箱后创建工作台管理员账户。', '创建管理员'],
    register:['申请加入工作台', '验证邮箱并提交申请，管理员启用后即可登录。', '提交注册'],
    'bind-email':['绑定邮箱', '验证邮箱后即可进入工作台。', '验证并绑定'],
    login:['登录工作台', '使用工作区账户继续。', '登录'],
  }[mode];
  const form = el('account-form');
  el('account-heading').textContent = copy[0];
  el('account-description').textContent = copy[1];
  el('account-submit').textContent = copy[2];
  const fields = {
    name:creating, username:!binding, email:needsEmail, code:needsEmail, password:!binding, confirmPassword:creating,
  };
  for (const [name, visible] of Object.entries(fields)) {
    el('account-' + (name === 'confirmPassword' ? 'confirm' : name) + '-field').hidden = !visible;
    form.elements[name].disabled = !visible;
    form.elements[name].required = visible;
  }
  form.elements.password.minLength = creating ? 15 : 1;
  form.elements.password.autocomplete = creating ? 'new-password' : 'current-password';
  form.elements.password.value = '';
  form.elements.confirmPassword.value = '';
  form.elements.code.value = '';
  form.hidden = false;
  const toggle = el('account-switch');
  toggle.hidden = mode === 'setup';
  toggle.textContent = binding ? '退出登录' : mode === 'register' ? '返回登录' : '注册账号';
  updateCodeButton();
  accountFeedback(needsEmail && !emailAvailable ? '邮件服务尚未配置，请联系工作台管理员。' : '', needsEmail && !emailAvailable);
}

el('account-form').elements.email.addEventListener('input', event => {
  event.target.form.elements.code.value = '';
  updateCodeButton();
});
el('account-send-code').addEventListener('click', async () => {
  const form = el('account-form');
  const email = form.elements.email;
  if (sendingCode || !email.reportValidity()) return;
  const mode = accountMode;
  const key = registrationCodeKey(mode, email.value);
  const sameAddress = () => key === registrationCodeKey(accountMode, email.value);
  sendingCode = true;
  updateCodeButton();
  accountFeedback('');
  try {
    const {retryAfter} = await api(mode === 'bind-email' ? 'auth/email-code' : 'auth/registration-code', {email:email.value, mode});
    codeCooldowns.set(key, Date.now() + retryAfter * 1000);
    if (sameAddress()) {
      form.elements.code.value = '';
      form.elements.code.focus();
      accountFeedback('验证码已发送，请在 10 分钟内使用。');
    }
  } catch (error) {
    if (sameAddress()) accountFeedback(error.message, true);
  } finally {
    sendingCode = false;
    updateCodeButton();
  }
});

el('account-switch').addEventListener('click', async () => {
  if (accountMode === 'bind-email') {
    try {
      await api('auth/logout', {});
      reloadAccount();
    } catch (error) {
      accountFeedback(error.message, true);
    }
    return;
  }
  showAccountForm(accountMode === 'register' ? 'login' : 'register');
  el('account-form').elements.username.focus();
});
el('account-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = el('account-submit');
  if (submit.disabled) return;
  const mode = accountMode;
  const values = new FormData(form);
  const username = values.get('username');
  const password = values.get('password');
  if (['setup', 'register'].includes(mode) && password !== values.get('confirmPassword')) {
    accountFeedback('两次输入的密码不一致。', true);
    return;
  }
  submit.disabled = el('account-switch').disabled = true;
  accountFeedback('');
  try {
    await api('auth/' + mode, {username, password, name:values.get('name'), email:values.get('email'), code:values.get('code')});
    if (mode !== 'register') {
      reloadAccount();
      return;
    }
    form.reset();
    showAccountForm('login');
    form.elements.username.value = username;
    accountFeedback('注册申请已提交，管理员启用账户后即可登录。');
  } catch (error) {
    if (error.status === 409 && mode === 'setup' && !(await api('auth/session').catch(() => ({setup:true}))).setup) {
      showAccountForm('login');
    }
    accountFeedback(error.message, true);
  } finally {
    submit.disabled = el('account-switch').disabled = false;
  }
});

async function startWorkspace() {
  const {user, setup, emailAvailable:configured} = await api('auth/session');
  emailAvailable = configured;
  if (!user) {
    showAccountForm(setup ? 'setup' : 'login');
    return;
  }
  if (!user.email) {
    showAccountForm('bind-email');
    return;
  }
  signedInUser = user;
  route();
  await refresh();
  if (reloadingAccount) return;
  el('account-gate').hidden = true;
  el('office-shell').hidden = false;
  connect();
  showLinkedTask();
}

startWorkspace().catch(error => {
  el('account-heading').textContent = '无法连接工作台';
  el('account-description').textContent = '请确认本机服务正在运行，然后刷新页面。';
  accountFeedback(error.message, true);
});
