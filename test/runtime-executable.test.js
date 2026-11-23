import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, chmod, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {resolveProviderExecutable, installedProviders} from '../collector/office-collector.mjs';

test('Discovery and execution resolve the desktop CLI without PATH and honor explicit overrides', async t=>{
 const home=await mkdtemp(join(tmpdir(),'office-cli-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const bundled=join(home,'Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
 const pi=join(home,'.local/bin/pi');
 for(const path of [bundled,pi]) {await mkdir(dirname(path),{recursive:true});await writeFile(path,'#!/bin/sh\nexit 0\n');await chmod(path,0o755);}
 const options={env:{PATH:''},home,platform:'darwin'};
 assert.equal(await resolveProviderExecutable('codex',options),bundled);
 assert.equal(await resolveProviderExecutable('pi',options),pi);
 const found=await installedProviders(options);
 assert.ok(found.includes('codex'));assert.ok(found.includes('pi'));
 assert.equal(await resolveProviderExecutable('codex',{...options,env:{PATH:'',OFFICE_CODEX_BIN:pi}}),pi);
 const invalid={...options,env:{PATH:'',OFFICE_CODEX_BIN:join(home,'missing')}};
 assert.equal(await resolveProviderExecutable('codex',invalid),null);
 assert.ok(!(await installedProviders(invalid)).includes('codex'));
});
