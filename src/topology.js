
export function exitTarget(size, seat, edge) {
  if (size === 2) return edge === 'top' ? 1 - seat : null
  if (size === 4) {
    if (edge === 'left') return (seat + 1) % 4
    if (edge === 'right') return (seat + 3) % 4
    if (edge === 'top') return (seat + 2) % 4
  }
  return null
}

export function entryState(m, width, height, radius) {
  const inset = radius + 1
  switch (m.edge) {
    case 'top': return { x: (1 - m.x) * width, y: radius, vx: -m.vx, vy: -m.vy }
    case 'left': return { x: width - inset, y: m.y * height, vx: m.vx, vy: m.vy }
    case 'right': return { x: inset, y: m.y * height, vx: m.vx, vy: m.vy }
    default: return null
  }
}
