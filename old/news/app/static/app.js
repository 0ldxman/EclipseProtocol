// Живой предпросмотр Discord-эмбеда в форме новости.
// Прогрессивное улучшение: при выключенном JS форма и серверный
// предпросмотр продолжают работать.
(function () {
  "use strict";

  var form = document.getElementById("news-form");
  var embed = document.getElementById("embed");
  if (!form || !embed) return;

  var el = {
    title: document.getElementById("pv-title"),
    desc: document.getElementById("pv-desc"),
    username: document.getElementById("pv-username"),
    avatar: document.getElementById("pv-avatar"),
    thumb: document.getElementById("pv-thumb"),
    image: document.getElementById("pv-image"),
    footer: document.getElementById("pv-footer"),
  };

  function field(name) {
    return form.querySelector('[name="' + name + '"]');
  }

  function setImage(node, url) {
    if (!node) return;
    if (url) {
      node.src = url;
      node.hidden = false;
    } else {
      node.removeAttribute("src");
      node.hidden = true;
    }
  }

  function selectedTagNames() {
    var names = [];
    var boxes = form.querySelectorAll('input[name="tags"]:checked');
    boxes.forEach(function (box) {
      var chip = box.parentElement.querySelector(".check__chip");
      if (chip) names.push(chip.textContent.trim());
    });
    return names;
  }

  function render() {
    var title = field("title").value.trim();
    var content = field("content").value;
    var username = field("username").value.trim();
    var color = field("color").value;

    el.title.textContent = title || "Заголовок новости";
    el.desc.textContent = content || "Текст появится здесь по мере набора.";
    el.username.textContent = username || "Вебхук";
    embed.style.setProperty("--edge", color);

    setImage(el.avatar, field("avatar_url").value.trim());
    setImage(el.thumb, field("thumbnail_url").value.trim());
    setImage(el.image, field("image_url").value.trim());

    var tags = selectedTagNames();
    if (tags.length) {
      el.footer.textContent = tags.join(" • ");
      el.footer.hidden = false;
    } else {
      el.footer.textContent = "";
      el.footer.hidden = true;
    }
  }

  form.addEventListener("input", render);
  form.addEventListener("change", render);
  render();
})();
