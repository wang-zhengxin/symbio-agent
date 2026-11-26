import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {bundledCollectorPackage} from '../src/collector-package.js';
import {openStore} from '../src/store.js';
import {createDiscovery} from '../src/discovery.js';
import {createCollectorApi} from '../src/collector-api.js';
import {collectorCommand} from '../src/collector-command.js';
const exec=promisify(execFile);

test('Bundled npm archive contains only the public package manifest and standalone collector',()=>{
  const tar=gunzipSync(bundledCollectorPackage());
  const entries=[];
  for(let offset=0;tar[offset];){
    const name=tar.subarray(offset,offset+100).toString().split('\0')[0];
    const size=parseInt(tar.subarray(offset+124,offset+136).toString().split('\0')[0],8);
    entries.push(name);offset+=512+Math.ceil(size/512)*512;
  }
  assert.deepEqual(entries,['package/package.json','package/office-collector.mjs']);
});

test('Installed symbio commands and legacy alias share login, reporting and configuration',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'collector-package-'));
  const store=openStore(':memory:');const discovery=createDiscovery(store);
  const archive=bundledCollectorPackage();
  const api=createCollectorApi(discovery,async req=>{let raw='';for await(const part of req)raw+=part;return JSON.parse(raw);});
  const server=createServer(async(req,res)=>{
    try {
      if(req.url==='/v1/collector-package.tgz'){res.writeHead(200,{'Content-Type':'application/gzip'});return res.end(archive);}
      const result=await api(req);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
    } catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
  });
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();await rm(dir,{recursive:true,force:true});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address='http://127.0.0.1:'+server.address().port;
  const commands=collectorCommand({address},false,true);
  assert.ok(commands.install.includes(address+'/v1/collector-package.tgz'));
  await exec(process.platform==='win32'?'npm.cmd':'npm',['install','--global','--prefix',join(dir,'prefix'),
    '--cache',join(dir,'cache'),'--ignore-scripts','--no-audit','--no-fund',address+'/v1/collector-package.tgz'],{timeout:30000});
  const entry=process.platform==='win32'?join(dir,'prefix/node_modules/symbio-agent-collector/office-collector.mjs')
    :join(dir,'prefix/lib/node_modules/symbio-agent-collector/office-collector.mjs');
  const binDir=join(dir,'prefix',...(process.platform==='win32'?[]:['bin']));
  const options={env:{...process.env,OFFICE_COLLECTOR_CONFIG:join(dir,'client.json')},timeout:15000};
  const namedClient=(name,...args)=>process.platform==='win32'
    ? exec(process.execPath,[entry,...args],options)
    : exec(join(binDir,name),args,options);
  const client=(...args)=>namedClient('symbio',...args);
  for(const name of ['symbio','symbio-cli','symbio-agent-collector']){
    await access(join(binDir,name+(process.platform==='win32'?'.cmd':'')));
    assert.match((await namedClient(name,'help')).stdout,/用法：symbio <命令>/);
  }
  const pairing=discovery.issuePairing({name:'npm 安装客户端'});
  await client('login',address,'--code',pairing.code);
  const status=JSON.parse((await client('status','--json')).stdout);
  assert.equal(status.machine.id,pairing.machine.id);assert.equal(status.machine.status,'online');
  for(const name of ['symbio-cli','symbio-agent-collector']){
    const identity=JSON.parse((await namedClient(name,'whoami','--json')).stdout);
    assert.equal(identity.machine.id,pairing.machine.id);
  }
  await client('run','--once');
  const config=JSON.parse((await client('config','show')).stdout);
  assert.equal(config.authenticated,true);assert.equal(config.token,undefined);
});
