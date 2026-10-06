import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BRAND_ALL, brandKey, brandParam, brandScope, brandSwitchOptions, listingQuery, parseBrandChoice, parseListing, parseHomeSettings, validateHomeForm,
} from "../src/site";

const brands = ["Milwaukee", "Vitals", "Black & Decker"];

test("основной бренд: код для адреса и разбор выбора покупателя", () => {
  assert.equal(brandKey("Milwaukee"), "milwaukee");
  assert.equal(brandKey("Black & Decker"), "black-decker");
  assert.equal(brandKey("Інтерскол"), "інтерскол");
  assert.deepEqual(parseBrandChoice(undefined, "Milwaukee", brands), { mode: "focus" });
  assert.deepEqual(parseBrandChoice("milwaukee", "Milwaukee", brands), { mode: "focus" });
  assert.deepEqual(parseBrandChoice("VITALS", "Milwaukee", brands), { mode: "brand", brand: "Vitals" });
  assert.deepEqual(parseBrandChoice(BRAND_ALL, "Milwaukee", brands), { mode: "all" });
  assert.deepEqual(parseBrandChoice("makita", "Milwaukee", brands), { mode: "focus" }, "незнакомый бренд — основной");
});

test("основной бренд: фильтр поиска и адрес", () => {
  assert.deepEqual(brandScope({ mode: "focus" }, "Milwaukee"), { brands: ["Milwaukee"], orLocal: true });
  assert.deepEqual(brandScope({ mode: "brand", brand: "Vitals" }, "Milwaukee"), { brands: ["Vitals"], orLocal: false });
  assert.equal(brandScope({ mode: "all" }, "Milwaukee"), null);
  assert.equal(brandParam({ mode: "focus" }), undefined);
  assert.equal(brandParam({ mode: "brand", brand: "Vitals" }), "vitals");
  // ?b= разбирается и пишется обратно в адрес
  const s = parseListing(new URLSearchParams("b=Vitals&avail=1"), []);
  assert.equal(s.brand, "vitals");
  assert.equal(listingQuery(s), "?avail=1&b=vitals");
  assert.equal(parseListing(new URLSearchParams("b=<script>"), []).brand, undefined);
});

test("переключатель: основной, другие бренды списка по убыванию, «Усі»; других нет — не нужен", () => {
  const o = brandSwitchOptions("Milwaukee", { mode: "focus" }, { Milwaukee: 40, Vitals: 3, "Black & Decker": 7, Bosch: 0 });
  assert.deepEqual(o.map((x) => [x.key, x.current]), [["milwaukee", true], ["black-decker", false], ["vitals", false], [BRAND_ALL, false]]);
  assert.equal(o.at(-1)!.label, null, "подпись «Усі» — из текстов витрины");
  assert.deepEqual(brandSwitchOptions("Milwaukee", { mode: "focus" }, { Milwaukee: 40 }), []);
  const chosen = brandSwitchOptions("Milwaukee", { mode: "brand", brand: "Vitals" }, { Milwaukee: 4 });
  assert.deepEqual(chosen.map((x) => [x.key, x.current]), [["milwaukee", false], ["vitals", true], [BRAND_ALL, false]], "выбранный бренд виден, даже если здесь его нет");
});

test("главная: основной бренд по умолчанию Milwaukee, пусто — выключено, форма его сохраняет", () => {
  assert.equal(parseHomeSettings({}).focusBrand, "Milwaukee");
  assert.equal(parseHomeSettings({ focusBrand: "" }).focusBrand, "");
  assert.equal(parseHomeSettings({ focusBrand: "  Vitals " }).focusBrand, "Vitals");
  const r = validateHomeForm({ "focus.brand": "" });
  assert.ok(r.ok && r.value.focusBrand === "");
  const d = validateHomeForm({});
  assert.ok(d.ok && d.value.focusBrand === "Milwaukee");
});
