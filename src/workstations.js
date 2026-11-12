import { integer } from './input.js';
import { baseWorkstations } from '../public/office-presence.js';

const people = store => ['agent', 'human'].flatMap(kind =>
  store.list(kind).map(person => ({kind, person})));
const occupiedSeats = rows => new Set(rows.map(({person}) => person.seatIndex).filter(Number.isInteger));

function reserveSeat(occupied) {
  let index = 0;
  while (occupied.has(index)) index++;
  occupied.add(index);
  return index;
}

export function assignWorkstation(store, existing) {
  return existing?.seatIndex ?? reserveSeat(occupiedSeats(people(store)));
}

export function backfillWorkstations(store) {
  store.tx(() => {
    const rows = people(store);
    const occupied = occupiedSeats(rows);
    for (const {kind, person} of rows) {
      if (!Number.isInteger(person.seatIndex)) {
        store.put(kind, {...person, seatIndex:reserveSeat(occupied)});
      }
    }
  });
}

export function workstationCount(store) {
  return people(store).reduce((count, {person}) => Math.max(count, (person.seatIndex ?? -1) + 1),
    store.get('setting', 'workstations')?.count ?? baseWorkstations);
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
