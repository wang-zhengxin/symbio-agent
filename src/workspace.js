import { randomUUID } from 'node:crypto';
import { choice, fail, integer, string } from './input.js';
import { avatarIds } from '../public/office-avatars.js';
import { assignWorkstation, workstationCount } from './workstations.js';

export const zoneTypes = ['work', 'meeting', 'ai', 'lounge'];
const templates = ['open', 'delivery', 'distributed'];
const widgetKeys = ['metrics', 'activity', 'attention'];
const dateNow = () => new Date().toISOString();

function initialLayout() {
  return {title: '1F 协作空间', template: 'open', widgets: {metrics: true, activity: true, attention: true},
    zones: [
      {id: 'work', type: 'work', name: '研发协作区', capacity: 20, x: 9.8, y: 44},
      {id: 'meeting', type: 'meeting', name: '评审会议室', capacity: 8, x: 45.5, y: 14.3},
      {id: 'ai', type: 'ai', name: 'AI 运行区', capacity: 20, x: 68.5, y: 52.6},
      {id: 'lounge', type: 'lounge', name: '休息区', capacity: 6, x: 37, y: 73},
    ].map(zone => ({...zone, teamId: null, visible: true, autoAssign: true}))};
}

function dateOnly(value) {
  const input = string(value, '日期', 10, true);
  if (!input) return '';
  const parsed = new Date(input + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || Number.isNaN(parsed.valueOf()) ||
      parsed.toISOString().slice(0, 10) !== input) fail('日期无效');
  return input;
}

export function projectFields(input, before) {
  const owner = input.owner === undefined ? before?.owner ?? '' : string(input.owner, '负责人', 100, true);
  const dueDate = input.dueDate === undefined ? before?.dueDate ?? '' : dateOnly(input.dueDate);
  const repositoryUrl = input.repositoryUrl === undefined ? before?.repositoryUrl ?? '' :
    string(input.repositoryUrl, 'Git 仓库地址', 500, true);
  if (repositoryUrl) {
    const url = URL.parse(repositoryUrl);
    if (url?.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      fail('Git 仓库地址须为不含凭据的 HTTPS 地址');
    }
  }
  return {owner, dueDate, repositoryUrl};
}

export function createWorkspace(store) {
  const {get, put, list, tx, event} = store;
  const lookup = (kind, id, label) => {
    const row = get(kind, id);
    if (!row) fail(label + '不存在', 404);
    return row;
  };

  function saveHuman(input) {
    const before = input.id ? lookup('human', input.id, '员工') : null;
    const teamId = input.teamId || null;
    if (teamId) lookup('team', teamId, '小组');
    const name = string(input.name, '员工姓名', 80);
    const title = string(input.title, '岗位', 80);
    const email = string(input.email, '邮箱', 120, true);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('邮箱格式无效');
    const availability = choice(input.availability ?? 'offline', ['online', 'offline'], '可用状态');
    return tx(() => {
      const avatarId = choice(input.avatarId ?? before?.avatarId ?? 'auto', avatarIds, '人物形象');
      const person = put('human', {id: before?.id ?? randomUUID(), name, title, email, teamId, availability, avatarId,
        number: before?.number ?? list('human').length + 1, seatIndex:assignWorkstation(store, before)});
      event('human.saved', {id: person.id, name});
      return person;
    });
  }

  function saveSchedule(input) {
    const before = input.id ? lookup('schedule', input.id, '日程') : null;
    const title = string(input.title, '日程名称', 100);
    const date = new Date(string(input.startAt, '开始时间', 35));
    if (Number.isNaN(date.valueOf())) fail('开始时间无效');
    const participants = string(input.participants, '参与者', 500, true);
    return tx(() => {
      const row = put('schedule', {id: before?.id ?? randomUUID(), title, participants, startAt: date.toISOString()});
      event('schedule.saved', {id: row.id, title});
      return row;
    });
  }

  function layout() {
    return get('setting', 'layout') ?? {revision: 0, draft: initialLayout(), published: null, savedAt: null};
  }

  function saveLayout(input, publish) {
    const current = layout();
    if (input.revision !== current.revision) fail('布局已在其他页面更新，请重新加载', 409);
    const {draft} = input;
    if (!draft || !Array.isArray(draft.zones) || !draft.zones.length || draft.zones.length > 16) fail('空间应有 1 至 16 个区域');
    const ids = new Set();
    const zones = draft.zones.map(zone => {
      if (!zone || typeof zone !== 'object') fail('区域无效');
      const id = string(zone.id, '区域标识', 48);
      if (!/^[a-z0-9-]+$/.test(id) || ids.has(id)) fail('区域标识重复或无效');
      ids.add(id);
      const teamId = zone.teamId || null;
      if (teamId) lookup('team', teamId, '团队');
      if (![zone.x, zone.y].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) fail('区域位置超出画布');
      return {id, teamId, x: zone.x, y: zone.y, name: string(zone.name, '区域名称', 36),
        type: choice(zone.type, zoneTypes, '区域类型'), capacity: integer(zone.capacity, '容量', 1, 500),
        visible: zone.visible === true, autoAssign: zone.autoAssign === true};
    });
    const value = {title: string(draft.title, '空间名称', 50), template: choice(draft.template, templates, '模板'),
      widgets: Object.fromEntries(widgetKeys.map(key => [key, draft.widgets?.[key] !== false])), zones};
    const savedAt = dateNow();
    return tx(() => {
      const updated = put('setting', {id: 'layout', revision: current.revision + 1, draft: value,
        published: publish ? value : current.published, savedAt, publishedAt: publish ? savedAt : current.publishedAt});
      event(publish ? 'layout.published' : 'layout.saved', {name: value.title});
      return updated;
    });
  }

  return {saveHuman, saveSchedule, saveLayout,
    snapshot: () => ({humans: list('human'), schedules: list('schedule'), layout: layout(), workstationCount:workstationCount(store)})};
}
