import nodemailer from 'nodemailer';
import { registrationEmail } from './email-verification.js';

export function createMailer(env = process.env) {
  const host = env.OFFICE_SMTP_HOST?.trim();
  const sender = env.OFFICE_SMTP_FROM?.trim();
  if (!host || !sender) return undefined;
  const from = registrationEmail(sender);
  const port = Number(env.OFFICE_SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('OFFICE_SMTP_PORT 无效');
  const secure = port === 465 || env.OFFICE_SMTP_SECURE === '1';
  const user = env.OFFICE_SMTP_USER;
  const pass = env.OFFICE_SMTP_PASS;
  if (Boolean(user) !== Boolean(pass)) throw new Error('OFFICE_SMTP_USER 与 OFFICE_SMTP_PASS 须同时设置');
  const transport = nodemailer.createTransport({host, port, secure, requireTLS:!secure,
    auth:user ? {user, pass} : undefined, connectionTimeout:10_000, greetingTimeout:10_000, socketTimeout:15_000});
  async function send(email, subject, text, messageId) {
    const result = await transport.sendMail({
      from:{name:'Symbio 工作台', address:from},
      to:{address:email, name:''}, subject, text, messageId,
    });
    if (!result.accepted?.length) throw new Error('SMTP 服务未接受邮件');
  }
  return {
    sendCode(email, code, mode) {
      const purpose = mode.startsWith('bind:') ? '绑定邮箱' : '注册';
      return send(email, `Symbio ${purpose}验证码`,
        `你的 Symbio ${purpose}验证码为 ${code}。验证码在 10 分钟内有效，仅可使用一次。`);
    },
    sendMention(email, {task, comment, userId, url}) {
      return send(email, 'Symbio 任务评论提及',
        [`${comment.author} 在「${task.title}」中提及了你。`, comment.text, `打开任务：${url}`].join('\n\n'),
        `<${comment.id}.${userId}@symbio.local>`);
    },
  };
}
