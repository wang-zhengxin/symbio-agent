// Labels and destinations shared by the sidebar, breadcrumbs and settings.
export const navigationGroups = [
  {name:'快捷入口', items:[
    {title:'新建任务', action:'task-edit', icon:'edit'},
    {title:'收件箱', page:'inbox', icon:'inbox', member:true},
    {title:'我的任务', page:'tasks', child:'mine', icon:'person', member:true},
    {title:'聊天', page:'conversations', icon:'chat'},
  ]},
  {name:'工作', items:[
    {title:'任务', page:'tasks', child:'all', icon:'tasks', member:true},
    {title:'项目', page:'tasks', icon:'project', member:true},
    {title:'定时任务', page:'tasks', child:'scheduled', icon:'automation'},
  ]},
  {name:'AI 团队', items:[
    {title:'智能体', page:'agents', icon:'bot'},
    {title:'小队', page:'teams', icon:'team'},
    {title:'Skills', page:'skills', icon:'skills'},
    {title:'运行时', page:'runtime', icon:'monitor'},
    {title:'发现与接入', page:'discovery', icon:'discovery'},
  ]},
  {name:'数字办公室', items:[
    {title:'办公室', page:'overview', icon:'office'},
    {title:'空间与工位', page:'layout', icon:'layout'},
  ]},
];
export const navigationFooter = [
  {title:'统计', page:'finance', icon:'stats'},
  {title:'设置', page:'settings', icon:'settings', member:true},
  {title:'帮助中心', page:'help', icon:'help', member:true},
];
export const settingsGroups = {
  '个人设置': {account:'个人资料', preferences:'偏好设置', notifications:'通知'},
  '工作区管理': {workspace:'常规', people:'成员', users:'账号与权限'},
  '任务配置': {workflow:'任务状态', labels:'标签', properties:'属性'},
  '连接与扩展': {integrations:'集成', mcp:'MCP'},
  '系统记录': {audit:'操作记录'},
};
export const settingsTitles = Object.assign({}, ...Object.values(settingsGroups));
const paths = {
  search:'m16 16 4 4M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  edit:'M12 4H4v16h16v-8M9 15l1-5L19 1l4 4-9 9-5 1',
  inbox:'M3 3h18v18H3zM3 14h5l2 3h4l2-3h5',
  person:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M5 21v-2a7 7 0 0 1 14 0v2',
  chat:'M3 3h18v15H8l-5 4V3',
  tasks:'m3 6 2 2 4-4M12 6h9M3 13h5m4 0h9M3 20h5m4 0h9',
  project:'M3 5h7l2 3h9v13H3V5M7 12v5m5-7v7m5-5v5',
  automation:'m13 2-9 12h7l-1 8 10-13h-7l0-7',
  bot:'M4 7h16v14H4V7m8-5v5M1 12v5m22-5v5M8 12v2m8-2v2m-8 4h8',
  team:'M10 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0M1 21v-3a6 6 0 0 1 12 0v3m3-17a3 3 0 0 1 0 6m0 5a5 5 0 0 1 5 5',
  skills:'M12 5C8 2 4 2 2 3v17c3-1 7-1 10 2m0-17c4-3 8-3 10-2v17c-3-1-7-1-10 2V5',
  monitor:'M2 3h20v14H2V3m10 14v5m-5 0h10',
  discovery:'M9 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12m5 11 7 7M6 9h6m-3-3v6',
  office:'M3 22V5l9-3 9 3v17H3m5-14h1m6 0h1m-8 5h1m6 0h1m-6 9v-5h4v5',
  layout:'M2 3h20v18H2V3m7 0v18m0-11h13',
  stats:'M3 2v20h19M8 17v-7m5 7V4m5 13v-9',
  settings:'M3 5h18M3 12h18M3 19h18M8 2v6m8 1v6m-8 1v6',
  help:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5m0 4h.01',
};
export function navigationIcon(name) {
  return `<svg class="navigation-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.settings}"/></svg>`;
}
export function navigationLocation(page, child = '') {
  for (const group of navigationGroups) {
    const item = group.items.find(item => item.page === page && (item.child || '') === child);
    if (item) return {group:group.name, title:item.title};
  }
  const item = navigationFooter.find(item => item.page === page);
  return {group:page === 'settings' ? '设置' : '工作空间', title:item?.title || '成员'};
}

export function taskMatchesView(task, view, user, humans = []) {
  if (task.parentId) return false;
  if (view === 'scheduled') return Boolean(task.scheduledAt);
  if (view !== 'mine') return true;
  return humans.some(human => human.id === task.humanId &&
    (Boolean(user.id) && human.userId === user.id ||
      Boolean(user.email) && human.email?.toLowerCase() === user.email.toLowerCase()));
}
