import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, rm, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fail, string, integer } from './input.js';

export const skillSources = [
  {id:'anthropic', name:'Anthropic Skills', repository:'anthropics/skills', url:'https://github.com/anthropics/skills'},
  {id:'openai', name:'OpenAI Plugins', repository:'openai/plugins', url:'https://github.com/openai/plugins'},
  {id:'vercel', name:'Vercel Agent Skills', repository:'vercel-labs/agent-skills', url:'https://github.com/vercel-labs/agent-skills'},
  {id:'skills-sh', name:'skills.sh', url:'https://skills.sh', searchRequired:true},
  {id:'skillsmp', name:'SkillsMP', url:'https://skillsmp.com', searchRequired:true},
];
const repoPattern = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/;
const safePath = path => typeof path === 'string' && path.length < 1024 &&
  !path.includes('\\') && !/[\x00-\x1f]/.test(path) &&
  path.split('/').every(part => part && part !== '.' && part !== '..');
const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
const pageSize = 20;

export function createSkillMarketplace(store, office, data, fetcher = fetch) {
  const cache = new Map();
  const pending = new Map();
  const root = join(data,'skill-packages');

  async function request(url, limit = 8_000_000, json = true) {
    try {
      const response = await fetcher(url, {
        signal:AbortSignal.timeout(20_000), redirect:'error',
        headers:{Accept:json ? 'application/json' : 'application/octet-stream', 'User-Agent':'Symbio-Agent'},
      });
      if (!response.ok) {
        await response.body?.cancel();
        fail([403,429].includes(response.status) ? '来源暂时限流，请稍后重试或选择其他来源'
          : '下载来源返回 HTTP ' + response.status, 502);
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) fail('来源文件超过下载大小限制', 413);
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      return json ? JSON.parse(bytes.toString('utf8')) : bytes;
    } catch (error) {
      if (error.status) throw error;
      fail('无法读取技能来源，请检查工作台的网络连接后重试', 502);
    }
  }

  async function tree(repository, ref = 'HEAD') {
    if (!repoPattern.test(repository)) fail('GitHub 仓库名称无效');
    if (typeof ref !== 'string' || ref.length > 200 || !/^[\w./-]+$/.test(ref) || ref.includes('..')) fail('技能版本无效');
    const key = repository + '/' + ref;
    const saved = cache.get(key);
    if (saved && saved.expires > Date.now()) return saved.value;
    const commit = await request('https://api.github.com/repos/' + repository + '/commits/' + encodeURIComponent(ref));
    if (!/^[a-f0-9]{40}$/.test(commit.sha) || !/^[a-f0-9]{40}$/.test(commit.commit?.tree?.sha)) {
      fail('无法确定技能仓库版本',502);
    }
    const value = await request('https://api.github.com/repos/' + repository + '/git/trees/' + commit.commit.tree.sha + '?recursive=1');
    if (value.truncated || !Array.isArray(value.tree) || !/^[a-f0-9]{40}$/.test(value.sha)) {
      fail('仓库目录过大或来源数据不完整，请选择其他技能来源', 502);
    }
    value.sha = commit.sha;
    if (cache.size >= 30) cache.delete(cache.keys().next().value);
    cache.set(key,{value,expires:Date.now()+10*60_000});
    return value;
  }

  function githubItem(repository, path, ref = 'HEAD') {
    if (!repoPattern.test(repository) || !safePath(path)) return null;
    return {repository,path,ref,name:path.split('/').at(-2) ?? repository.split('/')[1],
      url:'https://github.com/'+repository+'/blob/'+ref+'/'+encodePath(path)};
  }

  async function search(input) {
    const source = skillSources.find(source => source.id === input.source);
    if (!source) fail('技能来源无效');
    const query = string(input.query,'搜索词',120,true);
    const page = integer(Number(input.page ?? 1),'页码',1,1000);
    let items, hasMore;
    if (source.repository) {
      const index = await tree(source.repository);
      const all = index.tree.filter(entry => entry.type === 'blob' && entry.mode !== '120000' &&
        /(^|\/)SKILL\.md$/.test(entry.path) && entry.path.toLowerCase().includes(query.toLowerCase()))
        .map(entry => githubItem(source.repository,entry.path,index.sha)).filter(Boolean);
      items = all.slice((page-1)*pageSize,page*pageSize);
      hasMore = page*pageSize < all.length;
    } else {
      if (!query) fail('请输入搜索关键词');
      if (source.id === 'skills-sh') {
        const result = await request('https://skills.sh/api/search?' + new URLSearchParams({q:query,limit:'50'}));
        if (!Array.isArray(result.skills)) fail('skills.sh 返回了无效的搜索结果',502);
        items = result.skills.filter(item => repoPattern.test(item.source) && typeof item.skillId === 'string')
          .map(item => ({repository:item.source,slug:item.skillId,name:item.name || item.skillId,
            url:'https://skills.sh/'+item.source+'/'+encodeURIComponent(item.skillId)}));
        hasMore = false;
      } else {
        const result = await request('https://skillsmp.com/api/v1/skills/search?' +
          new URLSearchParams({q:query,limit:String(pageSize),page:String(page)}));
        if (!Array.isArray(result.data?.skills)) fail('SkillsMP 返回了无效的搜索结果',502);
        items = result.data.skills.flatMap(item => {
          let url;
          try { url = new URL(item.githubUrl); } catch { return []; }
          if (url.origin !== 'https://github.com') return [];
          const parts = url.pathname.split('/').filter(Boolean);
          if (!['tree','blob'].includes(parts[2]) || parts.length < 5) return [];
          let path = parts.slice(4).map(decodeURIComponent).join('/');
          if (!/(^|\/)SKILL\.md$/.test(path)) path += '/SKILL.md';
          const record = githubItem(parts.slice(0,2).join('/'),path,decodeURIComponent(parts[3]));
          return record ? [{...record,name:item.name,description:item.description}] : [];
        });
        hasMore = result.data.pagination?.hasNext === true;
      }
    }
    return {source:source.id,query,page,hasMore,items:items.map(item => ({
      ...item,source:source.id,
      installedId:store.list('skill').find(skill => skill.source?.repository === item.repository &&
        (item.path ? skill.source.path === item.path : skill.source.slug === item.slug))?.id,
    }))};
  }

  async function download(input) {
    const source = skillSources.find(source => source.id === input.source);
    if (!source) fail('技能来源无效');
    const repository = string(input.repository,'仓库',200);
    if (!repoPattern.test(repository) || (source.repository && source.repository !== repository)) fail('技能仓库与来源不符');
    const index = await tree(repository,input.ref ?? 'HEAD');
    let path = input.path;
    if (path === undefined && source.id === 'skills-sh') {
      const slug = string(input.slug,'技能名称',120);
      const candidates = index.tree.filter(entry => entry.type === 'blob' && entry.path.endsWith('/SKILL.md'));
      let matches = candidates.filter(entry => entry.path.endsWith('/'+slug+'/SKILL.md'));
      if (!matches.length) matches = candidates.filter(entry => slug.endsWith('-'+entry.path.split('/').at(-2)));
      if (matches.length !== 1) fail('无法唯一定位此技能，请从原始仓库来源选择',422);
      path = matches[0].path;
    }
    if (!safePath(path) || !/(^|\/)SKILL\.md$/.test(path)) fail('技能路径无效');
    const identity = repository + ':' + path;
    const existing = store.list('skill').find(skill => skill.source?.repository === repository && skill.source.path === path);
    if (existing) return {skill:existing,alreadyInstalled:true};
    if (pending.has(identity)) return pending.get(identity);
    const operation = saveBundle(repository,path,index,input.slug);
    pending.set(identity,operation);
    try { return await operation; } finally { pending.delete(identity); }
  }

  async function saveBundle(repository,path,index,slug) {
    const prefix = path.slice(0,-'SKILL.md'.length);
    const files = index.tree.filter(entry => entry.path.startsWith(prefix) && entry.type === 'blob');
    if (!files.some(file => file.path === path) || files.length > 256 ||
      files.some(file => file.mode === '120000' || !safePath(file.path)) ||
      files.reduce((size,file) => size+(file.size ?? 0),0) > 16_000_000) {
      fail('技能目录无效，或超过 256 个文件 / 16 MB 下载上限',422);
    }
    const bundleId = randomUUID();
    const temporary = join(root,'.'+bundleId);
    await mkdir(temporary,{recursive:true,mode:0o700});
    let instructions, total = 0, installed = false;
    try {
      const downloadFile = async file => {
        const bytes = await request('https://raw.githubusercontent.com/'+repository+'/'+index.sha+'/'+encodePath(file.path),4_000_000,false);
        total += bytes.length;
        if (total > 16_000_000) fail('技能目录超过 16 MB 下载上限',413);
        const relative = file.path.slice(prefix.length);
        const destination = join(temporary,relative);
        await mkdir(dirname(destination),{recursive:true,mode:0o700});
        await writeFile(destination,bytes,{flag:'wx',mode:file.mode === '100755' ? 0o700 : 0o600});
        if (file.path === path) instructions = string(bytes.toString('utf8'),'SKILL.md 正文',32_000);
      };
      for (let offset=0; offset<files.length; offset+=4) {
        const results = await Promise.allSettled(files.slice(offset,offset+4).map(downloadFile));
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
      }
      const metadata = instructions.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? '';
      const field = name => metadata.match(new RegExp('^'+name+':[ \\t]*(.+)$','m'))?.[1].trim().replace(/^(['"])(.*)\1$/,'$2');
      const name = field('name') || path.split('/').at(-2) || 'Skill';
      const description = field('description');
      const source = {repository,path,ref:index.sha,bundleId,...(typeof slug === 'string' ? {slug} : {}),
        url:'https://github.com/'+repository+'/tree/'+index.sha+'/'+encodePath(prefix),
        downloadedAt:new Date().toISOString(),files:files.length,bytes:total};
      await rename(temporary,join(root,bundleId));
      const skill = office.saveNamed('skill',{name:name.slice(0,120),
          description:description && !['|','>','|-','>-'].includes(description) ? description.slice(0,8000) : '下载自 '+repository,
          instructions},source);
      installed = true;
      return {skill,alreadyInstalled:false};
    } finally {
      await rm(temporary,{recursive:true,force:true});
      if (!installed) await rm(join(root,bundleId),{recursive:true,force:true});
    }
  }
  return {search,download};
}

export async function prepareSkillFiles(run, data, cwd) {
  for (const skill of run.agent.skills ?? []) {
    if (!skill?.source?.bundleId) continue;
    if (!/^[a-f0-9-]{36}$/.test(skill.source.bundleId) || !/^[a-f0-9-]{36}$/.test(skill.id)) {
      throw new Error('技能文件标识无效');
    }
    const destination = join(cwd,'.office-skills',skill.id);
    await cp(join(data,'skill-packages',skill.source.bundleId),destination,{recursive:true,errorOnExist:true,force:false});
    await writeFile(join(destination,'SKILL.md'),skill.instructions,{mode:0o600});
  }
}
