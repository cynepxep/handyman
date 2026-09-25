import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderPageBody, hasFillMarker, validateContactsForm, parseContacts, telHref, isContactsEmpty, messengerLink, EMPTY_CONTACTS,
  scheduleText, parseScheduleForm, parseSchedule, DEFAULT_WEEK, DAY_KEYS, TIME_OPTIONS, type DayHours, type WeekSchedule,
} from "../src/site";

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
  assert.equal(telHref("0933662407"), "tel:+380933662407", "местный номер с 0 — добавляется код Украины");
  assert.equal(telHref("093 366-24-07"), "tel:+380933662407");
  assert.equal(telHref("380933662407"), "tel:+380933662407");
});

test("контакты: Viber и Telegram можно вписать номером или @именем — ссылка делается сама", () => {
  assert.equal(messengerLink("viber", "093 366 24 07"), "viber://chat?number=%2B380933662407");
  assert.equal(messengerLink("viber", "+380 (93) 366-24-07"), "viber://chat?number=%2B380933662407");
  assert.equal(messengerLink("telegram", "@handyman_odesa"), "https://t.me/handyman_odesa");
  assert.equal(messengerLink("telegram", "t.me/handyman_odesa"), "https://t.me/handyman_odesa");
  assert.equal(messengerLink("telegram", "+380933662407"), "https://t.me/+380933662407");
  assert.equal(messengerLink("telegram", "https://t.me/handyman"), "https://t.me/handyman");
  assert.equal(messengerLink("viber", "@handyman"), null, "у Viber нет @имён");
  assert.equal(messengerLink("telegram", "viber://chat?number=1"), null);
  const r = validateContactsForm({ viber: "0933662407", telegram: "@handyman_odesa" });
  assert.ok(r.ok && r.value.viber.startsWith("viber://") && r.value.telegram === "https://t.me/handyman_odesa");
  const bad = validateContactsForm({ viber: "мій вайбер" });
  assert.ok(!bad.ok && /Viber/.test(bad.error));
});

test("график: дни с одинаковым временем склеиваются, выходные подписаны, два языка, примечание", () => {
  const w = (days: DayHours[], noteUk = "", noteRu = ""): WeekSchedule => ({ days, noteUk, noteRu });
  const work = { from: "09:00", to: "18:00" };
  const s = w([work, work, work, work, work, { from: "10:00", to: "15:00" }, { off: true }], "перерва 13:00–14:00");
  assert.equal(scheduleText(s, "uk"), "Пн–Пт 9:00–18:00, Сб 10:00–15:00, Нд — вихідний. перерва 13:00–14:00");
  assert.equal(scheduleText(s, "ru"), "Пн–Пт 9:00–18:00, Сб 10:00–15:00, Вс — выходной. перерва 13:00–14:00", "нет русского примечания — берётся украинское");
  assert.equal(scheduleText(w([...Array(5).fill(work), { off: true }, { off: true }]), "uk"), "Пн–Пт 9:00–18:00, Сб, Нд — вихідний");
  assert.equal(scheduleText(w(Array(7).fill({ off: true })), "uk"), "");
  assert.equal(scheduleText(DEFAULT_WEEK, "ru"), "Пн–Сб 9:00–18:00, Вс — выходной");
});

test("график: форма админки — выходной, неправильное время, мусор из базы", () => {
  const f: Record<string, string> = {};
  for (const d of DAY_KEYS) Object.assign(f, { [`h.${d}.from`]: "09:00", [`h.${d}.to`]: "18:00" });
  f["h.sun.off"] = "on";
  const r = parseScheduleForm(f);
  assert.ok(r.ok && r.value.days[6].off === true && !r.value.days[0].off);
  const bad = parseScheduleForm({ ...f, "h.mon.to": "08:00" });
  assert.ok(!bad.ok && /Понедельник/.test(bad.error));
  assert.ok(!parseScheduleForm({ ...f, "h.tue.from": "25:00" }).ok);
  assert.equal(parseSchedule({ days: [1, 2] }), null);
  assert.equal(parseSchedule(null), null);
  assert.deepEqual(parseSchedule(r.ok ? r.value : null), r.ok ? r.value : null);
  // контакты: график из формы превращается в текст на сайте
  const c = validateContactsForm(f);
  assert.ok(c.ok && c.value.hoursUk === "Пн–Сб 9:00–18:00, Нд — вихідний" && c.value.schedule?.days.length === 7);
  assert.ok(TIME_OPTIONS.includes("09:30") && TIME_OPTIONS[0] === "06:00");
});
