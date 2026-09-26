import { test } from "node:test";
import assert from "node:assert/strict";
import { botLang, mainKeyboard, parseStart, shopUrlFor, signInitData, verifyInitData, whichButton } from "../src/shop/telegram-logic";
import { defaultTexts } from "../src/site";

test("/start: вход, реферал, привязка; мусор и чужие команды", () => {
  assert.deepEqual(parseStart("/start"), { isStart: true, payload: null });
  assert.deepEqual(parseStart("/start login_Ab12-x"), { isStart: true, payload: { kind: "login", code: "Ab12-x" } });
  assert.deepEqual(parseStart("/start@HandymanShopOd_bot ref_OLYA2026"), { isStart: true, payload: { kind: "ref", code: "OLYA2026" } });
  assert.deepEqual(parseStart("/start hack"), { isStart: true, payload: null });
  assert.equal(parseStart("привет").isStart, false);
});

test("язык: сохранённый у клиента важнее языка Telegram; ru → русский, остальное → украинский", () => {
  assert.equal(botLang("RU", "uk"), "ru");
  assert.equal(botLang(null, "ru-RU"), "ru");
  assert.equal(botLang(null, "en"), "uk");
  assert.equal(botLang(undefined, undefined), "uk");
});

test("кнопки: номер — пока не подключён; «Магазин» — только с https-адресом сайта; нажатие узнаём на обоих языках", () => {
  const uk = defaultTexts("uk");
  const ru = defaultTexts("ru");
  const k1 = mainKeyboard(uk, { hasPhone: false, shopUrl: null });
  assert.equal(k1.keyboard.length, 2);
  assert.equal(k1.keyboard[0][0].request_contact, true);
  const k2 = mainKeyboard(uk, { hasPhone: true, shopUrl: "https://handyman.od.ua" });
  assert.deepEqual(k2.keyboard[0][0].web_app, { url: "https://handyman.od.ua" });
  assert.equal(shopUrlFor("http://localhost:3100", "uk"), null);
  assert.equal(shopUrlFor("https://handyman.od.ua/", "ru"), "https://handyman.od.ua/ru");
  assert.equal(whichButton(ru["bot.btn.orders"], [uk, ru]), "orders");
  assert.equal(whichButton("/help", [uk, ru]), "help");
  assert.equal(whichButton("есть круг 230?", [uk, ru]), null);
});

test("Mini App: подпись Telegram проверяется, подделка и устаревшие данные — отказ", () => {
  const token = "123456:TEST-token";
  const now = Date.UTC(2026, 8, 26, 12, 0, 0);
  const user = JSON.stringify({ id: 987654321, first_name: "Іван", language_code: "uk" });
  const good = signInitData({ auth_date: String(now / 1000 - 60), query_id: "AAA", user }, token);
  const r = verifyInitData(good, token, now);
  assert.ok(r.ok && r.user.id === 987654321);
  assert.equal(verifyInitData(good, "другой:токен", now).ok, false);
  assert.equal(verifyInitData(good.replace("987654321", "111111111"), token, now).ok, false, "подменили пользователя");
  const old = signInitData({ auth_date: String(now / 1000 - 2 * 86400), user }, token);
  assert.equal(verifyInitData(old, token, now).ok, false);
  assert.equal(verifyInitData("", token, now).ok, false);
});
