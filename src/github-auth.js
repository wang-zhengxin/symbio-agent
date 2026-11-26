import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fail } from './input.js';

const exec = promisify(execFile);
const api = 'https://api.github.com';

// Keep GitHub credentials in the service process. Do not inherit them in runners.
export function runnerEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    !/^(?:GH_|GITHUB_|OFFICE_GH_|OFFICE_GITHUB_|GIT_CONFIG(?:_|$)|GIT_ASKPASS$|SSH_ASKPASS$|SSH_AUTH_SOCK$)/i.test(key)));
}

async function ghToken(signal) {
  const override = process.env.OFFICE_GH_BIN;
  const candidates = override ? [override] : ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh'];
  for (const executable of candidates) {
    try {
      const {stdout} = await exec(executable, ['auth', 'token', '--hostname', 'github.com'], {
        env:{...process.env, GH_PROMPT_DISABLED:'1', GH_DEBUG:'', DEBUG:''},
        signal, timeout:10_000, maxBuffer:8192, windowsHide:true,
      });
      const token = stdout.trim();
      if (/^[A-Za-z0-9_.-]{16,4096}$/.test(token)) return token;
      fail('本机 gh 未返回可用凭据，请检查 GitHub 登录', 409);
    } catch (error) {
      signal?.throwIfAborted();
      if (error.code === 'ENOENT') continue;
      // exec errors retain stdout and stderr. Never forward them to the API or logs.
      fail('无法读取服务账号的 gh 登录，请确认已登录 github.com', 409);
    }
  }
  fail('工作台未找到 GitHub CLI，请安装 gh 或配置 OFFICE_GH_BIN', 409);
}

async function responseJson(response) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.byteLength;
    if (bytes > 2_000_000) fail('GitHub 返回的数据超过大小限制', 502);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    fail('GitHub 返回了无法解析的数据', 502);
  }
}

function checkResponse(response) {
  const {status, headers} = response;
  if (response.ok) return;
  if (status >= 300 && status < 400) fail('GitHub 仓库地址已变更，请管理员核对授权范围', 409);
  if (status === 401) fail('GitHub 登录失效，请重新登录 gh 并验证连接', 409);
  if (status === 429 || headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after')) {
    fail('GitHub API 暂时限流，请稍后重试', 429);
  }
  if (status === 403) fail(headers.has('x-github-sso')
    ? 'GitHub 组织要求为当前 gh 登录凭据完成 SSO 授权'
    : 'GitHub 拒绝了该操作，请检查账号权限、凭据权限和仓库规则', 403);
  if (status === 404) fail('GitHub 资源不存在或当前账号无权访问', 404);
  if ([405, 409, 422].includes(status)) fail('GitHub 未接受该操作，请检查当前分支、资源状态或仓库规则', 409);
  fail('GitHub API 暂时无法完成请求', 502);
}

// Each operation uses one credential for identity verification and GitHub requests.
// An alternate provider can implement the same open/request interface.
export function createGhSession({fetcher = globalThis.fetch, tokenFor = ghToken} = {}) {
  return async function open(signal) {
    const token = await tokenFor(signal);
    async function request(path, {method = 'GET', body} = {}) {
      signal?.throwIfAborted();
      const url = new URL(path, api);
      if (url.origin !== api) fail('GitHub API 地址无效', 502);
      const timeout = AbortSignal.timeout(15_000);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response;
      try {
        response = await fetcher(url, {
          method, redirect:'manual', signal:requestSignal,
          headers:{Accept:'application/vnd.github+json', Authorization:'Bearer ' + token,
            'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'Symbio-Agent-Office',
            ...(body === undefined ? {} : {'Content-Type':'application/json'})},
          body:body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        signal?.throwIfAborted();
        fail('无法连接 GitHub API，请检查工作台服务的网络', 502);
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        checkResponse(response);
      }
      try {
        return await responseJson(response);
      } catch (error) {
        signal?.throwIfAborted();
        if (error.status) throw error;
        fail('读取 GitHub 响应失败，请检查操作结果后再重试', 502);
      }
    }
    const {id, login} = await request('/user');
    if (!Number.isSafeInteger(id) || id <= 0 || typeof login !== 'string' || !/^[\w-]{1,100}$/.test(login)) {
      fail('GitHub 未返回可识别的账号', 502);
    }
    return {account:{id:String(id), login}, request};
  };
}
