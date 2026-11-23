import { fail } from './input.js';

// Keep the public collector API separate from administrator/browser routes.
export function createCollectorApi(discovery, body) {
  const attempts = new Map();
  let windowStart = 0;
  let total = 0;
  return async function handle(req) {
    if (req.headers.origin) fail('采集接口仅供客户端使用', 403);
    const url = new URL(req.url, 'http://collector.local');
    if (req.method === 'POST' && url.pathname === '/v1/pair') {
      const stamp = Date.now();
      if (stamp - windowStart >= 60_000) { attempts.clear(); total = 0; windowStart = stamp; }
      const ip = req.socket.remoteAddress;
      const count = attempts.get(ip) ?? 0;
      if (count >= 10 || total >= 300) fail('配对尝试过多，请一分钟后重试', 429);
      attempts.set(ip, count + 1);
      total++;
      return discovery.exchangeCode(await body(req));
    }
    const machineId = discovery.authenticate(req.headers.authorization);
    if (req.method === 'POST' && url.pathname === '/v1/report') return discovery.receive(machineId, await body(req));
    if (req.method === 'GET' && url.pathname === '/v1/status') return discovery.clientStatus(machineId);
    if (req.method === 'GET' && url.pathname === '/v1/tasks') {
      const filters = Object.fromEntries(['status', 'project', 'limit', 'offset']
        .filter(key => url.searchParams.has(key)).map(key => [key, url.searchParams.get(key)]));
      return discovery.readTasks(machineId, filters);
    }
    const task = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
    if (req.method === 'GET' && task) {
      let ref;
      try { ref = decodeURIComponent(task[1]); } catch { fail('任务编号无效'); }
      return discovery.readTasks(machineId, {ref});
    }
    fail('未找到该地址', 404);
  };
}
