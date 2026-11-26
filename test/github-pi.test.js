import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import { createOffice } from '../src/office.js';
import { createGithubIntegration } from '../src/github-integration.js';
import { companyTools } from '../src/company-tools.js';
import { piRuntime } from '../src/runtimes.js';

test('Pi calls the GitHub broker over its private execution channel without receiving a credential', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'symbio-pi-github-'));
  t.after(() => rm(cwd, {recursive:true, force:true}));
  const store = openStore(':memory:');
  t.after(() => store.close());
  const office = createOffice(store);
  const github = createGithubIntegration(store, async () => ({account:{id:'1', login:'tester'},
    request:async () => ({id:7, full_name:'test/repo', default_branch:'main'})}));
  const connected = await github.connect({expectedVersion:0});
  await github.saveRepository({fullName:'test/repo', operations:['read'], expectedVersion:connected.version});
  const agent = office.saveAgent({name:'Pi employee', runtime:'pi'});
  const task = office.saveTask({title:'Read the repository', assigneeId:agent.id});
  const run = office.startRun(office.enqueueTask(task.id).id);
  const signal = AbortSignal.timeout(4000);
  const tools = companyTools(store, office, run, {github, signal});

  const executable = join(cwd, 'mock-pi.mjs');
  await writeFile(executable, String.raw`#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const args = process.argv.slice(2);
if (Object.hasOwn(process.env, 'GH_TOKEN') || Object.hasOwn(process.env, 'GITHUB_TOKEN')) process.exit(3);
if (!args.includes('--no-builtin-tools') || args.includes('--no-tools')) process.exit(4);
readFileSync(0);
const extension = args[args.indexOf('--extension') + 1];
const registered = new Map();
await (await import(pathToFileURL(extension))).default({registerTool:tool=>registered.set(tool.name,tool)});
const tool = registered.get('github_get_repository');
if (!tool || registered.has('github_merge_pull_request')) process.exit(5);
const send = event => process.stdout.write(JSON.stringify(event) + '\n');
send({type:'tool_execution_start',toolName:tool.name,toolCallId:'repository'});
const result = await tool.execute('repository', {repository:'test/repo'});
send({type:'tool_execution_end',toolName:tool.name,toolCallId:'repository'});
const {repository} = JSON.parse(result.content[0].text);
send({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:repository}]}});
`, {mode:0o700});

  const previous = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'test-credential';
  t.after(() => {
    if (previous === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previous;
  });
  const events = [];
  await piRuntime({run, cwd, executable, signal, tools, emit:(type, payload) => events.push({type, payload})});
  assert.equal(events.at(-1).payload.text, 'test/repo');
  assert.ok(events.some(event => event.type === 'tool.completed' && event.payload.id === 'repository'));
  assert.ok(store.audit().some(event => event.type === 'github.operation' && event.run_id === run.id &&
    event.payload.name === 'test/repo' && event.payload.outcome === 'success'));
});
