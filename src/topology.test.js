import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exitTarget, entryState } from './topology.js'

test('2 players: only the top edge passes, to the other seat', () => {
  assert.equal(exitTarget(2, 0, 'top'), 1)
  assert.equal(exitTarget(2, 1, 'top'), 0)
  for (const edge of ['left', 'right', 'bottom']) assert.equal(exitTarget(2, 0, edge), null)
})

test('4 players: left → next, right → previous, top → across, bottom bounces', () => {
  for (let seat = 0; seat < 4; seat++) {
    assert.equal(exitTarget(4, seat, 'left'), (seat + 1) % 4)
    assert.equal(exitTarget(4, seat, 'right'), (seat + 3) % 4)
    assert.equal(exitTarget(4, seat, 'top'), (seat + 2) % 4)
    assert.equal(exitTarget(4, seat, 'bottom'), null)
  }
  assert.equal(exitTarget(4, 3, 'left'), 0)
  assert.equal(exitTarget(4, 0, 'right'), 3)
})

test('going left then coming back right returns to the same seat', () => {
  for (let seat = 0; seat < 4; seat++) assert.equal(exitTarget(4, exitTarget(4, seat, 'left'), 'right'), seat)
})

test('every pair of 4 seats is directly connected (so a full mesh is enough)', () => {
  for (let a = 0; a < 4; a++) for (const edge of ['left', 'right', 'top']) {
    const b = exitTarget(4, a, edge); assert.notEqual(b, a)
  }
  const links = new Set()
  for (let a = 0; a < 4; a++) for (const e of ['left', 'right', 'top']) links.add([a, exitTarget(4, a, e)].sort().join('-'))
  assert.equal(links.size, 6)
})

test('arrival: top mirrors x and reverses momentum', () => {
  const s = entryState({ edge: 'top', x: 0.125, y: 0, vx: 200, vy: -600 }, 800, 450, 18)
  assert.deepEqual(s, { x: 700, y: 18, vx: -200, vy: 600 })
})

test('arrival: side passes keep momentum and height, enter the opposite edge', () => {
  assert.deepEqual(entryState({ edge: 'left', x: 0, y: 0.5, vx: -300, vy: 40 }, 800, 450, 18), { x: 781, y: 225, vx: -300, vy: 40 })
  assert.deepEqual(entryState({ edge: 'right', x: 1, y: 0.5, vx: 300, vy: 40 }, 800, 450, 18), { x: 19, y: 225, vx: 300, vy: 40 })
})
