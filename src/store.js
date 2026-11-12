import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';

export const active = ['queued', 'running', 'stopping'];
export const live = ['running', 'stopping'];

export function openStore(path) {
  const db = new DatabaseSync(path);
  const stream = new EventEmitter();
  stream.setMaxListeners(0);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS records (
      kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY(kind, id)
    );
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT NOT NULL, type TEXT NOT NULL,
      run_id TEXT, task_id TEXT, agent_id TEXT, conversation_id TEXT,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS run_events ON events(run_id, seq);
    CREATE INDEX IF NOT EXISTS run_event_types ON events(run_id, type, seq);
  `);
  const byId = db.prepare('SELECT data FROM records WHERE kind = ? AND id = ?');
  const byKind = db.prepare('SELECT data FROM records WHERE kind = ? ORDER BY rowid');
  const upsert = db.prepare(`INSERT INTO records VALUES (?, ?, ?)
    ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data`);
  const remove = db.prepare('DELETE FROM records WHERE kind = ? AND id = ?');
  const append = db.prepare('INSERT INTO events(time,type,run_id,task_id,agent_id,conversation_id,payload) VALUES (?,?,?,?,?,?,?)');
  const tail = db.prepare('SELECT COALESCE(MAX(seq),0) AS cursor FROM events');
  const since = db.prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?');
  const timeline = db.prepare('SELECT * FROM events WHERE run_id = ? ORDER BY seq DESC LIMIT 300');
  const milestoneTypes = ['runtime.input', 'runtime.first_output', 'runtime.finished', 'message.delta', 'message.final'];
  const firstRunEvent = db.prepare('SELECT time FROM events WHERE run_id = ? AND type = ? ORDER BY seq LIMIT 1');
  const firstTurn = db.prepare(`SELECT time FROM events WHERE run_id = ? AND type = 'run.activity' AND (
    json_extract(payload, '$.phase') = 'turn_started'
    OR json_extract(payload, '$.label') IN ('等待模型响应', '等待 Pi 模型响应')
  ) ORDER BY seq LIMIT 1`);
  const runTools = db.prepare(`SELECT time, type, payload FROM events WHERE run_id = ?
    AND type IN ('tool.started', 'tool.completed', 'tool.failed') ORDER BY seq DESC LIMIT 301`);
  const notificationFilter = `type IN (SELECT value FROM json_each(?))
    AND (type <> 'task.status' OR json_extract(payload, '$.status') = 'review')
    AND (type <> 'machine.status' OR json_extract(payload, '$.status') = 'offline')
    AND (type <> 'task.mention' OR :recipient IS NULL
      OR :recipient IN (SELECT value FROM json_each(payload, '$.recipientKeys'))
      OR (:legacy = 1 AND NOT EXISTS (
        SELECT 1 FROM json_each(payload, '$.recipientKeys') WHERE value LIKE 'user:%'
      )))`;
  const notifications = db.prepare(`SELECT * FROM events WHERE ${notificationFilter} ORDER BY seq DESC LIMIT ?`);
  const unread = db.prepare(`SELECT COUNT(*) AS total FROM events WHERE ${notificationFilter} AND seq > ?`);
  const audit = db.prepare(`SELECT * FROM events WHERE type IN (
    'settings.updated', 'catalogue.saved', 'catalogue.archived', 'agent.saved', 'team.saved',
    'skill.saved', 'machine.paired', 'machine.revoked', 'candidate.reviewed',
    'candidate.approved', 'candidate.dismissed', 'budget.updated', 'agent.dispatch',
    'human.saved', 'schedule.saved', 'layout.saved', 'layout.published',
    'account.registered', 'account.updated', 'account.email-bound'
  ) ORDER BY seq DESC LIMIT 100`);
  const officeActivity = db.prepare(`SELECT * FROM events WHERE
    type IN ('run.started', 'run.failed', 'run.interrupted', 'task.comment', 'candidate.reviewed',
      'candidate.approved', 'conversation.started', 'conversation.completed', 'machine.status',
      'layout.published')
    OR (type = 'task.status' AND json_extract(payload, '$.status') IN ('review', 'done'))
    ORDER BY seq DESC LIMIT 60`);
  const completions = db.prepare(`SELECT task_id, time FROM events WHERE
    time >= ? AND type = 'task.status' AND json_extract(payload, '$.status') = 'done'
    ORDER BY seq DESC`);
  const decode = ({payload, ...row}) => ({...row, payload: JSON.parse(payload)});
  let pending;
  return {
    stream,
    get(kind, id) {
      if (typeof id !== 'string') return undefined;
      const row = byId.get(kind, id);
      return row && JSON.parse(row.data);
    },
    list: kind => byKind.all(kind).map(row => JSON.parse(row.data)),
    put(kind, record) {
      if (!pending) throw new Error('Write outside transaction');
      upsert.run(kind, record.id, JSON.stringify(record));
      return record;
    },
    remove(kind, id) {
      if (!pending) throw new Error('Write outside transaction');
      remove.run(kind, id);
    },
    event(type, payload, refs = {}) {
      if (!pending) throw new Error('Event outside transaction');
      const time = new Date().toISOString();
      const {id: run_id = null, taskId: task_id = null, agentId: agent_id = null,
        conversationId: conversation_id = null} = refs;
      const {lastInsertRowid: seq} = append.run(time, type, run_id, task_id, agent_id, conversation_id, JSON.stringify(payload));
      pending.push({seq, time, type, run_id, task_id, agent_id, conversation_id, payload});
    },
    tx(fn) {
      db.exec('BEGIN IMMEDIATE');
      pending = [];
      let result;
      let committed = false;
      try {
        result = fn();
        db.exec('COMMIT');
        committed = true;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        const events = pending;
        pending = undefined;
        if (committed) {
          for (const event of events) stream.emit('event', event);
        }
      }
      return result;
    },
    cursor: () => tail.get().cursor,
    since: (cursor, limit = 200) => since.all(cursor, limit).map(decode),
    timeline: id => timeline.all(id).reverse().map(decode),
    runObservations(id) {
      const milestones = Object.fromEntries(milestoneTypes.map(type => [type, firstRunEvent.get(id, type)?.time]));
      milestones['run.activity'] = firstTurn.get(id)?.time;
      return {milestones, tools: runTools.all(id).reverse().map(decode)};
    },
    recentMatching: (types, limit, scope = {recipient:null, legacy:1}) => notifications.all(scope, JSON.stringify(types), limit).map(decode),
    countMatching: (types, cursor, scope = {recipient:null, legacy:1}) => unread.get(scope, JSON.stringify(types), cursor).total,
    audit: () => audit.all().map(decode),
    overview: () => ({
      activity: officeActivity.all().map(decode),
      completions: completions.all(new Date(Date.now() - 4 * 86_400_000).toISOString()),
    }),
    close: () => db.close(),
  };
}
