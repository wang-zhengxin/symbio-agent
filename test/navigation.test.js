import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationGroups, navigationFooter, navigationLocation, taskMatchesView } from '../public/navigation.js';

test('Navigation distinguishes project overview, personal tasks and scheduled tasks', () => {
  assert.equal(navigationLocation('tasks').title,'项目');
  assert.equal(navigationLocation('tasks','all').title,'任务');
  assert.equal(navigationLocation('tasks','mine').title,'我的任务');
  assert.equal(navigationLocation('tasks','scheduled').title,'定时任务');
  const entries = [...navigationGroups.flatMap(group=>group.items), ...navigationFooter].filter(item=>item.page);
  const destinations = entries.map(item=>item.page+'/'+(item.child || ''));
  assert.equal(new Set(destinations).size,destinations.length);
  assert.ok(!entries.some(item=>item.member && ['agents','runtime','skills','teams','discovery','finance'].includes(item.page)));
});

test('Personal tasks use account identity, and all task views keep subtasks out', () => {
  const user = {id:'boss',email:'Boss@example.com',name:'Same name'};
  const humans = [{id:'own',userId:'boss'},{id:'legacy',email:'boss@example.com'},
    {id:'another',name:'Same name',userId:'other'}];
  assert.ok(taskMatchesView({humanId:'own'},'mine',user,humans));
  assert.ok(taskMatchesView({humanId:'legacy'},'mine',user,humans));
  assert.ok(!taskMatchesView({humanId:'another'},'mine',user,humans));
  assert.ok(!taskMatchesView({assigneeId:'agent'},'mine',user,humans));
  assert.ok(!taskMatchesView({humanId:'own'},'mine',{},[{id:'own'}]));
  assert.ok(taskMatchesView({scheduledAt:'2026-11-22T02:00:00Z'},'scheduled',user));
  assert.ok(!taskMatchesView({},'scheduled',user));
  for (const view of ['all','mine','scheduled']) {
    assert.ok(!taskMatchesView({parentId:'parent',humanId:'own',scheduledAt:'2026-11-22T02:00:00Z'},view,user,humans));
  }
});
