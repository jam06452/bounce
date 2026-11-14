// Where the ball goes when it leaves a screen, and how it arrives.
// Seats are numbered in join order (host = 0). Pure functions, no browser APIs.
//
// 2 players, back to back:  top edge → the other player.
// 4 players, around a table: left edge → next seat in join order (wrapping),
//                            right edge → previous seat,
//                            top edge → the seat across the table.
// The bottom edge always bounces.

/** Seat the ball is sent to when it leaves through `edge`, or null if that edge bounces. */
export function exitTarget(size, seat, edge) {
  if (size === 2) return edge === 'top' ? 1 - seat : null
  if (size === 4) {
    if (edge === 'left') return (seat + 1) % 4
    if (edge === 'right') return (seat + 3) % 4
    if (edge === 'top') return (seat + 2) % 4
  }
  return null
}

/**
 * Ball state on the receiving screen. `m` is what the sender reported when the
 * ball left: the edge it left through, and position (0–1) and velocity at that moment.
 *  top   → arrives at my top edge; screens face away from each other, so x mirrors
 *          and both velocity components reverse.
 *  left  → the sender's left is my right: it keeps moving left, in at my right edge.
 *  right → the sender's right is my left: it keeps moving right, in at my left edge.
 */
export function entryState(m, width, height, radius) {
  const inset = radius + 1
  switch (m.edge) {
    case 'top': return { x: (1 - m.x) * width, y: radius, vx: -m.vx, vy: -m.vy }
    case 'left': return { x: width - inset, y: m.y * height, vx: m.vx, vy: m.vy }
    case 'right': return { x: inset, y: m.y * height, vx: m.vx, vy: m.vy }
    default: return null
  }
}
