export function exitTarget(size, seat, edge) {
  if (size === 2) return edge === "top" ? 1 - seat : null;
  if (size === 4) {
    if (edge === "left") return (seat + 1) % 4;
    if (edge === "right") return (seat + 3) % 4;
    if (edge === "top") return (seat + 2) % 4;
  }
  return null;
}
export function entryState(m, width, height, radius) {
  const inset = radius + 1;
  switch (m.edge) {
    case "top":
      return { x: (1 - m.x) * width, y: radius, vx: -m.vx, vy: -m.vy };
    case "left":
      return { x: width - inset, y: m.y * height, vx: m.vx, vy: m.vy };
    case "right":
      return { x: inset, y: m.y * height, vx: m.vx, vy: m.vy };
    default:
      return null;
  }
}
export function predictExit(ball, v, gravity, radius, width, height, exits, maxMs = Infinity) {
  const hits = [];
  const consider = (edge, t2, coord) => {
    if (exits.includes(edge) && t2 >= 0 && t2 * 1e3 <= maxMs) hits.push({ edge, ms: t2 * 1e3, coord });
  };
  const yAt = (t2) => ball.y + v.y * t2 + 0.5 * gravity * t2 * t2;
  if (v.x < 0) {
    const t2 = (ball.x - radius) / -v.x;
    consider("left", t2, yAt(t2));
  }
  if (v.x > 0) {
    const t2 = (width - radius - ball.x) / v.x;
    consider("right", t2, yAt(t2));
  }
  const a = 0.5 * gravity, b = v.y, c = ball.y - radius;
  let t = null;
  if (c <= 0) t = v.y < 0 ? 0 : null;
  else if (Math.abs(a) < 1e-9) t = b < 0 ? -c / b : null;
  else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0 && b < 0) t = (-b - Math.sqrt(disc)) / (2 * a);
  }
  if (t !== null && t >= 0) consider("top", t, ball.x + v.x * t);
  return hits.sort((p, q) => p.ms - q.ms)[0] ?? null;
}
