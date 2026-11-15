import { isAbsolute } from 'node:path';
import { choice, fail, string } from './input.js';

const toolName = /^[a-zA-Z0-9_.-]{1,128}$/;

export function mcpFields(input, previous) {
  const transport = choice(input.transport, ['http', 'stdio'], 'MCP 连接方式');
  const enabled = input.enabled ?? previous?.enabled ?? true;
  if (typeof enabled !== 'boolean') fail('MCP 启用状态无效');
  const source = string(input.tools, '允许的工具', 4000);
  const tools = [...new Set(source.split(/[\s,，]+/).filter(Boolean))];
  if (!tools.length || tools.length > 40 || !tools.every(name => toolName.test(name))) fail('请填写 1 至 40 个准确的工具名称');
  const fields = {transport, enabled, tools};
  if (transport === 'stdio') {
    const command = string(input.command, '命令', 1024);
    if (!isAbsolute(command)) fail('stdio 命令必须是可执行文件的绝对路径');
    let args;
    try { args = JSON.parse(string(input.args ?? '[]', '命令参数', 8000)); }
    catch { fail('命令参数须为 JSON 字符串数组'); }
    if (!Array.isArray(args) || args.length > 40 || !args.every(arg => typeof arg === 'string' && !arg.includes('\0'))) {
      fail('命令参数须为 JSON 字符串数组，最多 40 项');
    }
    return {...fields, command, args};
  }

  const address = string(input.url, 'MCP 地址', 2048);
  let url;
  try { url = new URL(address); } catch { fail('MCP 地址无效'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
    url.username || url.password || url.search || url.hash) {
    fail('请填写 HTTPS 或本机 HTTP 地址，鉴权请使用环境变量');
  }
  const tokenEnv = string(input.tokenEnv, 'Bearer Token 环境变量', 120, true);
  if (tokenEnv && !/^OFFICE_MCP_[A-Z0-9_]+$/.test(tokenEnv)) fail('环境变量名须以 OFFICE_MCP_ 开头');
  return {...fields, url:url.href, tokenEnv};
}

export function runtimeMcpConfig(servers, runtime) {
  return Object.fromEntries(servers.map(server => {
    const key = 'symbio_' + server.id.replaceAll('-', '');
    const connection = server.transport === 'stdio'
      ? {command:server.command, args:server.args}
      : {url:server.url};
    if (server.tokenEnv) {
      if (!process.env[server.tokenEnv]?.trim()) throw new Error('缺少 MCP 环境变量 ' + server.tokenEnv);
      if (runtime === 'pi') connection.headers = {Authorization:'Bearer ${' + server.tokenEnv + '}'};
      else connection.bearer_token_env_var = server.tokenEnv;
    }
    return [key, runtime === 'pi' ? {
      ...connection, exposure:'hidden',
      toolExposure:Object.fromEntries(server.tools.map(name => [name, 'direct'])),
    } : {...connection, enabled:true, enabled_tools:server.tools}];
  }));
}
