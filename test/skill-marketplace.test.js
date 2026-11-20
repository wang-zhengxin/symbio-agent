import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import { createOffice } from '../src/office.js';
import { createSkillMarketplace, prepareSkillFiles } from '../src/skill-marketplace.js';

const revision = 'a'.repeat(40);
const treeRevision = 'b'.repeat(40);
const commit = {sha:revision,commit:{tree:{sha:treeRevision}}};
const body = '---\nname: Example\ndescription: A downloaded skill\n---\nRead references/example.md.';
const entries = [
  {path:'skills/example/SKILL.md',type:'blob',mode:'100644',size:body.length},
  {path:'skills/example/references/example.md',type:'blob',mode:'100644',size:5},
];
async function setup(t, fetcher) {
  const root = await mkdtemp(join(tmpdir(),'symbio-skill-test-'));
  const store = openStore(':memory:');
  t.after(async () => {store.close();await rm(root,{recursive:true,force:true});});
  const office = createOffice(store);
  return {root,store,office,market:createSkillMarketplace(store,office,root,fetcher)};
}
const response = value => new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

test('Downloads are pinned, concurrent imports deduplicate, and assigned runs get the complete skill directory', async t => {
  const urls = [];
  const {root,store,office,market} = await setup(t,async url => {
    urls.push(url);
    if (url.includes('/commits/')) return response(commit);
    if (url.includes('api.github.com')) {
      assert.ok(url.includes('/git/trees/'+treeRevision));
      return response({sha:treeRevision,tree:entries});
    }
    assert.ok(url.includes('/'+revision+'/'));
    return new Response(url.endsWith('SKILL.md') ? body : 'hello');
  });
  const result = await market.search({source:'anthropic',query:'example'});
  const [first,second] = await Promise.all([market.download(result.items[0]),market.download(result.items[0])]);
  assert.equal(first.skill.id,second.skill.id);
  assert.equal(store.list('skill').length,1);
  assert.equal(first.skill.source.files,2);
  assert.equal(urls.filter(url => url.endsWith('SKILL.md')).length,1);
  const edited = office.saveNamed('skill',{...first.skill,instructions:body+'\nLocal note'});
  assert.deepEqual(edited.source,first.skill.source);
  const cwd = join(root,'run');
  await prepareSkillFiles({agent:{skills:[edited]}},root,cwd);
  assert.equal(await readFile(join(cwd,'.office-skills',edited.id,'references/example.md'),'utf8'),'hello');
  assert.ok((await readFile(join(cwd,'.office-skills',edited.id,'SKILL.md'),'utf8')).endsWith('Local note'));
  assert.equal((await market.download(result.items[0])).alreadyInstalled,true);
});

test('Partial downloads leave no registered skill or package', async t => {
  const {root,store,market} = await setup(t,async url => {
    if (url.includes('/commits/')) return response(commit);
    if (url.includes('api.github.com')) {
      assert.ok(url.includes('/git/trees/'+treeRevision));
      return response({sha:treeRevision,tree:entries});
    }
    return url.endsWith('SKILL.md') ? new Response(body) : new Response('',{status:503});
  });
  await assert.rejects(market.download({source:'anthropic',repository:'anthropics/skills',path:entries[0].path}),/HTTP 503/);
  assert.equal(store.list('skill').length,0);
  assert.deepEqual(await readdir(join(root,'skill-packages')),[]);
});

test('Repository validation and path validation reject traversal and symlinks', async t => {
  const {store,market} = await setup(t,async url => url.includes('/commits/') ? response(commit) : response({sha:treeRevision,tree:[
    ...entries,{path:'skills/example/escape',type:'blob',mode:'120000',size:4},
  ]}));
  await assert.rejects(market.download({source:'anthropic',repository:'other/repo',path:entries[0].path}),/来源不符/);
  await assert.rejects(market.download({source:'anthropic',repository:'anthropics/skills',path:'../SKILL.md'}),/路径无效/);
  await assert.rejects(market.download({source:'anthropic',repository:'anthropics/skills',path:entries[0].path}),/目录无效/);
  assert.equal(store.list('skill').length,0);
});

test('Marketplace searches normalize skills.sh and SkillsMP results', async t => {
  const {market} = await setup(t,async url => {
    if (url.includes('skills.sh')) return response({skills:[{source:'vercel-labs/agent-skills',skillId:'vercel-react-best-practices',name:'React'}]});
    return response({data:{skills:[{name:'Example',githubUrl:'https://github.com/anthropics/skills/tree/main/skills/example'}],
      pagination:{hasNext:true}}});
  });
  const sh = await market.search({source:'skills-sh',query:'react'});
  assert.equal(sh.items[0].slug,'vercel-react-best-practices');
  const mp = await market.search({source:'skillsmp',query:'example'});
  assert.equal(mp.items[0].path,entries[0].path);
  assert.equal(mp.hasMore,true);
  await assert.rejects(market.search({source:'skillsmp',query:''}),/关键词/);
});
