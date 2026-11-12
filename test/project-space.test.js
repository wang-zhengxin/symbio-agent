import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createOffice } from '../src/office.js';
import { createProjectSpace } from '../src/project-space.js';
import { openStore } from '../src/store.js';

async function setup(t) {
  const data = await mkdtemp(join(tmpdir(), 'office-space-'));
  const store = openStore(':memory:');
  t.after(async () => {
    store.close();
    await rm(data, {recursive:true, force:true});
  });
  const space = createProjectSpace(store, data);
  const office = createOffice(store, undefined, space);
  const project = office.saveNamed('project', {name:'测试项目', repositoryUrl:'https://github.com/example/private'});
  const author = office.saveAgent({name:'开发', runtime:'codex'});
  const task = (title, extra = {}) => office.saveTask({title, projectId:project.id, assigneeId:author.id, ...extra});
  const directory = run => join(data, 'workspaces', run.id);
  const signal = new AbortController().signal;
  const upload = (path, base, value) => space.upload(project.id, path, base, Buffer.from(value));
  async function deliver(run, files) {
    office.startRun(run.id);
    const cwd = directory(run);
    await mkdir(join(cwd, 'deliverables'), {recursive:true});
    await space.prepare(run, cwd, signal);
    for (const [path, content] of Object.entries(files)) await writeFile(join(cwd, 'deliverables', path), content);
    office.finish(run.id, 'completed', null, await space.capture(run, cwd, '', signal));
  }
  return {store, office, space, project, task, upload, deliver, directory, signal};
}

test('Parallel deliveries publish atomically, preserve a conflict and reject stale acceptance', async t => {
  const {office, space, project, task, upload, deliver, directory, signal} = await setup(t);
  const first = await upload('requirements.md', null, 'baseline');
  const a = task('A'), b = task('B');
  const runA = office.enqueueTask(a.id), runB = office.enqueueTask(b.id);
  await Promise.all([
    deliver(runA, {'requirements.md':'A', 'a.txt':'new A'}),
    deliver(runB, {'requirements.md':'B', 'b.txt':'new B'}),
  ]);
  assert.equal(await readFile(join(directory(runB), '.office-inputs/project/requirements.md'), 'utf8'), 'baseline');
  await writeFile(join(directory(runA), 'deliverables/requirements.md'), 'modified after capture');
  assert.equal(office.taskStatus(a.id, 'done').status, 'done');
  const conflict = office.taskStatus(b.id, 'done');
  assert.equal(conflict.status, 'review');
  assert.equal(conflict.conflicts[0].baseId, first.id);
  let view = space.view(project.id);
  assert.deepEqual(view.files.map(file => file.path).sort(), ['a.txt', 'requirements.md']);
  const publishedA = view.files.find(file => file.path === 'requirements.md');
  assert.equal((await space.read(project.id, {versionId:publishedA.versionId, preview:true})).text, 'A');
  assert.equal((await space.read(project.id, {deliveryId:runB.id, path:'requirements.md', preview:true})).text, 'B');

  const manual = await upload('requirements.md', publishedA.versionId, 'newer current');
  await assert.rejects(upload('requirements.md', publishedA.versionId, 'stale upload'), {status:409});
  assert.equal(office.taskStatus(b.id, 'done', conflict.conflicts, runB.id).status, 'review');
  const refreshed = space.view(project.id).deliveries.find(row => row.id === runB.id);
  assert.equal(refreshed.conflicts[0].currentId, manual.id);
  assert.equal(office.taskStatus(b.id, 'done', refreshed.conflicts, runB.id).status, 'done');
  assert.equal(office.taskStatus(b.id, 'done', refreshed.conflicts, runB.id).status, 'done');
  view = space.view(project.id);
  assert.equal(view.files.find(file => file.path === 'requirements.md').number, 4);
  assert.equal(view.versions.filter(file => file.path === 'requirements.md').length, 4);

  const downstream = office.enqueueTask(task('下游', {dependencyIds:[a.id]}).id);
  const cwd = directory(downstream);
  await mkdir(cwd, {recursive:true});
  await space.prepare(downstream, cwd, signal);
  assert.equal(await readFile(join(cwd, '.office-inputs/project/requirements.md'), 'utf8'), 'B');
  assert.equal(await readFile(join(cwd, '.office-inputs/dependencies', a.id, 'requirements.md'), 'utf8'), 'A');

  const retry = task('重跑');
  const old = office.enqueueTask(retry.id);
  await deliver(old, {'old.txt':'old'});
  office.taskStatus(retry.id, 'todo', undefined, old.id);
  const current = office.enqueueTask(retry.id);
  await deliver(current, {'new.txt':'new'});
  assert.throws(() => office.taskStatus(retry.id, 'done', undefined, old.id), {status:409});
  assert.equal(space.view(project.id).deliveries.find(row => row.id === old.id).status, 'returned');
});

test('Shared files stay scoped to their project and reject traversal and symbolic links', async t => {
  const {office, space, project, task, upload, directory, signal} = await setup(t);
  await assert.rejects(upload('../outside.txt', null, 'bad path'), {status:400});
  const document = await upload('folder/readme.md', null, 'valid');
  await assert.rejects(upload('FOLDER', null, 'folder collision'), {status:409});
  const another = office.saveNamed('project', {name:'另一项目'});
  await assert.rejects(space.read(another.id, {versionId:document.id, preview:true}), {status:404});
  const run = office.enqueueTask(task('链接检查').id);
  const cwd = directory(run);
  await mkdir(join(cwd, 'deliverables'), {recursive:true});
  await writeFile(join(cwd, 'outside.txt'), 'out');
  await symlink('../outside.txt', join(cwd, 'deliverables/shortcut.txt'));
  await assert.rejects(space.capture(run, cwd, '', signal), {status:400});
  assert.equal(space.view(project.id).deliveries.length, 0);
});
