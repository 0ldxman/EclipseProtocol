/* Витрина: командная строка и мелкая интерактивность виджетов.
   Данные подставные — здесь важен вид и поведение, не источник. */

const ENTRIES = [
  { icon:"◆", name:"Кремень",              hint:"оперативник группы «Аполлон»",     cat:"персонаж",   kind:"запись" },
  { icon:"◆", name:"Протокол Аполлон",     hint:"полевая программа, 2029—2031",      cat:"операция",   kind:"запись" },
  { icon:"◇", name:"Тихий Полдень",        hint:"содержание закрыто",                cat:"допуск 3",   kind:"запись", locked:true },
  { icon:"◆", name:"Меридиан",             hint:"первый штаб протокола",             cat:"место",      kind:"запись" },
  { icon:"◆", name:"Орден Затмения",       hint:"раскол 2020 года",                  cat:"организация",kind:"запись" },
  { icon:"▸", name:"Падение Меридиана",    hint:"штаб оставлен за девять часов",     cat:"2022",       kind:"событие" },
  { icon:"▸", name:"Битва за Аркадию",     hint:"первое столкновение после договора",cat:"2024",       kind:"событие" },
  { icon:"▪", name:"персонажи",            hint:"14 записей",                        cat:"категория",  kind:"категория" },
  { icon:"▪", name:"операции",             hint:"9 записей, 2 закрыты",              cat:"категория",  kind:"категория" },
  { icon:"#", name:"пропавшие",            hint:"6 записей",                         cat:"метка",      kind:"метка" },
  { icon:"#", name:"первая эпоха",         hint:"11 записей",                        cat:"метка",      kind:"метка" },
  { icon:"›", name:"открыть карту",        hint:"переход в /map/",                   cat:"команда",    kind:"команда" },
  { icon:"›", name:"открыть хронологию",   hint:"переход в /timeline",               cat:"команда",    kind:"команда" },
  { icon:"›", name:"запросить допуск",     hint:"форма заявки",                      cat:"команда",    kind:"команда" },
];

const SCOPES = [
  { key:"все",       prefix:"",  test:() => true },
  { key:"записи",    prefix:"",  test:(e) => e.kind === "запись" },
  { key:"категории", prefix:"/", test:(e) => e.kind === "категория" },
  { key:"метки",     prefix:"#", test:(e) => e.kind === "метка" },
  { key:"события",   prefix:"@", test:(e) => e.kind === "событие" },
  { key:"команды",   prefix:">", test:(e) => e.kind === "команда" },
];

const escape = (s) => s.replace(/[&<>]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" })[c]);
const mark = (text, needle) => {
  if (!needle) return escape(text);
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return escape(text);
  return escape(text.slice(0, at)) + "<mark>" + escape(text.slice(at, at + needle.length)) + "</mark>"
       + escape(text.slice(at + needle.length));
};

export function palette(root) {
  const input = root.querySelector("#pal-q");
  const list = root.querySelector("#pal-list");
  const scopeBar = root.querySelector("#pal-scopes");
  let scope = 0, active = 0, shown = [];

  /* Приставка в начале строки сама переключает область поиска — так
     «#пропавшие» работает без мыши, а панель областей остаётся подсказкой. */
  const parse = () => {
    const raw = input.value;
    const found = SCOPES.findIndex((s) => s.prefix && raw.startsWith(s.prefix));
    if (found > 0) return { scope: found, query: raw.slice(1).trim().toLowerCase() };
    return { scope, query: raw.trim().toLowerCase() };
  };

  const draw = () => {
    const { scope: sc, query } = parse();
    shown = ENTRIES.filter((e) => SCOPES[sc].test(e))
                   .filter((e) => !query || e.name.toLowerCase().includes(query) || e.hint.toLowerCase().includes(query));
    active = Math.min(active, Math.max(0, shown.length - 1));

    scopeBar.querySelectorAll("span").forEach((el, i) => el.classList.toggle("on", i === sc));

    if (!shown.length) {
      list.innerHTML = `<div class="empty"><b>ничего не найдено</b>
        <span>Проверьте раскладку или сузьте запрос.<br>
        <code>#</code> — метки, <code>/</code> — категории, <code>&gt;</code> — команды.</span></div>`;
      return;
    }

    let html = "", group = "";
    shown.forEach((e, i) => {
      if (e.kind !== group) { group = e.kind; html += `<div class="pal__cap">${group}</div>`; }
      html += `<div class="pal__row${i === active ? " on" : ""}" data-i="${i}">
        <em>${e.icon}</em>
        <b>${mark(e.name, query)}</b>
        <q>${escape(e.hint)}</q>
        ${e.locked ? '<s class="lock">закрыто</s>' : `<s>${escape(e.cat)}</s>`}
      </div>`;
    });
    list.innerHTML = html;
  };

  const open = () => { root.setAttribute("open", ""); input.value = ""; active = 0; draw(); input.focus(); };
  const close = () => root.removeAttribute("open");

  root.addEventListener("click", (e) => { if (e.target === root) close(); });
  list.addEventListener("mousemove", (e) => {
    const row = e.target.closest(".pal__row");
    if (row && Number(row.dataset.i) !== active) { active = Number(row.dataset.i); draw(); }
  });
  input.addEventListener("input", () => { active = 0; draw(); });
  scopeBar.addEventListener("click", (e) => {
    const i = [...scopeBar.children].indexOf(e.target.closest("span"));
    if (i >= 0) { scope = i; input.value = ""; active = 0; draw(); input.focus(); }
  });

  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open(); return; }
    if (!root.hasAttribute("open")) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, shown.length - 1); draw(); }
    if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); draw(); }
  });

  document.querySelectorAll("[data-open-palette]").forEach((el) => el.addEventListener("click", open));
  draw();
}

/* :spoiler[…] — скрыто до щелчка, потому что это выбор читателя, а не допуск */
export function spoilers() {
  document.querySelectorAll(".w-spoiler").forEach((el) => {
    el.tabIndex = 0;
    const reveal = () => el.classList.add("open");
    el.addEventListener("click", reveal);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); reveal(); } });
  });
}
