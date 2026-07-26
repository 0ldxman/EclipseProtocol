/**
 * The two widgets that cannot be finished on the server.
 *
 * A countdown depends on the moment it is read, and a timestamp should be shown
 * in the reader's own locale - both are wrong the second the HTML is cached.
 * Everything else about a record is rendered once, server-side, and arrives
 * done.
 */

const FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function remaining(target: Date): string {
  const ms = target.getTime() - Date.now();
  if (ms <= 0) return "истекло";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return days > 0
    ? `${days}д ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

let ticking: number | undefined;

export function hydrateWidgets(root: ParentNode): void {
  for (const node of root.querySelectorAll<HTMLTimeElement>("time.w-timestamp[datetime]")) {
    const at = new Date(node.dateTime);
    if (!Number.isNaN(at.getTime()) && node.textContent === node.dateTime) {
      node.textContent = FORMAT.format(at);
    }
  }

  const counters = [...root.querySelectorAll<HTMLElement>(".w-countdown[data-until]")]
    .map((node) => ({ node, until: new Date(node.dataset.until ?? "") }))
    .filter((entry) => !Number.isNaN(entry.until.getTime()));

  window.clearInterval(ticking);
  if (counters.length === 0) return;

  const tick = () => {
    for (const { node, until } of counters) {
      if (!node.isConnected) continue;
      node.textContent = remaining(until);
    }
  };
  tick();
  ticking = window.setInterval(tick, 1000);
}
