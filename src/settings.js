import { randomUUID } from 'node:crypto';
import { choice, fail, ids, integer, string } from './input.js';

export const priorities = ['none', 'low', 'medium', 'high', 'urgent'];
const states = {backlog: '待规划', todo: '待办', in_progress: '进行中', review: '审核中',
  blocked: '已阻塞', done: '已完成', cancelled: '已取消'};
export const taskStates = Object.keys(states);
const defaults = {
  workspace: {name: 'Agent 公司', description: '', context: '', taskPrefix: 'AG', operator: '管理员'},
  workflow: {names: states, defaultPriority: 'none'},
  runtime: {concurrency: 3, timeoutMinutes: 15, reserve: 10_000, meetingReserve: 5000, autoScan: true, scanSeconds: 10},
  notifications: {review: true, failures: true, hiring: true, machines: true, mentions: true},
};
const notifyTypes = {
  review: ['task.status'],
  failures: ['run.failed', 'run.interrupted', 'task.schedule_failed'],
  hiring: ['candidate.reviewed'],
  machines: ['machine.status'],
  mentions: ['task.mention'],
};
const text = (value, label, max = 120) => string(value, label, max);
const optional = (value, label, max) => string(value, label, max, true);
const timestamp = () => new Date().toISOString();

function flag(value, label) {
  if (typeof value !== 'boolean') fail(label + '须为布尔值');
  return value;
}

function date(value) {
  if (value === '' || value == null) return '';
  const result = text(value, '截止日期', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) fail('截止日期无效');
  const parsed = new Date(result + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) fail('截止日期无效');
  return result;
}

export function createSettings(store, {concurrencyOverride} = {}) {
  const {get, put, list, tx, event} = store;

  function read(section) {
    const saved = get('setting', section);
    if (section === 'workflow' && saved) {
      return {...defaults.workflow, ...saved.value, names: {...states, ...saved.value.names}};
    }
    return saved ? {...defaults[section], ...saved.value} : defaults[section];
  }

  function runtime() {
    return {...read('runtime'), ...(concurrencyOverride === undefined ? {} : {concurrency: concurrencyOverride})};
  }

  function validate(section, input) {
    switch (section) {
      case 'workspace': {
        const taskPrefix = text(input.taskPrefix, '任务编号前缀', 10).toUpperCase();
        if (!/^[A-Z0-9]{1,10}$/.test(taskPrefix)) fail('任务编号前缀只允许英文字母和数字');
        return {
          name: text(input.name, '工作区名称'), taskPrefix,
          description: optional(input.description, '简介', 1000),
          context: optional(input.context, '工作区上下文', 8000),
          operator: text(input.operator, '本机操作者名称', 80),
        };
      }
      case 'workflow':
        return {names: Object.fromEntries(Object.entries(states).map(([key, value]) =>
          [key, text(input.names?.[key] ?? value, '状态名称', 24)])),
          defaultPriority: choice(input.defaultPriority, priorities, '默认优先级')};
      case 'runtime':
        return {
          concurrency: concurrencyOverride === undefined
            ? integer(input.concurrency, '并发上限', 1, 16) : read('runtime').concurrency,
          timeoutMinutes: integer(input.timeoutMinutes, '执行时限（分钟）', 1, 120),
          reserve: integer(input.reserve, '任务预留 Token', 1, 1_000_000_000_000),
          meetingReserve: integer(input.meetingReserve, '会议发言预留 Token', 1, 1_000_000_000_000),
          autoScan: flag(input.autoScan, '自动扫描'),
          scanSeconds: integer(input.scanSeconds, '本机扫描间隔（秒）', 5, 120),
        };
      case 'notifications':
        return Object.fromEntries(Object.keys(notifyTypes).map(key => [key, flag(input[key] ?? read('notifications')[key], key)]));
      default: fail('设置页面不存在', 404);
    }
  }

  function save(section, input) {
    const value = validate(section, input);
    return tx(() => {
      put('setting', {id: section, value, updatedAt: timestamp()});
      event('settings.updated', {section});
      return section === 'runtime' ? runtime() : value;
    });
  }

  function catalogue(kind) {
    return list(kind);
  }

  function saveCatalogue(kind, input) {
    const before = input.id ? get(kind, input.id) : null;
    if (input.id && !before) fail('配置项不存在', 404);
    const name = text(input.name, '名称', 50);
    if (list(kind).some(item => item.id !== before?.id && item.name.toLowerCase() === name.toLowerCase())) {
      fail('该名称已存在', 409);
    }
    const description = optional(input.description, '说明', 500);
    let details = {};
    if (kind === 'label') {
      details.color = choice(input.color, ['green', 'blue', 'amber', 'red', 'gray'], '标签颜色');
    } else {
      const type = choice(input.type, ['text', 'number', 'select'], '字段类型');
      if (before && type !== before.type) fail('字段创建后不能更改类型', 409);
      let options = [];
      if (type === 'select') {
        if (!Array.isArray(input.options) || input.options.length < 1 || input.options.length > 30) {
          fail('单选字段需要 1 至 30 个选项');
        }
        options = [...new Set(input.options.map(option => text(option, '选项', 60)))];
        if (before && list('task').some(task => {
          const value = task.properties?.[before.id];
          return value != null && !options.includes(value);
        })) fail('某些选项仍用于任务，请先调整对应任务', 409);
      }
      details = {type, options};
    }
    return tx(() => {
      const record = put(kind, {...before, ...details, id: before?.id ?? randomUUID(),
        name, description, archived: before?.archived ?? false});
      event('catalogue.saved', {kind, id: record.id, name});
      return record;
    });
  }

  function archive(kind, id, archived) {
    flag(archived, '归档状态');
    return tx(() => {
      const item = get(kind, id);
      if (!item) fail('配置项不存在', 404);
      const record = put(kind, {...item, archived});
      event('catalogue.archived', {kind, id, name: record.name, archived});
      return record;
    });
  }

  function taskMetadata(input, before) {
    const priority = choice(input.priority ?? before?.priority ?? read('workflow').defaultPriority, priorities, '优先级');
    const dueDate = input.dueDate === undefined ? before?.dueDate ?? '' : date(input.dueDate);
    let labelIds = before?.labelIds ?? [];
    if (input.labelIds !== undefined) {
      const requested = ids(input.labelIds, '任务标签');
      for (const id of requested) {
        const label = get('label', id);
        if (!label || (label.archived && !labelIds.includes(id))) fail('所选标签不可用');
      }
      labelIds = [...new Set([...labelIds.filter(id => get('label', id)?.archived), ...requested])];
    }
    const properties = {...before?.properties};
    if (input.properties !== undefined) {
      if (!input.properties || typeof input.properties !== 'object' || Array.isArray(input.properties)) fail('任务字段无效');
      for (const [id, raw] of Object.entries(input.properties)) {
        const property = get('property', id);
        if (!property || property.archived) fail('所选字段不可用');
        if (raw === '' || raw === null) delete properties[id];
        else if (property.type === 'text') properties[id] = text(raw, property.name, 500);
        else if (property.type === 'select') properties[id] = choice(raw, property.options, property.name);
        else {
          if (typeof raw !== 'number' || !Number.isFinite(raw)) fail(property.name + '须为数字');
          properties[id] = raw;
        }
      }
    }
    return {priority, dueDate, labelIds, properties};
  }

  function nextTaskNumber() {
    const before = get('counter', 'task')?.value ?? 0;
    put('counter', {id: 'task', value: before + 1});
    return before + 1;
  }

  function backfillTaskNumbers() {
    const tasks = list('task');
    const missing = tasks.filter(task => !task.number);
    if (!missing.length) return;
    const highest = tasks.reduce((max, task) => Math.max(max, task.number ?? 0), get('counter', 'task')?.value ?? 0);
    tx(() => {
      put('counter', {id: 'task', value: highest});
      for (const task of missing) put('task', {...task, number: nextTaskNumber()});
    });
  }

  const isInitialUser = user => user?.id === get('account-config', 'initial')?.userId;
  const inboxKey = user => user && !isInitialUser(user) ? 'inbox:' + user.id : 'inbox';

  function inbox(includeEvents = true, user) {
    const enabled = read('notifications');
    const types = Object.keys(notifyTypes).filter(key => enabled[key] && (user?.role !== 'member' || key === 'mentions'))
      .flatMap(key => notifyTypes[key]);
    const scope = user ? {recipient:'user:' + user.id, legacy:Number(user.role === 'admin')} : undefined;
    const seenThrough = get('setting', inboxKey(user))?.seenThrough ?? 0;
    const events = includeEvents && types.length ? store.recentMatching(types, 80, scope) : [];
    return {seenThrough, events, unread: types.length ? store.countMatching(types, seenThrough, scope) : 0};
  }

  function markInboxRead(through, user) {
    integer(through, '通知游标', 0, store.cursor());
    return tx(() => {
      const id = inboxKey(user);
      const seenThrough = Math.max(through, get('setting', id)?.seenThrough ?? 0);
      put('setting', {id, seenThrough});
      event('inbox.read', {});
      return {seenThrough};
    });
  }

  function snapshot() {
    return {
      workspace: read('workspace'), workflow: read('workflow'), runtime: runtime(),
      runtimeConcurrencyLocked: concurrencyOverride !== undefined,
      notifications: read('notifications'), labels: catalogue('label'), properties: catalogue('property'),
    };
  }

  return {read, runtime, save, saveCatalogue, archive, taskMetadata, nextTaskNumber, backfillTaskNumbers,
    inbox, markInboxRead, snapshot};
}
