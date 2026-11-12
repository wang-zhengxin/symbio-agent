import { choice, fail, string } from './input.js';
import collectorPackage from '../collector/package.json' with {type:'json'};

const loopbackHosts = ['localhost','127.0.0.1','[::1]'];
export const collectorPackageSpec = collectorPackage.name + '@' + collectorPackage.version;

export function collectorCommand(input, allowLanHttp, servesPackage) {
  const address = URL.parse(string(input.address,'采集接收地址',500));
  if (!address || address.username || address.password || address.search || address.hash ||
      !['http:','https:'].includes(address.protocol)) fail('请输入不含凭据、查询参数和锚点的 HTTP(S) 接收地址');
  const loopback = loopbackHosts.includes(address.hostname);
  const allowHttp = address.protocol === 'http:' && !loopback;
  if (allowHttp && !allowLanHttp) fail('直接访问远程接收端需要 HTTPS，或先建立 SSH 转发');
  const shell = choice(input.shell ?? 'sh',['sh','powershell'],'终端类型');
  const quote = value => "'" + value.replaceAll("'",shell === 'powershell' ? "''" : "'\"'\"'") + "'";
  const server = address.href.replace(/\/$/,'');
  const packageSource = servesPackage ? quote(server + '/v1/collector-package.tgz') : collectorPackageSpec;
  const runner = shell === 'powershell' ? 'npx.cmd' : 'npx';
  const executable = `${runner} --yes --registry=https://registry.npmjs.org --package=${packageSource} -- ${collectorPackage.name}`;
  return {
    loopback,
    launch(token) {
      const pipe = shell === 'powershell' ? quote(token) : `printf '%s\\n' ${quote(token)}`;
      return `${pipe} | ${executable} join ${quote(server)}${allowHttp ? ' --allow-http' : ''}`;
    },
    restart: `${executable} run`,
  };
}
