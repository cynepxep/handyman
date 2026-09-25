import { test } from "node:test";
import assert from "node:assert/strict";
import { bannerForGroup, bannerLive, listingSlots, parseBannerSettings, validateBannerForm } from "../src/site";

const base = { placement: "listing", titleUk: "Знижки на диски", href: "/catalog/dysky", active: "on" };

test("баннер: форма — понятные ошибки, опасные ссылки не проходят, разделы только существующие", () => {
  const ok = validateBannerForm({ ...base, everyN: "6", groups: ["disks", "чужое"], startsAt: "2026-10-01", endsAt: "2026-10-31" }, ["disks", "hand"]);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.settings.everyN, 6);
    assert.deepEqual(ok.value.settings.groups, ["disks"]);
    assert.equal(ok.value.name, "Знижки на диски", "название по умолчанию — заголовок");
    assert.equal(ok.value.content.theme, "light");
  }
  const bad = (over: Record<string, string>, re: RegExp) => {
    const r = validateBannerForm({ ...base, ...over }, []);
    assert.ok(!r.ok && re.test(r.error), JSON.stringify(r));
  };
  bad({ placement: "куда-то" }, /где показывать/);
  bad({ titleUk: "" }, /заголовок/i);
  bad({ href: "javascript:alert(1)" }, /Ссылка/);
  bad({ image: "http://example.com/a.jpg" }, /Картинка/);
  bad({ href: "", buttonUk: "Дивитись" }, /нет ссылки/);
  bad({ startsAt: "01.10.2026" }, /ГГГГ-ММ-ДД/);
  bad({ startsAt: "2026-10-10", endsAt: "2026-10-01" }, /раньше/);
  assert.equal(parseBannerSettings({ everyN: 2 }).everyN, 8, "слишком часто — берётся стандартное");
});

test("баннер: показывается только включённый и в свои даты (последний день — включительно)", () => {
  const now = new Date("2026-10-15T12:00:00");
  assert.equal(bannerLive({ active: true, startsAt: null, endsAt: null }, now), true);
  assert.equal(bannerLive({ active: false, startsAt: null, endsAt: null }, now), false);
  assert.equal(bannerLive({ active: true, startsAt: "2026-10-16T00:00:00", endsAt: null }, now), false, "ещё не начался");
  assert.equal(bannerLive({ active: true, startsAt: null, endsAt: "2026-10-15T00:00:00" }, now), true, "последний день");
  assert.equal(bannerLive({ active: true, startsAt: null, endsAt: "2026-10-14T00:00:00" }, now), false, "закончился");
});

test("баннер: плитки в списке — после каждых N товаров по очереди, не в самом конце; ограничение разделами", () => {
  const b = (id: string, everyN = 4, groups: string[] = []) => ({ id, settings: { everyN, groups } });
  const slots = listingSlots(12, [b("a"), b("b")]);
  assert.deepEqual(slots.map((s) => [s.after, s.banner.id]), [[3, "a"], [7, "b"]], "после 4-го и 8-го; после 12-го (конец) — нет");
  assert.deepEqual(listingSlots(3, [b("a")]), [], "мало товаров — без баннера");
  assert.deepEqual(listingSlots(10, []), []);
  assert.equal(bannerForGroup(b("x", 8, ["disks"]), "disks"), true);
  assert.equal(bannerForGroup(b("x", 8, ["disks"]), "hand"), false);
  assert.equal(bannerForGroup(b("x", 8, ["disks"]), null), false, "в поиске (без раздела) — только баннеры «везде»");
  assert.equal(bannerForGroup(b("x"), null), true);
});
