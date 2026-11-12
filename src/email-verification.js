import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { fail, string } from './input.js';

const cooldown = 60_000;
const validity = 10 * 60_000;
const invalidCode = '验证码错误或已过期，请检查后重试';

export function registrationEmail(value) {
  const email = string(value, '邮箱', 254).toLowerCase();
  const [local, domain, extra] = email.split('@');
  if (extra !== undefined || !/^[a-z0-9_!#$%&'*+/=?^`{|}~-]+(?:\.[a-z0-9_!#$%&'*+/=?^`{|}~-]+)*$/.test(local) ||
      local.length > 64 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain ?? '')) {
    fail('请输入有效的邮箱地址');
  }
  return email;
}

export function createEmailVerification(store, send, now = Date.now) {
  const secret = randomBytes(32);
  const hash = value => createHmac('sha256', secret).update(value).digest('hex');
  const recordId = email => hash(email);
  const digest = (email, mode, code) => hash(JSON.stringify([email, mode, code]));
  const sending = new Set();
  let sends = 0, windowEnds = 0;

  async function issue(email, mode) {
    if (!send) fail('邮件服务尚未配置，请联系工作台管理员', 503);
    const time = now();
    const id = recordId(email);
    const previous = store.get('registration-code', id);
    if (sending.has(id) || previous?.resendAt > time) fail('请稍后再获取验证码', 429);
    if (time >= windowEnds) {
      windowEnds = time + cooldown;
      sends = 0;
    }
    if (sends >= 15 || sending.size >= 4) fail('发送请求过于频繁，请稍后重试', 429);
    sends++;
    sending.add(id);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    try {
      await send(email, code, mode);
    } catch {
      fail('验证码邮件发送失败，请稍后重试', 503);
    } finally {
      sending.delete(id);
    }
    const sentAt = now();
    store.tx(() => {
      store.put('registration-code', {id, mode, hash:digest(email, mode, code), attemptsRemaining:5,
        resendAt:sentAt + cooldown, expiresAt:sentAt + validity});
    });
    return {retryAfter:cooldown / 1000};
  }

  // Consume the code in the same transaction as registration or email binding.
  function consume(email, mode, code) {
    const id = recordId(email);
    const record = store.get('registration-code', id);
    if (!record || record.mode !== mode || record.expiresAt <= now()) return invalidCode;
    if (!record.attemptsRemaining) return '验证码尝试次数已用完，请重新获取';
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return '请输入六位验证码';
    if (!timingSafeEqual(Buffer.from(record.hash, 'hex'), Buffer.from(digest(email, mode, code), 'hex'))) {
      store.put('registration-code', {...record, attemptsRemaining:record.attemptsRemaining - 1});
      return invalidCode;
    }
    store.remove('registration-code', id);
    return null;
  }

  function sweep() {
    const expired = store.list('registration-code').filter(record => record.expiresAt <= now());
    if (expired.length) store.tx(() => {
      for (const record of expired) store.remove('registration-code', record.id);
    });
  }

  return {issue, consume, sweep, available:Boolean(send)};
}
