import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { choice, fail, string } from './input.js';
import { createEmailVerification, registrationEmail } from './email-verification.js';

const derive = promisify(scrypt);
const cookieName = 'office_session';
const lifetime = 12 * 60 * 60;
const roles = ['admin', 'member'];
const states = ['pending', 'active', 'disabled'];
const digest = token => createHash('sha256').update(token).digest('hex');
const publicUser = ({id, username, name, role, status, createdAt, version, email, mentionEmail}) =>
  ({id, username, name, role, status, createdAt, version, email, mentionEmail:mentionEmail === true});
const credential = (password, salt) => derive(password, salt, 64, {N:32768, r:8, p:3, maxmem:64 * 1024 * 1024});
const dummySalt = randomBytes(16).toString('hex');

function usernameOf(value) {
  const username = string(value, '用户名', 32).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) fail('用户名须为 3 至 32 位字母、数字、点、下划线或短横线');
  return username;
}

function passwordOf(value, min = 1) {
  if (typeof value !== 'string' || value.length < min || value.length > 128 || !value.trim()) {
    fail(min > 1 ? '密码须为 15 至 128 个字符' : '请输入密码');
  }
  return value;
}

export function sessionCookie(token = '') {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? lifetime : 0}`;
}

export function createAccounts(store, sendRegistrationMail) {
  const {get, put, list, remove, tx, event} = store;
  const users = () => list('user');
  const byName = username => get('user', get('username', username)?.userId);
  const ready = () => Boolean(get('account-config', 'initial'));
  const verification = createEmailVerification(store, sendRegistrationMail);
  const sessionId = cookie => {
    const token = cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? digest(token) : null;
  };
  let attempts = 0, windowEnds = 0, hashing = 0;

  async function protect(work) {
    const now = Date.now();
    if (now >= windowEnds) {
      attempts = 0;
      windowEnds = now + 60_000;
    }
    if (attempts >= 20 || hashing >= 4) fail('账户请求过于频繁，请稍后重试', 429);
    attempts++;
    hashing++;
    try { return await work(); }
    finally { hashing--; }
  }

  async function passwordRecord(password) {
    const salt = randomBytes(16).toString('hex');
    return {salt, hash:(await credential(password, salt)).toString('hex')};
  }

  async function passwordMatches(user, password) {
    const actual = await credential(password, user?.salt ?? dummySalt);
    return timingSafeEqual(actual, user ? Buffer.from(user.hash, 'hex') : Buffer.alloc(64)) && Boolean(user);
  }

  function newSession(user, prior) {
    if (prior) remove('session', prior);
    const token = randomBytes(32).toString('base64url');
    put('session', {id:digest(token), userId:user.id, expiresAt:Date.now() + lifetime * 1000});
    return {token, user:publicUser(user)};
  }

  function current(cookie) {
    const session = get('session', sessionId(cookie));
    if (!session || session.expiresAt <= Date.now()) return null;
    const user = get('user', session.userId);
    return user?.status === 'active' ? publicUser(user) : null;
  }

  function revoke(userId) {
    for (const session of list('session')) {
      if (session.userId === userId) remove('session', session.id);
    }
  }

  function registrationMode(setup) {
    if (setup === ready()) fail(setup ? '工作区已有管理员，请登录或申请加入' : '请先初始化工作区管理员', 409);
    return setup ? 'setup' : 'register';
  }

  function checkEmail(email) {
    if (get('user-email', email)) fail('该邮箱已关联账户，请登录', 409);
  }

  function requestRegistrationCode(input) {
    const mode = registrationMode(choice(input.mode, ['setup', 'register'], '注册方式') === 'setup');
    const email = registrationEmail(input.email);
    checkEmail(email);
    return verification.issue(email, mode);
  }

  function requireSession(cookie) {
    const user = current(cookie);
    if (!user) fail('请先登录', 401);
    return user;
  }

  function bindingEmail(user, value) {
    if (user.email) fail('账户已绑定邮箱', 409);
    const email = registrationEmail(value);
    checkEmail(email);
    return email;
  }

  function requestBindingCode(input, cookie) {
    const user = requireSession(cookie);
    return verification.issue(bindingEmail(user, input.email), 'bind:' + user.id);
  }

  function bindEmail(input, cookie) {
    const result = tx(() => {
      const user = requireSession(cookie);
      const email = bindingEmail(user, input.email);
      const verificationError = verification.consume(email, 'bind:' + user.id, input.code);
      if (verificationError) return {verificationError};
      const updated = put('user', {...get('user', user.id), email, version:user.version + 1});
      put('user-email', {id:email, userId:user.id});
      event('account.email-bound', {name:user.name, userId:user.id});
      return {user:publicUser(updated)};
    });
    if (result.verificationError) fail(result.verificationError);
    return result;
  }

  function setMentionEmail(input, cookie) {
    if (typeof input.enabled !== 'boolean') fail('邮件通知选项无效');
    return tx(() => {
      const user = requireSession(cookie);
      if (!user.email) fail('请先绑定邮箱', 428);
      const updated = put('user', {...get('user', user.id), mentionEmail:input.enabled});
      if (!input.enabled) {
        for (const item of list('mention-email')) {
          if (item.userId === user.id) remove('mention-email', item.id);
        }
      }
      event('account.mention-email', {userId:user.id});
      return {user:publicUser(updated)};
    });
  }

  async function register(input, {setup = false} = {}) {
    const mode = registrationMode(setup);
    if (!verification.available) fail('邮件服务尚未配置，请联系工作台管理员', 503);
    const username = usernameOf(input.username);
    const email = registrationEmail(input.email);
    const name = string(input.name, '显示名称', 80);
    const password = passwordOf(input.password, 15);
    return protect(async () => {
      const secret = await passwordRecord(password);
      const result = tx(() => {
        registrationMode(setup);
        if (byName(username)) fail('用户名已被使用', 409);
        checkEmail(email);
        const verificationError = verification.consume(email, mode, input.code);
        if (verificationError) return {verificationError};
        const user = put('user', {id:randomUUID(), username, name, email, ...secret,
          role:setup ? 'admin' : 'member', status:setup ? 'active' : 'pending', version:1, createdAt:new Date().toISOString()});
        put('username', {id:username, userId:user.id});
        put('user-email', {id:email, userId:user.id});
        if (setup) put('account-config', {id:'initial', userId:user.id});
        event('account.registered', {name:user.name, userId:user.id, status:user.status});
        return setup ? newSession(user) : {user:publicUser(user)};
      });
      if (result.verificationError) fail(result.verificationError);
      return result;
    });
  }

  async function login(input, cookie) {
    const username = usernameOf(input.username);
    const password = passwordOf(input.password);
    return protect(async () => {
      const user = byName(username);
      if (!await passwordMatches(user, password)) fail('用户名或密码错误', 401);
      return tx(() => {
        const latest = get('user', user.id);
        if (latest.hash !== user.hash) fail('用户名或密码错误', 401);
        if (latest.status !== 'active') fail(latest.status === 'pending' ? '账户正在等待管理员审批' : '此账户已停用', 403);
        return newSession(latest, sessionId(cookie));
      });
    });
  }

  function logout(cookie) {
    const id = sessionId(cookie);
    if (id) tx(() => remove('session', id));
  }

  function update(id, input, actor) {
    const role = choice(input.role, roles, '角色');
    const status = choice(input.status, states, '账户状态');
    return tx(() => {
      const admin = get('user', actor.id);
      if (admin?.role !== 'admin' || admin.status !== 'active') fail('需要管理员权限', 403);
      const user = get('user', id);
      if (!user) fail('用户不存在', 404);
      if (input.version !== user.version) fail('账户已被更新，请刷新后重试', 409);
      if (user.role === role && user.status === status) return publicUser(user);
      if (user.id === actor.id) fail('请由其他管理员调整你的账户角色或状态', 409);
      const updated = put('user', {...user, role, status, version:user.version + 1});
      revoke(id);
      event('account.updated', {name:user.name, userId:id, actorId:actor.id, role, status});
      return publicUser(updated);
    });
  }

  async function changePassword(input, cookie) {
    const actor = requireSession(cookie);
    const oldPassword = passwordOf(input.currentPassword);
    const newPassword = passwordOf(input.newPassword, 15);
    if (oldPassword === newPassword) fail('新密码应与当前密码不同');
    return protect(async () => {
      const user = get('user', actor.id);
      if (!await passwordMatches(user, oldPassword)) fail('当前密码错误', 400);
      const secret = await passwordRecord(newPassword);
      return tx(() => {
        const latest = get('user', actor.id);
        if (!current(cookie) || latest.hash !== user.hash) fail('登录状态已变化，请重新登录', 401);
        const updated = put('user', {...latest, ...secret});
        revoke(updated.id);
        return newSession(updated);
      });
    });
  }

  function sweep() {
    const expired = list('session').filter(session => session.expiresAt <= Date.now());
    if (expired.length) tx(() => { for (const session of expired) remove('session', session.id); });
    verification.sweep();
  }

  return {ready, current, register, requestRegistrationCode, requestBindingCode, bindEmail, setMentionEmail,
    emailAvailable:verification.available,
    login, logout, update, changePassword, sweep, list:() => users().map(publicUser)};
}
