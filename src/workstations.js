import { fail, integer } from './input.js';
import { baseWorkstations, customSeatIndexStart, privateOfficeSeatIndex } from '../public/office-presence.js';

const people = store => ['agent', 'human'].flatMap(kind =>
  store.list(kind).map(person => ({kind, person})));
const occupiedSeats = rows => new Set(rows.map(({person}) => person.seatIndex).filter(Number.isInteger));
const customDeskSeatIndices = store => (store.get('setting', 'office-items')?.items ?? [])
  .filter(item => item.type === 'desk' && Number.isInteger(item.seatIndex))
  .map(item => item.seatIndex)
  .sort((a, b) => a - b);

function reserveSeat(store, occupied) {
  occupied.add(privateOfficeSeatIndex);
  const wingCount = workstationCount(store);
  for (let index = 0; index < wingCount; index++) {
    if (!occupied.has(index)) {
      occupied.add(index);
      return index;
    }
  }
  for (const index of customDeskSeatIndices(store)) {
    if (!occupied.has(index)) {
      occupied.add(index);
      return index;
    }
  }
  let index = wingCount;
  while (occupied.has(index) || index >= customSeatIndexStart) index++;
  occupied.add(index);
  return index;
}

export function assignWorkstation(store, existing) {
  return Number.isInteger(existing?.seatIndex) && existing.seatIndex !== privateOfficeSeatIndex
    ? existing.seatIndex : reserveSeat(store, occupiedSeats(people(store)));
}

export function backfillWorkstations(store) {
  store.tx(() => {
    const rows = people(store);
    const occupied = occupiedSeats(rows);
    for (const {kind, person} of rows) {
      if (!Number.isInteger(person.seatIndex) || person.seatIndex === privateOfficeSeatIndex) {
        store.put(kind, {...person, seatIndex:reserveSeat(store, occupied)});
      }
    }
  });
}

export function workstationCount(store) {
  return people(store).reduce((count, {person}) => (
    Number.isInteger(person.seatIndex) && person.seatIndex < customSeatIndexStart
      ? Math.max(count, person.seatIndex + 1) : count
  ), store.get('setting', 'workstations')?.count ?? baseWorkstations);
}

export function addWorkstations(store, input) {
  const amount = integer(input.amount, '新增工位数量', 1, 24);
  return store.tx(() => {
    const count = workstationCount(store) + amount;
    store.put('setting', {id:'workstations', count});
    store.event('layout.workstations_added', {amount, count});
    return {count};
  });
}

export function removeWorkstations(store, input = {}) {
  return store.tx(() => {
    const current = workstationCount(store);
    if (current <= baseWorkstations) fail('基础 12 个工位不可删除，仅支持删除通过 3D 图扩建的空余工位', 409);
    const rows = people(store);
    const occupied = occupiedSeats(rows);
    if (input.index !== undefined) {
      const index = integer(input.index, '工位序号', baseWorkstations, current - 1);
      if (occupied.has(index)) fail('该工位已有员工入座，无法删除', 409);
      const last = current - 1;
      if (index !== last && occupied.has(last)) {
        const mover = rows.find(({person}) => person.seatIndex === last);
        if (mover) store.put(mover.kind, {...mover.person, seatIndex: index});
      }
      const count = current - 1;
      store.put('setting', {id:'workstations', count});
      store.event('layout.workstations_removed', {amount: 1, count, index});
      return {count};
    }
    const minCount = rows.reduce((min, {person}) => Math.max(min, (person.seatIndex ?? -1) + 1), baseWorkstations);
    const removable = Math.max(0, current - minCount);
    if (!removable) fail('扩建工位末尾已有员工入座，暂无可删除的空余工位', 409);
    const amount = integer(input.amount ?? 1, '删除工位数量', 1, removable);
    const count = current - amount;
    store.put('setting', {id:'workstations', count});
    store.event('layout.workstations_removed', {amount, count});
    return {count};
  });
}
