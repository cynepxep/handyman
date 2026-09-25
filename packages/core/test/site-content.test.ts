import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPageBody, hasFillMarker, validateContactsForm, parseContacts, telHref, isContactsEmpty, EMPTY_CONTACTS } from "../src/site";

test("страница: абзацы, заголовки, списки, жирный, ссылки", () => {
  const html = renderPageBody("## Доставка\n\nПерший рядок\nдругий рядок\n\n- Нова Пошта\n- Кур’єр\n\n1. Оформіть\n2. Отримайте\n\nЦе **важливо** і [сайт](https://example.com/a?b=1&c=2).");
  assert.match(html, /<h2>Доставка<\/h2>/);
  assert.match(html, /<p>Перший рядок<br>другий рядок<\/p>/);
  assert.match(html, /<ul><li>Нова Пошта<\/li><li>Кур’єр<\/li><\/ul>/);
  assert.match(html, /<ol><li>Оформіть<\/li><li>Отримайте<\/li><\/ol>/);
  assert.match(html, /<strong>важливо<\/strong>/);
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener nofollow">сайт<\/a>/);
});

test("страница: HTML и скрипты вставить нельзя", () => {
  const html = renderPageBody('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[клік](javascript:alert(1))\n\n[a](https://x.com" onclick="alert(1))');
  assert.ok(!/<script/i.test(html) && !/<img/i.test(html), "теги экранируются");
  assert.ok(!/href="javascript/i.test(html), "javascript: не становится ссылкой");
  assert.ok(!/href="https:\/\/x\.com" onclick/i.test(html), "из атрибута не вырваться");
  assert.match(html, /&lt;script&gt;/);
});

test("страница: телефон, почта, мессенджер и свои адреса — можно, чужие протоколы — нет", () => {
  assert.match(renderPageBody("[звонок](tel:+380481234567)"), /href="tel:\+380481234567"/);
  assert.match(renderPageBody("[почта](mailto:a@b.co)"), /href="mailto:a@b\.co"/);
  assert.match(renderPageBody("[ми](/ru/contacts)"), /href="\/ru\/contacts"/);
  assert.ok(!/<a /.test(renderPageBody("[x](//evil.com)")), "адрес «//» не пропускаем");
  assert.ok(!/<a /.test(renderPageBody("[x](data:text/html;base64,AAAA)")));
});

test("страница: пустой текст и пометка «[заполнить]»", () => {
  assert.equal(renderPageBody(""), "");
  assert.equal(renderPageBody(null), "");
  assert.equal(hasFillMarker("Безкоштовно від [заполнить: сума] ₴"), true);
  assert.equal(hasFillMarker("Готовий текст"), false);
});

test("контакты: хорошая форма проходит, телефоны — по одному в строке", () => {
  const r = validateContactsForm({
    phones: "+380 48 123 45 67\n+380 (67) 111-22-33", email: "shop@example.com", addressUk: "Одеса, вул. Прикладна, 1", hoursUk: "Пн–Сб 9:00–18:00",
    telegram: "https://t.me/handyman", viber: "viber://chat?number=%2B380671112233", instagram: "https://instagram.com/handyman",
  });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.phones.length, 2);
    assert.equal(r.value.telegram, "https://t.me/handyman");
    assert.equal(r.value.addressRu, "");
  }
});

test("контакты: плохие телефон, почта и ссылки дают понятную ошибку", () => {
  const bad = (over: Record<string, string>) => validateContactsForm(over);
  const phone = bad({ phones: "звоните" });
  assert.ok(!phone.ok && /Телефон/.test(phone.error));
  const mail = bad({ email: "не почта" });
  assert.ok(!mail.ok && /E-mail/.test(mail.error));
  const link = bad({ instagram: "instagram.com/handyman" });
  assert.ok(!link.ok && /Instagram/.test(link.error) && /https:\/\//.test(link.error));
  const js = bad({ telegram: "javascript:alert(1)" });
  assert.ok(!js.ok);
  assert.ok(!bad({ phones: "1\n2\n3\n4\n5\n6".replace(/(\d)/g, "+38050000000$1") }).ok, "не больше пяти телефонов");
});

test("контакты: чтение из базы не падает на мусоре; пустое = заглушка", () => {
  assert.deepEqual(parseContacts(null), EMPTY_CONTACTS);
  assert.deepEqual(parseContacts("текст"), EMPTY_CONTACTS);
  assert.deepEqual(parseContacts({ phones: [1, "+380501112233", null] }).phones, ["+380501112233"]);
  assert.equal(isContactsEmpty(EMPTY_CONTACTS), true);
  assert.equal(isContactsEmpty({ ...EMPTY_CONTACTS, phones: ["+380501112233"] }), false);
});

test("телефон для ссылки tel:", () => {
  assert.equal(telHref("+380 (48) 123-45-67"), "tel:+380481234567");
  assert.equal(telHref("0481234567"), "tel:+0481234567");
});
