import test from 'node:test';
import assert from 'node:assert/strict';
import { wallSections, officeWallHeight } from '../public/office-walls.js';

test('Wall corners and T junctions form a continuous union without overlapping faces', () => {
  const walls = [
    {x1:0,x2:4,z1:0,z2:0,color:1},
    {x1:4,x2:4,z1:0,z2:4,color:2},
    {x1:2,x2:2,z1:0,z2:3,color:2},
  ];
  for (const thickness of [.16,.22,.24]) {
    const sections = wallSections(walls,thickness);
    const area = sections.reduce((sum,rect) => sum+(rect.x2-rect.x1)*(rect.z2-rect.z1),0);
    assert.ok(Math.abs(area-(11*thickness+thickness**2)) < 1e-10);
    for (const point of [[4,0],[2,0],[4.05,.05],[2.05,.05]]) {
      assert.equal(sections.filter(rect => point[0]>=rect.x1 && point[0]<rect.x2 &&
        point[1]>=rect.z1 && point[1]<rect.z2).length,1);
    }
    sections.forEach((a,index) => {
      for (const b of sections.slice(index+1)) {
        assert.ok(Math.min(a.x2,b.x2)<=Math.max(a.x1,b.x1) ||
          Math.min(a.z2,b.z2)<=Math.max(a.z1,b.z1));
      }
    });
  }
});

test('Collinear wall sections join while the meeting room doorway stays open', () => {
  const sections = wallSections([
    {x1:10,x2:10,z1:-8,z2:-2.95,color:1},
    {x1:10,x2:10,z1:-2.95,z2:2.92,color:2},
    {x1:10,x2:10,z1:2.92,z2:8,color:1},
    {x1:3.22,x2:3.22,z1:2.92,z2:4.1,color:1},
    {x1:3.22,x2:3.22,z1:5.39,z2:8,color:1},
  ],.22);
  const contains = (x,z) => sections.some(rect => x>=rect.x1 && x<=rect.x2 && z>=rect.z1 && z<=rect.z2);
  assert.ok(contains(10,-2.95) && contains(10,2.92));
  assert.equal(contains(3.22,4.7),false);
  assert.equal(officeWallHeight,2.78);
});
