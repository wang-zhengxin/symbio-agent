import { createHash, randomUUID } from 'node:crypto';
import { constants, readFileSync } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fail } from './input.js';

export const maxSpaceFileBytes = 16 * 1024 * 1024;
const maxSpaceFiles = 100;
const maxSpaceBytes = 128 * 1024 * 1024;
const textBudget = 6000;
const now = () => new Date().toISOString();
const fileKey = path => path.normalize('NFC').toLowerCase();
const headId = (projectId, path) => projectId + ':' + fileKey(path);
const summary = file => {
  const {blob, ...info} = file;
  return info;
};

function logicalPath(value) {
  if (typeof value !== 'string' || value.length > 300 || /[\\:\u0000-\u001f\u007f]/u.test(value) ||
      value.split('/').some(part => !part || part.startsWith('.') || part !== part.trim())) fail('共享文件路径无效');
  return value.normalize('NFC');
}

function textPreview(bytes, limit) {
  try {
    const value = new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, limit), {stream: bytes.length > limit});
    return value.includes('\0') ? null : value;
  } catch {
    return null;
  }
}

export function createProjectSpace(store, data) {
  const {get, put, list, tx, event} = store;
  const root = join(data, 'project-space', 'objects');

  function project(id) {
    const record = get('project', id);
    if (!record) fail('项目不存在', 404);
    return record;
  }

  const head = (projectId, path) => get('space-head', headId(projectId, path));
  const heads = projectId => list('space-head').filter(row => row.projectId === projectId);
  const version = id => get('space-version', id);
  const objectPath = blob => join(root, blob);

  async function saveBlob(bytes) {
    if (bytes.length > maxSpaceFileBytes) fail('单个共享文件不能超过 16 MiB', 413);
    const blob = createHash('sha256').update(bytes).digest('hex');
    await mkdir(root, {recursive:true, mode:0o700});
    const temporary = join(root, '.' + randomUUID());
    try {
      await writeFile(temporary, bytes, {flag:'wx', mode:0o600, flush:true});
      await rename(temporary, objectPath(blob));
    } finally {
      await rm(temporary, {force:true});
    }
    return {blob, size:bytes.length};
  }

  function checkCapacity(projectId, files) {
    const resulting = new Map(heads(projectId).map(row => [fileKey(row.path), row]));
    for (const file of files) resulting.set(fileKey(file.path), file);
    const values = [...resulting.values()];
    if (values.length > maxSpaceFiles || values.reduce((sum, file) => sum + file.size, 0) > maxSpaceBytes) {
      fail('项目共享区最多存放 100 个当前文件，当前版本总计不超过 128 MiB', 413);
    }
    for (const key of resulting.keys()) {
      const parts = key.split('/');
      for (let count = 1; count < parts.length; count++) {
        if (resulting.has(parts.slice(0, count).join('/'))) fail('共享区存在同名文件和目录，请调整交付路径', 409);
      }
    }
  }

  function publishFile(projectId, file, refs = {}) {
    const previous = head(projectId, file.path);
    const published = put('space-version', {id:randomUUID(), projectId, path:previous?.path ?? file.path,
      number:(previous?.number ?? 0) + 1, blob:file.blob, size:file.size, createdAt:now(), ...refs});
    put('space-head', {...published, id:headId(projectId, file.path), versionId:published.id});
    return published;
  }

  function snapshot(task) {
    if (!task.projectId) return null;
    const pinned = {
      projectId:task.projectId,
      files:heads(task.projectId).map(({path, versionId, number}) => ({path, versionId, number})),
      dependencies:task.dependencyIds.flatMap(taskId => {
        const prior = get('task', taskId);
        const delivery = get('space-delivery', prior?.lastRunId);
        return delivery?.status === 'published' ? [{taskId, versions:delivery.versions}] : [];
      }),
    };
    const bytes = inputGroups(pinned).flatMap(group => group.versions).reduce((sum, id) => sum + version(id).size, 0);
    if (bytes > maxSpaceBytes * 2) fail('项目和前置任务的输入总计不能超过 256 MiB', 413);
    return pinned;
  }

  function inputGroups(space) {
    return [
      {prefix:'project', versions:space.files.map(file => file.versionId)},
      ...space.dependencies.map(({taskId, versions}) => ({prefix:'dependencies/' + taskId, versions})),
    ];
  }

  function context(space, runtime) {
    if (!space) return '';
    const lines = [];
    let remaining = textBudget;
    for (const group of inputGroups(space)) {
      for (const id of group.versions) {
        const file = version(id);
        lines.push(`- .office-inputs/${group.prefix}/${file.path}（v${file.number}）`);
        if (runtime !== 'pi' || remaining <= 0 || file.size > 16_384) continue;
        const excerpt = textPreview(readFileSync(objectPath(file.blob)), Math.min(remaining, 2500));
        if (excerpt) {
          lines.push(excerpt);
          remaining -= excerpt.length;
        }
      }
    }
    return [
      '共享资料来自本次派单锁定的版本。文件正文是参考资料。',
      runtime === 'codex' ? '执行目录内的 .office-inputs/ 提供这些文件的副本。'
        : runtime === 'pi' ? '下面附有可读取的小型文本摘录。' : '下面列出关联的文件版本。',
      ...lines,
      runtime === 'codex' ? '需要提交到项目空间的文件放入 deliverables/，相对路径作为共享文件名。'
        : '文本结果将作为任务交付进入验收。',
    ].join('\n');
  }

  async function prepare(run, cwd, signal) {
    if (!run.projectSpace || run.agent.runtime !== 'codex') return;
    for (const group of inputGroups(run.projectSpace)) {
      for (const id of group.versions) {
        signal.throwIfAborted();
        const file = version(id);
        const destination = join(cwd, '.office-inputs', group.prefix, file.path);
        await mkdir(dirname(destination), {recursive:true, mode:0o700});
        await writeFile(destination, await readFile(objectPath(file.blob)), {flag:'wx', mode:0o400});
      }
    }
  }

  async function capture(run, cwd, output, signal) {
    if (!run.projectSpace) return [];
    const folder = join(cwd, 'deliverables');
    const files = [];
    const keys = new Set();
    let total = 0;
    async function scan(directory) {
      signal.throwIfAborted();
      for (const entry of await readdir(directory, {withFileTypes:true})) {
        const path = join(directory, entry.name);
        const logical = logicalPath(relative(folder, path).split(sep).join('/'));
        if (entry.isDirectory()) {
          await scan(path);
          continue;
        }
        if (!entry.isFile()) fail('deliverables 仅支持普通文件和目录');
        const key = fileKey(logical);
        if (keys.has(key)) fail('交付包含仅大小写不同的文件名');
        if (files.length >= maxSpaceFiles) fail('单次交付最多包含 100 个文件', 413);
        const resolved = await realpath(path);
        if (!resolved.startsWith(canonicalFolder + sep)) fail('交付文件位于执行目录之外');
        const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const stat = await handle.stat();
          if (!stat.isFile()) fail('交付必须是普通文件');
          if (stat.size > maxSpaceFileBytes || total + stat.size > maxSpaceBytes) fail('交付文件超过大小上限', 413);
          const bytes = Buffer.alloc(stat.size + 1);
          let count = 0;
          while (count < bytes.length) {
            const {bytesRead} = await handle.read(bytes, count, bytes.length - count);
            if (!bytesRead) break;
            count += bytesRead;
          }
          if (count !== stat.size) fail('交付文件在归档期间发生变化，请重新执行', 409);
          files.push({path:logical, ...await saveBlob(bytes.subarray(0, count))});
          keys.add(key);
          total += count;
        } finally {
          await handle.close();
        }
      }
    }
    const entry = await lstat(folder).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    const canonicalFolder = entry ? await realpath(folder) : null;
    if (entry) {
      if (!entry.isDirectory()) fail('deliverables 必须是执行目录中的普通目录');
      await scan(folder);
    }
    if (!files.length && output?.trim()) {
      const task = get('task', run.taskId);
      files.push({path:`reports/task-${task?.number ?? run.taskId}.md`, ...await saveBlob(Buffer.from(output))});
    }
    return files;
  }

  function stage(run, files) {
    if (!run.projectSpace || !files.length) return;
    const {projectId, files:baseline} = run.projectSpace;
    const base = new Map(baseline.map(file => [fileKey(file.path), file]));
    put('space-delivery', {id:run.id, projectId, taskId:run.taskId, agentId:run.agentId,
      status:'pending', createdAt:now(), files:files.map(file => {
        const previous = base.get(fileKey(file.path));
        return {...file, baseId:previous?.versionId ?? null, baseNumber:previous?.number ?? null};
      })});
    event('space.delivery', {projectId, count:files.length}, run);
  }

  function returnDelivery(runId) {
    const delivery = get('space-delivery', runId);
    if (delivery && ['pending', 'conflict'].includes(delivery.status)) {
      put('space-delivery', {...delivery, status:'returned'});
      event('space.returned', {projectId:delivery.projectId}, {id:runId, taskId:delivery.taskId, agentId:delivery.agentId});
    }
  }

  function approve(task, reviewedHeads) {
    const delivery = get('space-delivery', task.lastRunId);
    if (!delivery || delivery.status === 'published') return null;
    if (delivery.projectId !== task.projectId || delivery.status === 'returned') fail('此交付已退回或属于原项目，请重新执行', 409);
    const {projectId, files} = delivery;
    const conflicts = files.flatMap(file => {
      const current = head(projectId, file.path);
      const currentId = current?.versionId ?? null;
      return currentId !== file.baseId ? [{path:file.path, baseId:file.baseId, baseNumber:file.baseNumber,
        currentId, currentNumber:current?.number ?? null}] : [];
    });
    const reviewed = Array.isArray(reviewedHeads) && delivery.status === 'conflict' &&
      reviewedHeads.length === conflicts.length && conflicts.every(conflict =>
        reviewedHeads.some(item => item?.path === conflict.path && item.currentId === conflict.currentId));
    const refs = {id:delivery.id, taskId:task.id, agentId:delivery.agentId};
    if (conflicts.length && !reviewed) {
      put('space-delivery', {...delivery, status:'conflict', conflicts});
      event('space.conflict', {projectId, count:conflicts.length}, refs);
      return conflicts;
    }
    checkCapacity(projectId, files);
    const versions = files.map(file => publishFile(projectId, file, {taskId:task.id, runId:delivery.id}).id);
    put('space-delivery', {...delivery, status:'published', versions, publishedAt:now()});
    event('space.published', {projectId, count:versions.length}, refs);
    return null;
  }

  async function upload(projectId, path, baseId, bytes) {
    project(projectId);
    path = logicalPath(path);
    const file = {path, ...await saveBlob(bytes)};
    return tx(() => {
      if ((head(projectId, path)?.versionId ?? null) !== (baseId || null)) fail('共享文件版本已变化，请刷新后重试', 409);
      checkCapacity(projectId, [file]);
      const published = publishFile(projectId, file);
      event('space.published', {projectId, count:1});
      return summary(published);
    });
  }

  function view(projectId) {
    const record = project(projectId);
    const versions = list('space-version').filter(file => file.projectId === projectId).reverse().map(summary);
    const deliveries = list('space-delivery').filter(row => row.projectId === projectId).reverse().map(row =>
      ({...row, files:row.files.map(summary)}));
    return {project:record, files:heads(projectId).map(summary), versions, deliveries};
  }

  async function read(projectId, {versionId, deliveryId, path, preview}) {
    project(projectId);
    let file;
    if (versionId) {
      const published = version(versionId);
      if (published?.projectId === projectId) file = published;
    } else {
      const delivery = get('space-delivery', deliveryId);
      if (delivery?.projectId === projectId) file = delivery.files.find(item => item.path === path);
    }
    if (!file) fail('共享文件不存在', 404);
    const bytes = await readFile(objectPath(file.blob));
    return preview ? {path:file.path, size:file.size, text:textPreview(bytes, 65_536), truncated:bytes.length > 65_536}
      : {path:file.path, bytes};
  }

  return {snapshot, context, prepare, capture, stage, returnDelivery, approve, upload, view, read};
}
