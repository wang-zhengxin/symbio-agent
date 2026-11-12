import { randomUUID } from 'node:crypto';
import { fail, ids, string } from './input.js';
import { receivesMentionEmail } from './mention-email.js';

export function createTaskDiscussion(store, settings, enqueueReply) {
  const {get, list, put, event} = store;
  const forTask = taskId => list('comment').filter(comment => comment.taskId === taskId);
  const operator = () => ({key:'operator:local', name:settings.read('workspace').operator, kind:'human'});
  const accountPerson = user => ({key:'user:' + user.id, name:user.name, kind:'human'});

  function people() {
    const accounts = list('user').filter(user => user.status === 'active').map(accountPerson);
    const members = accounts.length ? accounts : [operator()];
    return [...members, ...['human', 'agent'].flatMap(kind => list(kind)
      .filter(person => kind === 'human' ? !members.some(member => member.name === person.name) : person.runtime !== 'observed')
      .map(({id, name}) => ({key:kind + ':' + id, name, kind})))];
  }

  function context(taskId, limit = 8) {
    return forTask(taskId).slice(-limit).map(({id, author, text, replyToId}) =>
      ({id, author, text:text.slice(0, 1200), replyToId}));
  }

  function post(task, input, run, isResponse = false, actor) {
    if (input.emailMentions !== undefined && typeof input.emailMentions !== 'boolean') fail('邮件通知选项无效');
    const author = run ? {key:'agent:' + run.agentId, name:run.agent.name, kind:'agent'} : actor ? accountPerson(actor) : operator();
    const text = string(input.text, '评论', 4000);
    const parent = input.replyToId ? get('comment', input.replyToId) : null;
    if (input.replyToId && parent?.taskId !== task.id) fail('只能回复当前任务的评论', 404);
    const roster = people();
    const lookup = new Map(roster.map(person => [person.key, person]));
    const owner = get('user', get('account-config', 'initial')?.userId);
    const local = owner?.status === 'active' && owner.role === 'admin' ? owner
      : list('user').find(user => user.status === 'active' && user.role === 'admin');
    const legacyOperator = operator();
    lookup.set('operator:local', local ? accountPerson(local) : legacyOperator);
    const keys = ids(input.mentions ?? [], '@ 对象', 8);
    const named = isResponse ? [] : text.matchAll(/@(?:\[([^\]\n]+)\]|([^\s@，。！？；：、,.!?;:()]+))/gu);
    for (const match of named) {
      if (keys.length >= 8) break;
      const name = match[1] ?? match[2];
      const matches = roster.filter(person => person.name === name);
      const key = matches.length === 1 ? matches[0].key
        : !matches.length && name === legacyOperator.name ? legacyOperator.key : null;
      if (key && !keys.includes(key)) keys.push(key);
    }
    const mentions = [...new Map(keys.map(key => {
      if (!lookup.has(key)) fail('@ 对象不存在或无法接收消息');
      const person = lookup.get(key);
      return [person.key, person];
    })).values()].filter(person => person.key !== author.key);
    const recipient = isResponse && parent?.authorKind !== 'agent' ? lookup.get(parent?.authorKey ?? 'operator:local') : null;
    if (recipient && !mentions.some(person => person.key === recipient.key)) mentions.push(recipient);
    const comment = put('comment', {id:randomUUID(), taskId:task.id, author:author.name, authorKind:author.kind,
      authorKey:author.key, ...(actor ? {authorUsername:actor.username} : {}),
      text, replyToId:parent?.id ?? null, threadId:parent?.threadId ?? parent?.id ?? null,
      mentions, createdAt:new Date().toISOString(), responseRunIds:[]});
    const refs = {id:run?.id, taskId:task.id, agentId:run?.agentId};
    event('task.comment', {id:comment.id}, refs);
    const humans = mentions.filter(person => person.kind === 'human');
    if (humans.length) event('task.mention', {id:comment.id, author:author.name,
      recipients:humans.map(person => person.name), recipientKeys:humans.map(person => person.key)}, refs);
    if (!isResponse) {
      if (input.emailMentions !== false) {
        for (const person of humans) {
          if (!person.key.startsWith('user:')) continue;
          const userId = person.key.slice(5);
          if (receivesMentionEmail(get('user', userId))) {
            put('mention-email', {id:comment.id + ':' + userId, commentId:comment.id, taskId:task.id,
              userId, attempts:0, nextAttemptAt:Date.now()});
          }
        }
      }
      comment.responseRunIds = mentions.filter(person => person.kind === 'agent')
        .map(person => enqueueReply(task, comment, get('agent', person.key.slice(6))).id);
      put('comment', comment);
    }
    return comment;
  }

  return {forTask, context, people, post};
}
