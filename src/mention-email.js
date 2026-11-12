export const receivesMentionEmail = user =>
  user?.status === 'active' && Boolean(user.email) && user.mentionEmail === true;

export function createMentionEmailDelivery(store, send, baseUrl) {
  const retryDelays = [60_000, 300_000];
  let running;
  let stopped = false;

  async function deliver() {
    const due = store.list('mention-email').filter(item => item.nextAttemptAt <= Date.now());
    for (const item of due) {
      if (stopped) break;
      if (!store.get('mention-email', item.id)) continue;
      const user = store.get('user', item.userId);
      const task = store.get('task', item.taskId);
      const comment = store.get('comment', item.commentId);
      let failed = false;
      if (receivesMentionEmail(user) && task && comment) {
        try {
          const url = new URL('/office', baseUrl);
          url.hash = 'tasks/all/' + task.id + '/' + comment.id;
          await send(user.email, {userId:user.id, task, comment, url:url.href});
        } catch {
          failed = true;
        }
      }
      store.tx(() => {
        if (!store.get('mention-email', item.id)) return;
        const delay = retryDelays[item.attempts];
        if (failed && delay) {
          store.put('mention-email', {...item, attempts:item.attempts + 1, nextAttemptAt:Date.now() + delay});
        } else {
          store.remove('mention-email', item.id);
          if (failed) console.warn('一封 @ 提及邮件重试后仍未发送成功。');
        }
      });
    }
  }

  function wake() {
    if (!send || stopped || running) return running;
    running = deliver().catch(() => console.error('@ 提及邮件队列处理失败。')).finally(() => { running = undefined; });
    return running;
  }

  return {wake, close() { stopped = true; return running; }};
}
