const PING_MS = 25e3;
const MAX_BACKOFF_MS = 30e3;

export function startFeed(onDrop) {
  const base = new URL(import.meta.env.VITE_AUTH_URL || location.origin);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/feed";
  base.search = "";
  let ws = null, retry = 0, pinger = null, stopped = false;

  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(base);
    ws.addEventListener("open", () => {
      retry = 0;
      clearInterval(pinger);
      pinger = setInterval(() => ws?.readyState === 1 && ws.send("ping"), PING_MS);
    });
    ws.addEventListener("message", (e) => {
      let message;
      try {
        message = JSON.parse(e.data);
      } catch {
        return;
      }
      if (message?.type === "drop" && typeof message.skin === "string") onDrop(message);
    });
    ws.addEventListener("close", () => {
      clearInterval(pinger);
      if (stopped) return;
      setTimeout(connect, Math.min(MAX_BACKOFF_MS, 1e3 * 2 ** retry++) * (0.75 + Math.random() * 0.5));
    });
  };
  connect();
  return () => {
    stopped = true;
    clearInterval(pinger);
    ws?.close();
  };
}
