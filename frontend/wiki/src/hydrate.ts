/**
 * Виджеты, которые нельзя дорисовать на сервере.
 *
 * Обратный отсчёт зависит от минуты, в которую его читают, метку времени надо
 * показать в часовом поясе читателя, а спойлер открывается по щелчку — всё это
 * неверно ровно в тот момент, когда html попал в кеш. Остальное запись
 * получает готовым.
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
  /* Спойлер: щелчок или Enter открывает и больше не закрывает. Закрывать
     обратно незачем — прочитанное не развидеть, а мигающий текст мешает. */
  for (const node of root.querySelectorAll<HTMLElement>(".w-spoiler")) {
    if (node.dataset.bound === "1") continue;
    node.dataset.bound = "1";
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", "Показать скрытое");
    const open = () => {
      node.classList.add("open");
      node.removeAttribute("role");
      node.removeAttribute("aria-label");
    };
    node.addEventListener("click", open);
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  }

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
