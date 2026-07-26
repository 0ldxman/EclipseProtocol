/* Витрина: командная строка и мелкая интерактивность виджетов.
   Данные подставные — здесь важен вид и поведение, не источник. */

const ENTRIES = [
  { icon:"◆", kind:"запись", name:"Кремень", cat:"персонаж", path:"архив / персонажи",
    txt:"Оперативник полевой группы «Аполлон». Последний подтверждённый контакт — апрель 2031 года, оперативный район Меридиан.",
    meta:{ "шифр":"AC/*0041", "ревизия":"12", "вх. ссылок":"3" }, clr:0 },
  { icon:"◆", kind:"запись", name:"Протокол Аполлон", cat:"операция", path:"архив / операции",
    txt:"Полевая программа протокола, 2029—2031. Шесть выходов за периметр, четыре подтверждённых возврата.",
    meta:{ "шифр":"AC/*0007", "ревизия":"31", "вх. ссылок":"9" }, clr:0 },
  { icon:"◇", kind:"запись", name:"Тихий Полдень", cat:"операция", path:"архив / операции",
    txt:"Тело записи закрыто. Открыты заголовок, структура и связи: три раздела, 1 842 знака, два вложения.",
    meta:{ "шифр":"AC/*0019", "требуется":"допуск 3" }, clr:3, locked:true },
  { icon:"◆", kind:"запись", name:"Меридиан", cat:"место", path:"архив / места",
    txt:"Первый штаб протокола. Оставлен 11 июля 2022 года за девять часов; опись вывезенного расходится в трёх отчётах.",
    meta:{ "шифр":"AC/*0031", "ревизия":"7", "на карте":"да" }, clr:0, shot:true },
  { icon:"◆", kind:"запись", name:"Орден Затмения", cat:"организация", path:"архив / организации",
    txt:"Отколовшаяся часть протокола, 2020 год. Двадцать девять человек ушли вместе с архивом первой эпохи.",
    meta:{ "шифр":"AC/*0055", "ревизия":"8" }, clr:0 },
  { icon:"▸", kind:"событие", name:"Падение Меридиана", cat:"2022", path:"хронология / эпоха III",
    txt:"11.07.2022 — штаб оставлен за девять часов. Событие открывает третью эпоху.",
    meta:{ "эпоха":"Разлом", "записей":"4" }, clr:0 },
  { icon:"▸", kind:"событие", name:"Битва за Аркадию", cat:"2024", path:"хронология / эпоха III",
    txt:"02.06.2024 — первое прямое столкновение после договора. Обе стороны называют его оборонительным.",
    meta:{ "эпоха":"Разлом", "записей":"6" }, clr:0 },
  { icon:"▪", kind:"категория", name:"персонажи", cat:"14 записей", path:"архив",
    txt:"Люди протокола и вокруг него: оперативники, кураторы, отколовшиеся. Две записи под грифом.",
    meta:{ "записей":"14", "под грифом":"2" }, clr:0 },
  { icon:"▪", kind:"категория", name:"операции", cat:"9 записей", path:"архив",
    txt:"Полевые программы и отдельные выходы. У категории есть титульный лист.",
    meta:{ "записей":"9", "под грифом":"2" }, clr:0 },
  { icon:"#", kind:"метка", name:"пропавшие", cat:"6 записей", path:"метки",
    txt:"Записи о тех, чья судьба не подтверждена. Метка живёт поперёк категорий.",
    meta:{ "записей":"6" }, clr:0 },
  { icon:"#", kind:"метка", name:"меридиан", cat:"9 записей", path:"метки",
    txt:"Всё, что связано с первым штабом: люди, операции, само место.",
    meta:{ "записей":"9" }, clr:0 },
  { icon:"›", kind:"команда", name:"открыть карту", cat:"переход", path:"/map/",
    txt:"Границы на любую дату из хронологии. 214 провинций, арочная топология.",
    meta:{ "клавиша":"G затем M" }, clr:0, shot:true },
  { icon:"›", kind:"команда", name:"открыть хронологию", cat:"переход", path:"/timeline",
    txt:"Одиннадцать событий, три эпохи — от сигнала «Эфир» до сегодняшнего дня.",
    meta:{ "клавиша":"G затем T" }, clr:0 },
  { icon:"›", kind:"команда", name:"запросить допуск", cat:"действие", path:"форма",
    txt:"Заявка на повышение уровня. Уходит тому, кто ведёт архив.",
    meta:{ "ваш уровень":"0" }, clr:0 },
];

const SCOPES = [
  { key:"все",       prefix:"",  test:() => true },
  { key:"записи",    prefix:"",  test:(e) => e.kind === "запись" },
  { key:"категории", prefix:"/", test:(e) => e.kind === "категория" },
  { key:"метки",     prefix:"#", test:(e) => e.kind === "метка" },
  { key:"события",   prefix:"@", test:(e) => e.kind === "событие" },
  { key:"команды",   prefix:">", test:(e) => e.kind === "команда" },
];

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" })[c]);
const hit = (text, needle) => {
  if (!needle) return esc(text);
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return esc(text);
  return esc(text.slice(0, at)) + "<mark>" + esc(text.slice(at, at + needle.length)) + "</mark>"
       + esc(text.slice(at + needle.length));
};
const clrDots = (level) =>
  `<span class="clr">${Array.from({ length:5 }, (_, i) =>
    `<i${i < Math.max(level, 1) ? ' class="on"' : ""}></i>`).join("")}</span>`;

export function palette(root) {
  const input = root.querySelector("#pal-q");
  const list = root.querySelector("#pal-list");
  const prev = root.querySelector("#pal-prev");
  const scopeBar = root.querySelector("#pal-scopes");
  let scope = 0, active = 0, shown = [];

  /* Приставка в начале строки сама переключает область — так «#пропавшие»
     работает без мыши, а панель областей остаётся подсказкой, не пультом. */
  const parse = () => {
    const raw = input.value;
    const found = SCOPES.findIndex((s) => s.prefix && raw.startsWith(s.prefix));
    if (found > 0) return { scope: found, query: raw.slice(1).trim().toLowerCase() };
    return { scope, query: raw.trim().toLowerCase() };
  };

  const drawPreview = (e, query) => {
    if (!e) {
      prev.innerHTML = `<div class="kind">разворот</div>
        <p class="txt" style="margin-top:13px">Выберите строку слева — здесь появится отрывок,
        путь и допуск, чтобы не открывать запись ради проверки.</p>`;
      return;
    }
    const meta = Object.entries(e.meta)
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
    prev.innerHTML =
      `<div class="kind">${esc(e.kind)}${e.locked ? " · закрыто" : ""}</div>
       <h4>${esc(e.name)}</h4>
       <div class="path">${esc(e.path)}</div>
       <hr>
       ${e.shot ? '<div class="shot"></div>' : ""}
       <div class="txt">${hit(e.txt, query)}</div>
       <div class="meta">
         <dl class="kv">${meta}
           <dt>допуск</dt><dd>${clrDots(e.clr)}</dd>
         </dl>
       </div>`;
  };

  const draw = () => {
    const { scope: sc, query } = parse();
    shown = ENTRIES.filter((e) => SCOPES[sc].test(e))
                   .filter((e) => !query || e.name.toLowerCase().includes(query) || e.txt.toLowerCase().includes(query));
    active = Math.min(active, Math.max(0, shown.length - 1));
    [...scopeBar.children].forEach((el, i) => el.classList.toggle("on", i === sc));

    if (!shown.length) {
      list.innerHTML = `<div class="empty"><b>ничего не найдено</b>
        <span>Проверьте раскладку или сузьте запрос.<br>
        <code>#</code> — метки, <code>/</code> — категории, <code>&gt;</code> — команды.</span></div>`;
      drawPreview(null);
      return;
    }

    let html = "", group = "";
    shown.forEach((e, i) => {
      if (e.kind !== group) { group = e.kind; html += `<div class="pal__cap">${group}</div>`; }
      html += `<div class="pal__row${i === active ? " on" : ""}" data-i="${i}">
        <em>${e.icon}</em><b>${hit(e.name, query)}</b>
        ${e.locked ? '<s class="lock">закрыто</s>' : `<s>${esc(e.cat)}</s>`}
      </div>`;
    });
    list.innerHTML = html;
    drawPreview(shown[active], query);
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
    if (e.key === "Tab") {                      /* ⇥ перебирает области поиска */
      e.preventDefault();
      scope = (scope + (e.shiftKey ? SCOPES.length - 1 : 1)) % SCOPES.length;
      input.value = ""; active = 0; draw();
    }
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
