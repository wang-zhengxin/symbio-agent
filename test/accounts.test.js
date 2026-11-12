import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createAccounts, sessionCookie } from '../src/accounts.js';
import { createEmailVerification } from '../src/email-verification.js';
import { openStore } from '../src/store.js';

test('Concurrent setup creates one administrator, and suspension revokes existing member sessions', async () => {
  const store = openStore(':memory:');
  try {
    const sent = new Map();
    const accounts = createAccounts(store, async (email, code) => sent.set(email, code));
    const password = 'test-only strong password';
    const initial = ['first', 'second'].map(username => ({username, name:username, password, email:username + '@example.com'}));
    await Promise.all(initial.map(({email}) => accounts.requestRegistrationCode({mode:'setup', email})));
    const attempts = await Promise.allSettled(initial.map(input =>
      accounts.register({...input, code:sent.get(input.email)}, {setup:true})));
    const [success] = attempts.filter(result => result.status === 'fulfilled');
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.find(result => result.status === 'rejected').reason.status, 409);
    const admin = accounts.current(sessionCookie(success.value.token));
    assert.equal(admin.role, 'admin');
    assert.ok(!store.get('session', success.value.token));
    const email = 'worker@example.com';
    await accounts.requestRegistrationCode({mode:'register', email});
    const input = {username:'worker', name:'成员', email, password, code:sent.get(email)};
    const otherAddress = 'other@example.com';
    await assert.rejects(accounts.register({...input, email:otherAddress}), /验证码/);
    const pending = (await accounts.register({...input, email:email.toUpperCase()})).user;
    assert.equal(pending.email, email);
    await assert.rejects(accounts.register({...input, username:'different'}), {status:409});
    await assert.rejects(accounts.login(input), {status:403});
    const active = accounts.update(pending.id, {version:pending.version, role:'member', status:'active'}, admin);
    await assert.rejects(accounts.register({...input, username:'WORKER'}), {status:409});
    const session = await accounts.login(input);
    assert.equal(accounts.current(sessionCookie(session.token)).id, active.id);
    assert.throws(() => accounts.update(active.id, {version:pending.version, role:'admin', status:'active'}, admin), {status:409});
    accounts.update(active.id, {version:active.version, role:'member', status:'disabled'}, admin);
    assert.equal(accounts.current(sessionCookie(session.token)), null);
    assert.throws(() => accounts.update(admin.id, {version:admin.version, role:'member', status:'active'}, admin), {status:409});
  } finally {
    store.close();
  }
});

test('Registration codes enforce cooldown, attempt limits, expiry and one-time consumption', async () => {
  const store = openStore(':memory:');
  try {
    let time = 1_000_000;
    let failDelivery = true;
    let code;
    const verification = createEmailVerification(store, async (_email, value) => {
      if (failDelivery) throw new Error('Simulated SMTP failure');
      code = value;
    }, () => time);
    const email = 'user@example.com';
    await assert.rejects(verification.issue(email, 'register'), {status:503});
    assert.equal(store.list('registration-code').length, 0);
    failDelivery = false;
    await verification.issue(email, 'register');
    await assert.rejects(verification.issue(email, 'register'), {status:429});
    const consume = (value, mode = 'register') => store.tx(() => verification.consume(email, mode, value));
    assert.match(consume(code, 'setup'), /验证码错误/);
    const wrong = code === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 5; attempt++) assert.match(consume(wrong), /验证码错误/);
    assert.match(consume(code), /次数已用完/);
    time += 60_000;
    await verification.issue(email, 'register');
    time += 600_000;
    assert.match(consume(code), /已过期/);
    await verification.issue(email, 'register');
    assert.equal(consume(code), null);
    assert.match(consume(code), /验证码错误/);
  } finally {
    store.close();
  }
});

test('Legacy accounts bind a unique email with an account-scoped code before opting in', async t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  function legacyUser(id, marker) {
    const token = marker.repeat(43);
    store.tx(() => {
      store.put('user', {id, name:id, status:'active', version:1});
      store.put('session', {id:createHash('sha256').update(token).digest('hex'), userId:id, expiresAt:Date.now() + 60_000});
    });
    return sessionCookie(token);
  }
  const first = legacyUser('first', 'a');
  const second = legacyUser('second', 'b');
  let code;
  const accounts = createAccounts(store, async (_email, value) => { code = value; });
  const email = 'member@example.com';
  assert.throws(() => accounts.setMentionEmail({enabled:true}, first), {status:428});
  await accounts.requestBindingCode({email}, first);
  assert.throws(() => accounts.bindEmail({email, code}, second), /验证码错误/);
  const {user} = accounts.bindEmail({email:email.toUpperCase(), code}, first);
  assert.equal(user.email, email);
  assert.equal(user.mentionEmail, false);
  assert.equal(accounts.current(first).email, email);
  assert.throws(() => accounts.bindEmail({email, code}, first), {status:409});
  assert.throws(() => accounts.requestBindingCode({email}, second), {status:409});
  assert.equal(accounts.setMentionEmail({enabled:true}, first).user.mentionEmail, true);
  store.tx(() => store.put('mention-email', {id:'queued', userId:user.id}));
  assert.equal(accounts.setMentionEmail({enabled:false}, first).user.mentionEmail, false);
  assert.equal(store.list('mention-email').length, 0);
});
