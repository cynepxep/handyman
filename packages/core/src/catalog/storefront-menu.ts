// Меню витрины на языке покупателя. Это слой НАД категориями поставщика: сами категории и импорт не меняются.
// Группа меню = набор «подгрупп»; подгруппа = набор категорий из базы (по коду). Чистая логика, без базы.
//
// Состав групп — гипотеза по данным Vitals (Этап 2, шаг 2.2), владелец правит её на экране.
// Позже (шаг 2.9) те же данные переедут в базу и будут правиться в админке.

import { extractFacets, FACET_DEFS } from "./facets";
import type { FeedParam } from "./feed-parse";

export type MenuSub = {
  id: string;
  nameUk: string;
  nameRu: string;
  /** Категории вместе со всеми вложенными. */
  categoryIds: string[];
  /** Категории только сами по себе (без вложенных): товары, лежащие прямо в корне («Аксесуари»). */
  ownIds?: string[];
};

export type MenuGroup = {
  id: string;
  nameUk: string;
  nameRu: string;
  /** Короткая подсказка под названием в меню. */
  hintUk: string;
  hintRu: string;
  subs: MenuSub[];
  /** Кандидаты в «быстрый выбор размера» (коды фильтров из FACET_DEFS): берётся первый, у которого ≥ 2 значений. */
  quickPick: string[];
  /** Какие характеристики показывать в карточке списка (по приоритету); по умолчанию — DEFAULT_SPEC_ORDER. */
  specs?: string[];
};

export type Task = {
  id: string;
  nameUk: string;
  nameRu: string;
  hintUk: string;
  hintRu: string;
  categoryIds: string[];
  ownIds?: string[];
  /** Значок (имя в интерфейсе). */
  icon: string;
};

const sub = (id: string, nameUk: string, nameRu: string, categoryIds: string[], ownIds?: string[]): MenuSub => ({ id, nameUk, nameRu, categoryIds, ownIds });

export const MENU_GROUPS: MenuGroup[] = [
  {
    id: "drills", nameUk: "Свердла, бури, коронки", nameRu: "Сверла, буры, коронки",
    hintUk: "по металу, дереву, бетону, склу", hintRu: "по металлу, дереву, бетону, стеклу",
    quickPick: ["drillDiameter", "diameter"],
    subs: [
      sub("drills-metal", "Свердла по металу", "Сверла по металлу", ["acc-sverdla-po-metalu", "acc-sverdla-po-metalu-stupinchasti"]),
      sub("drills-wood", "Свердла по деревині", "Сверла по дереву", ["acc-sverdla-po-derevyni-pir-yani"]),
      sub("drills-glass", "Свердла по склу та плитці", "Сверла по стеклу и плитке", ["acc-sverdla-pikopodibni-po-sklu-ta-plyttsi"]),
      sub("drills-concrete", "Бури та свердла по бетону", "Буры и сверла по бетону", ["acc-bury-po-betonu", "acc-sverdla-po-betonu"]),
      sub("drills-crowns", "Коронки", "Коронки", ["acc-koronky-po-betonu"]),
      sub("drills-sets", "Набори свердл і бурів", "Наборы сверл и буров", ["acc-nabory-sverdl", "acc-nabory-buriv"]),
    ],
  },
  {
    id: "discs", nameUk: "Диски та круги", nameRu: "Диски и круги",
    hintUk: "відрізні, шліфувальні, алмазні, пильні", hintRu: "отрезные, шлифовальные, алмазные, пильные",
    quickPick: ["diameter"],
    subs: [
      sub("discs-cut", "Відрізні по металу", "Отрезные по металлу", ["acc-dysky-vidrizni-po-metalu"]),
      sub("discs-grind", "Зачисні та шліфувальні круги", "Зачистные и шлифовальные круги", ["acc-dysky-zachysni-po-metalu", "acc-kruhy-shlifuvalni", "acc-kruhy-pelyustkovi-tortsevi"]),
      sub("discs-diamond", "Алмазні диски", "Алмазные диски", ["acc-dysky-almazni"]),
      sub("discs-saw", "Пильні диски", "Пильные диски", ["acc-dysky-pylni"]),
      sub("discs-universal", "Універсальні диски", "Универсальные диски", ["acc-dysky-universalni"]),
      sub("discs-brush", "Щітки з металу", "Щётки из металла", ["acc-shchitky-z-metalu"]),
      sub("discs-belt", "Шліфувальна стрічка та сітка", "Шлифовальная лента и сетка", ["acc-strichka-shlifuvalna", "acc-sitka-abrazyvna", "acc-terky-dlya-shlifuvannya"]),
    ],
  },
  {
    id: "cordless", nameUk: "Акумуляторний інструмент", nameRu: "Аккумуляторный инструмент",
    hintUk: "оберіть свою батарею", hintRu: "выберите свою батарею",
    quickPick: ["series"], specs: ["voltage", "power", "series"],
    subs: [
      sub("cordless-tools", "Інструмент", "Инструмент", ["ak-seriya-m-type-18-elektroinstrument", "ak-seriya-m-type-12-elektroinstrument", "ak-seriya-smartline-elektroinstrument"], ["ak"]),
      sub("cordless-garden", "Садова техніка", "Садовая техника", ["ak-seriya-m-type-18-sadovo-parkova-tekhnika", "ak-seriya-m-type-12-sadovo-parkova-tekhnika", "ak-seriya-smartline-sadovo-parkova-tekhnika"]),
      sub("cordless-batteries", "Акумулятори", "Аккумуляторы", ["ak-seriya-m-type-18-akumulyatory", "ak-seriya-m-type-12-akumulyatory", "ak-seriya-smartline-akumulyatory-ta-zaryadni-prystroyi"]),
      sub("cordless-chargers", "Зарядні пристрої", "Зарядные устройства", ["ak-seriya-m-type-18-zaryadni-prystroyi", "ak-seriya-m-type-12-zaryadni-prystroyi"]),
      sub("cordless-other", "Кейси та інше", "Кейсы и прочее", ["ak-seriya-smartline-keysy", "ak-seriya-smartline-portatyvni-akustychni-systemy"]),
    ],
  },
  {
    id: "corded", nameUk: "Електроінструмент від мережі", nameRu: "Электроинструмент от сети",
    hintUk: "болгарки, перфоратори, пили, рубанки", hintRu: "болгарки, перфораторы, пилы, рубанки",
    quickPick: ["power", "voltage"], specs: ["power", "voltage", "diameter"],
    subs: [
      sub("corded-grind", "Болгарки та шліфмашини", "Болгарки и шлифмашины", ["el-kutovi-shlifuvalni-mashyny", "el-shlifuvalnyy-instrument", "el-shlifuvalni-mashyny-dlya-stin-ta-steli", "el-poliruvalna-mashyna"]),
      sub("corded-drill", "Перфоратори, дрилі, молотки", "Перфораторы, дрели, молотки", ["el-perforatory", "el-dryli", "el-bidbiyni-molotky"]),
      sub("corded-saws", "Пили та лобзики", "Пилы и лобзики", ["el-pyly-vidrizni", "el-pyly-tortsyuvalni", "el-pyly-tsyrkulyarni", "el-pyly-shabelni", "el-lobzyky"]),
      sub("corded-plane", "Рубанки та фрезери", "Рубанки и фрезеры", ["el-rubanky", "el-frezer"]),
      sub("corded-wrench", "Гайкокрути та гравери", "Гайковёрты и граверы", ["el-haykokruty-ta-hvyntokruty-merezhevi", "el-hravery"]),
      sub("corded-machines", "Верстати та заточування", "Станки и заточка", ["el-verstaty-dlya-zatochuvannya-sverdel", "el-verstaty-sverdlylni"]),
      sub("corded-build", "Будівельні: фени, міксери, плиткорізи", "Строительные: фены, миксеры, плиткорезы", ["el-budivelni-miksery", "el-feny-budivelni", "el-pylososy-budivelni", "el-plytkorizy", "el-farbopulty", "el-payalnyky-dlya-plastykovykh-trub"]),
    ],
  },
  {
    id: "hand", nameUk: "Ручний інструмент", nameRu: "Ручной инструмент",
    hintUk: "викрутки, ключі, плоскогубці, молотки", hintRu: "отвёртки, ключи, плоскогубцы, молотки",
    quickPick: ["shank", "slot", "length"], specs: ["length", "slot", "shank", "material"],
    subs: [
      sub("hand-screw", "Викрутки, біти, шестигранники", "Отвёртки, биты, шестигранники", ["hand-slyusarno-stolyarnyy-instrument-vykrutky-ta-nabory-vykrutok", "hand-slyusarno-stolyarnyy-instrument-bity-ta-trymachi", "hand-slyusarno-stolyarnyy-instrument-nabory-bit", "hand-slyusarno-stolyarnyy-instrument-nabir-shestyhrannykh-klyuchiv"]),
      sub("hand-wrench", "Ключі, головки, набори", "Ключи, головки, наборы", ["hand-slyusarno-stolyarnyy-instrument-klyuchi-rozvidni", "hand-slyusarno-stolyarnyy-instrument-klyuchi-trubni", "hand-slyusarno-stolyarnyy-instrument-nabory-holovok-tortsevykh", "hand-avtomobilnyy-instrument"]),
      sub("hand-pliers", "Плоскогубці, кусачки, ножиці", "Плоскогубцы, кусачки, ножницы", ["hand-slyusarno-stolyarnyy-instrument-ploskohubtsi", "hand-slyusarno-stolyarnyy-instrument-dovhohubtsi", "hand-slyusarno-stolyarnyy-instrument-bokorizy", "hand-slyusarno-stolyarnyy-instrument-klishchi-zatyskni", "hand-slyusarno-stolyarnyy-instrument-klishchi-perestavni", "hand-slyusarno-stolyarnyy-instrument-strypery", "hand-slyusarno-stolyarnyy-instrument-kabelerizy", "hand-slyusarno-stolyarnyy-instrument-truborizy", "hand-slyusarno-stolyarnyy-instrument-nozhytsi-po-metalu", "hand-slyusarno-stolyarnyy-instrument-nozhytsi"]),
      sub("hand-saws", "Ножівки та полотна", "Ножовки и полотна", ["hand-slyusarno-stolyarnyy-instrument-nozhivky", "hand-slyusarno-stolyarnyy-instrument-pylyalni-polotna"]),
      sub("hand-hammers", "Молотки, стамески, напилки", "Молотки, стамески, напильники", ["hand-slyusarno-stolyarnyy-instrument-molotky", "hand-slyusarno-stolyarnyy-instrument-kyyanky", "hand-slyusarno-stolyarnyy-instrument-kuvaldy", "hand-slyusarno-stolyarnyy-instrument-stamesky", "hand-slyusarno-stolyarnyy-instrument-napylky", "acc-zubyla"]),
      sub("hand-clamps", "Струбцини та лещата", "Струбцины и тиски", ["hand-slyusarno-stolyarnyy-instrument-strubtsyny", "hand-slyusarno-stolyarnyy-instrument-leshchata"]),
      sub("hand-fasten", "Кріпильний інструмент", "Крепёжный инструмент", ["hand-kripylnyy-instrument"]),
      sub("hand-finish", "Будівельно-оздоблювальний", "Строительно-отделочный", ["hand-budivelno-ozdoblyuvalnyy-instrument"]),
      sub("hand-storage", "Ящики та органайзери", "Ящики и органайзеры", ["hand-transportuvannya-ta-zberihannya"]),
    ],
  },
  {
    id: "measure", nameUk: "Вимірювання та лазери", nameRu: "Измерения и лазеры",
    hintUk: "рівні, рулетки, лазерні рівні", hintRu: "уровни, рулетки, лазерные уровни",
    quickPick: ["length"], specs: ["length"],
    subs: [
      sub("measure-levels", "Будівельні рівні", "Строительные уровни", ["hand-vymiryuvalnyy-instrument-budivelni-rivni"]),
      sub("measure-tapes", "Рулетки", "Рулетки", ["hand-vymiryuvalnyy-instrument-budivelni-ruletky"]),
      sub("measure-laser", "Лазерні рівні та приймачі", "Лазерные уровни и приёмники", ["lazerna-tekhnika-lazerni-rivni", "lazerna-tekhnika-pryymach-dlya-lazernoho-rivnya"]),
      sub("measure-range", "Лазерні далекоміри", "Лазерные дальномеры", ["lazerna-tekhnika-lazerni-dalekomiry"]),
    ],
  },
  {
    id: "garden", nameUk: "Сад і город", nameRu: "Сад и огород",
    hintUk: "мотокоси, пили, мийки, полив, запчастини", hintRu: "мотокосы, пилы, мойки, полив, запчасти",
    quickPick: ["engine", "fuel", "power"], specs: ["power", "engine", "length"],
    subs: [
      sub("garden-trimmers", "Мотокоси та тримери", "Мотокосы и триммеры", ["gr-motokosy", "gr-elektrokosy", "gr-trymery-elektrychni", "gr-kushchorizy-benzynovi", "gr-vysotoriz-elektrychnyy"]),
      sub("garden-saws", "Пили, дровоколи, подрібнювачі", "Пилы, дровоколы, измельчители", ["gr-benzopyly-lantsyuhovi", "gr-elektropylky-lantsyuhovi", "gr-verstaty-dlya-zatochuvannya-lantsyuhiv", "gr-drovokoly", "gr-hilkopodribnyuvachi"]),
      sub("garden-mowers", "Газонокосарки", "Газонокосилки", ["gr-hazonokosarky"]),
      sub("garden-wash", "Мийки та обприскувачі", "Мойки и опрыскиватели", ["gr-myyky-vysokoho-tysku", "gr-obpryskuvachi"]),
      sub("garden-blowers", "Повітродувки, пилососи, мотобури", "Воздуходувки, пылесосы, мотобуры", ["gr-povitroduvky", "gr-pylososy-sadovi", "gr-motobury"]),
      sub("garden-water", "Полив і шланги", "Полив и шланги", ["hand-sadovyy-ruchnyy-instrument-shlanhy-dlya-polyvu", "hand-sadovyy-ruchnyy-instrument-doshchuvachi-dlya-polyvu", "hand-sadovyy-ruchnyy-instrument-konektory-perekhidnyky", "hand-sadovyy-ruchnyy-instrument-vizky-ta-napryamni-dlya-shlanhiv"]),
      sub("garden-hand", "Ручний садовий інструмент", "Ручной садовый инструмент", ["hand-sadovyy-ruchnyy-instrument-sekatory", "hand-sadovyy-ruchnyy-instrument-hilkorizy-nozhytsi-dlya-zhyvoyi-ohorozhi", "hand-sadovyy-ruchnyy-instrument-lopaty", "hand-sadovyy-ruchnyy-instrument-pyly-sadovi", "hand-sadovyy-ruchnyy-instrument-sokyry-ta-koluny", "hand-sadovyy-ruchnyy-instrument-vysotorizy-plodozbirnyky"]),
      sub("garden-parts", "Запчастини та витратні: волосінь, ланцюги, шини", "Запчасти и расходники: леска, цепи, шины", [], ["acc"]),
    ],
  },
  {
    id: "power", nameUk: "Генератори, двигуни, компресори", nameRu: "Генераторы, двигатели, компрессоры",
    hintUk: "енергія на об’єкті і на дачі", hintRu: "энергия на объекте и на даче",
    quickPick: ["power", "fuel"], specs: ["power", "fuel", "engine"],
    subs: [
      sub("power-gen", "Генератори", "Генераторы", ["pw-heneratory"]),
      sub("power-engines", "Двигуни", "Двигатели", ["pw-dvyhuny"], ["pw"]),
      sub("power-compr", "Компресори", "Компрессоры", ["pw-kompresory"]),
      sub("power-pumps", "Мотопомпи", "Мотопомпы", ["pw-motopompy"]),
      sub("power-backup", "Стабілізатори, ДБЖ, акумулятори", "Стабилизаторы, ИБП, аккумуляторы", ["pw-stabilizatory-napruhy", "pw-dzherela-bezperebiynoho-zhyvlennya", "pw-akumulyatory-dlya-dbzh-ta-invertoriv", "pw-zaryadni-ta-pusko-zaryadni-prystroyi", "pw-portatyvni-akumulyatorni-stantsiyi"]),
    ],
  },
  {
    id: "welding", nameUk: "Зварювання", nameRu: "Сварка",
    hintUk: "апарати, електроди, маски", hintRu: "аппараты, электроды, маски",
    quickPick: ["power"], specs: ["power", "voltage"],
    subs: [
      sub("weld-machines", "Зварювальні апарати", "Сварочные аппараты", ["zvaryuvalne-obladnannya-zvaryuvalni-aparaty"]),
      sub("weld-electrodes", "Електроди", "Электроды", ["zvaryuvalne-obladnannya-zvaryuvalni-elektrody"]),
      sub("weld-masks", "Маски зварника", "Маски сварщика", ["zvaryuvalne-obladnannya-masky-zvarnyka"]),
      sub("weld-accessories", "Тримачі, маса, магніти", "Держаки, масса, магниты", ["zvaryuvalne-obladnannya-zvaryuvalni-trymachi-ta-masa", "zvaryuvalne-obladnannya-zvaryuvalni-mahnity"]),
    ],
  },
  {
    id: "building", nameUk: "Будівельне обладнання", nameRu: "Строительное оборудование",
    hintUk: "віброплити, бетонозмішувачі, тачки", hintRu: "виброплиты, бетономешалки, тачки",
    quickPick: ["power"], specs: ["power", "engine"],
    subs: [
      sub("build-vibro", "Віброплити, віброрейки, вібротрамбовки", "Виброплиты, виброрейки, вибротрамбовки", ["bld-vibroplyty", "bld-vibroreyky", "bld-vibrotrambovky"]),
      sub("build-mixers", "Бетонозмішувачі та затиральні машини", "Бетономешалки и затирочные машины", ["bld-betonozmishuvachi", "bld-zatyralni-mashyny"]),
      sub("build-other", "Тачки та бензорізи", "Тачки и бензорезы", ["bld-tachky-sadovo-budivelni", "bld-benzorizy"]),
    ],
  },
  {
    id: "heating", nameUk: "Обігрівачі", nameRu: "Обогреватели",
    hintUk: "електричні, газові, дизельні", hintRu: "электрические, газовые, дизельные",
    quickPick: ["power", "fuel"], specs: ["power", "fuel"],
    subs: [
      sub("heat-electric", "Електричні", "Электрические", ["obihrivachi-elektroobihrivachi", "obihrivachi-promyslovi-obihrivachi-obihrivachi-elektrychni"]),
      sub("heat-gas", "Газові", "Газовые", ["obihrivachi-promyslovi-obihrivachi-obihrivachi-hazovi"]),
      sub("heat-diesel", "Дизельні", "Дизельные", ["obihrivachi-promyslovi-obihrivachi-obihrivachi-dyzelni"]),
    ],
  },
  {
    id: "oils", nameUk: "Оливи та мастила", nameRu: "Масла и смазки",
    hintUk: "для двигунів, ланцюгів, компресорів", hintRu: "для двигателей, цепей, компрессоров",
    quickPick: [], specs: [],
    subs: [sub("oils-all", "Технічні оливи", "Технические масла", [], ["tekhnichni-olyvy"])],
  },
];

export const TASKS: Task[] = [
  { id: "cut", nameUk: "Різати метал", nameRu: "Резать металл", hintUk: "відрізні диски, ножиці по металу", hintRu: "отрезные диски, ножницы по металлу", icon: "cut", categoryIds: ["acc-dysky-vidrizni-po-metalu", "hand-slyusarno-stolyarnyy-instrument-nozhytsi-po-metalu"] },
  { id: "grind", nameUk: "Шліфувати та зачищати", nameRu: "Шлифовать и зачищать", hintUk: "круги, стрічки, щітки", hintRu: "круги, ленты, щётки", icon: "grind", categoryIds: ["acc-dysky-zachysni-po-metalu", "acc-kruhy-shlifuvalni", "acc-kruhy-pelyustkovi-tortsevi", "acc-shchitky-z-metalu", "acc-strichka-shlifuvalna", "acc-sitka-abrazyvna", "acc-terky-dlya-shlifuvannya"] },
  { id: "drill", nameUk: "Свердлити", nameRu: "Сверлить", hintUk: "метал, дерево, бетон, скло", hintRu: "металл, дерево, бетон, стекло", icon: "drill", categoryIds: ["acc-sverdla-po-metalu", "acc-sverdla-po-metalu-stupinchasti", "acc-sverdla-po-derevyni-pir-yani", "acc-sverdla-pikopodibni-po-sklu-ta-plyttsi", "acc-bury-po-betonu", "acc-sverdla-po-betonu", "acc-koronky-po-betonu", "acc-nabory-sverdl", "acc-nabory-buriv"] },
  { id: "screw", nameUk: "Закручувати", nameRu: "Закручивать", hintUk: "викрутки, біти, гвинтокрути", hintRu: "отвёртки, биты, гайковёрты", icon: "screw", categoryIds: ["hand-slyusarno-stolyarnyy-instrument-vykrutky-ta-nabory-vykrutok", "hand-slyusarno-stolyarnyy-instrument-bity-ta-trymachi", "hand-slyusarno-stolyarnyy-instrument-nabory-bit", "el-haykokruty-ta-hvyntokruty-merezhevi"] },
  { id: "saw", nameUk: "Пиляти", nameRu: "Пилить", hintUk: "диски, ножівки, пили", hintRu: "диски, ножовки, пилы", icon: "saw", categoryIds: ["acc-dysky-pylni", "hand-slyusarno-stolyarnyy-instrument-nozhivky", "hand-slyusarno-stolyarnyy-instrument-pylyalni-polotna", "el-pyly-vidrizni", "el-pyly-tortsyuvalni", "el-pyly-tsyrkulyarni", "el-pyly-shabelni", "el-lobzyky", "gr-benzopyly-lantsyuhovi", "gr-elektropylky-lantsyuhovi"] },
  { id: "measure", nameUk: "Вимірювати", nameRu: "Измерять", hintUk: "рівні, рулетки, лазери", hintRu: "уровни, рулетки, лазеры", icon: "measure", categoryIds: ["hand-vymiryuvalnyy-instrument", "lazerna-tekhnika"] },
  { id: "garden", nameUk: "Сад і город", nameRu: "Сад и огород", hintUk: "косити, різати, поливати", hintRu: "косить, резать, поливать", icon: "garden", categoryIds: ["gr", "hand-sadovyy-ruchnyy-instrument"], ownIds: ["acc"] },
  { id: "weld", nameUk: "Зварювати", nameRu: "Варить", hintUk: "апарати, електроди, маски", hintRu: "аппараты, электроды, маски", icon: "weld", categoryIds: ["zvaryuvalne-obladnannya"] },
];

/** Категории, которые покупателям не показываем. */
export const HIDDEN_CATEGORY_IDS = ["unsorted"];

// ---------- привязка категорий к подгруппам ----------

export type CatNode = { id: string; parentId: string | null };

/**
 * Для каждой категории — подгруппа, которой она принадлежит.
 * Правило: `categoryIds` захватывает категорию и всё поддерево, `ownIds` — только саму категорию.
 * Побеждает ближайший к категории захват (вложенное правило сильнее внешнего); два равных захвата — конфликт.
 */
export function assignCategories(nodes: CatNode[], groups: MenuGroup[] = MENU_GROUPS) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const claims = new Map<string, { subId: string; own: boolean }[]>();
  for (const g of groups) {
    for (const s of g.subs) {
      for (const id of s.categoryIds) (claims.get(id) ?? claims.set(id, []).get(id)!).push({ subId: s.id, own: false });
      for (const id of s.ownIds ?? []) (claims.get(id) ?? claims.set(id, []).get(id)!).push({ subId: s.id, own: true });
    }
  }
  const subOf = new Map<string, string>();
  const conflicts: string[] = [];
  const missing = [...claims.keys()].filter((id) => !byId.has(id));
  for (const n of nodes) {
    let cur: CatNode | undefined = n;
    let depth = 0;
    let found: string | null = null;
    while (cur && depth < 10) {
      const c = (claims.get(cur.id) ?? []).filter((x) => !x.own || cur!.id === n.id);
      const uniq = [...new Set(c.map((x) => x.subId))];
      if (uniq.length > 1) {
        conflicts.push(`${n.id}: ${uniq.join(" и ")}`);
        found = uniq[0];
        break;
      }
      if (uniq.length === 1) {
        found = uniq[0];
        break;
      }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      depth++;
    }
    if (found) subOf.set(n.id, found);
  }
  return { subOf, conflicts, missing };
}

/** Код группы по коду подгруппы. */
export const groupOfSub = (subId: string, groups: MenuGroup[] = MENU_GROUPS) => groups.find((g) => g.subs.some((s) => s.id === subId));

/** Товары задачи: категории (с вложенными) и «только сами» — как у подгруппы. */
export function taskCategoryIds(nodes: CatNode[], task: Task): string[] {
  const kids = new Map<string, string[]>();
  for (const n of nodes) if (n.parentId) (kids.get(n.parentId) ?? kids.set(n.parentId, []).get(n.parentId)!).push(n.id);
  const out = new Set<string>(task.ownIds ?? []);
  const walk = (id: string) => {
    out.add(id);
    (kids.get(id) ?? []).forEach(walk);
  };
  task.categoryIds.forEach(walk);
  return [...out];
}

// ---------- быстрый выбор размера ----------

export type FacetGroupLike = { key: string; label: string; values: { value: string; count: number }[] };

/** Первый кандидат из списка, у которого в текущей выдаче ≥ 2 значений. */
export function pickQuickPick<T extends FacetGroupLike>(candidates: string[], attrs: T[]): T | null {
  for (const key of candidates) {
    const g = attrs.find((a) => a.key === key && a.values.length >= 2);
    if (g) return g;
  }
  return null;
}

// ---------- ключевые характеристики в карточке ----------

/** Порядок по умолчанию: самое «выбирающее» — первым. Тип и серия не берём: они уже в названии. */
export const DEFAULT_SPEC_ORDER = ["diameter", "drillDiameter", "landing", "length", "thickness", "power", "voltage", "shank", "slot", "grit", "material", "packQty", "engine", "fuel"];

export type Spec = { key: string; text: string };

/** «Діаметр, мм» + «125» → «Діаметр 125 мм»; «Матеріал» + «Сталь» → «Матеріал: Сталь». */
export function formatSpec(label: string, value: string): string {
  const i = label.indexOf(",");
  if (i > 0) return `${label.slice(0, i).trim()} ${value} ${label.slice(i + 1).trim()}`.trim();
  return `${label}: ${value}`;
}

/** До `max` коротких характеристик товара для списка. `facets` — результат extractFacets. */
export function pickSpecs(facets: Record<string, string[]>, order: string[] = DEFAULT_SPEC_ORDER, max = 3): Spec[] {
  const out: Spec[] = [];
  const seen = new Set<string>();
  for (const key of [...order, ...DEFAULT_SPEC_ORDER]) {
    if (out.length >= max) break;
    if (seen.has(key)) continue;
    seen.add(key);
    const def = FACET_DEFS.find((d) => d.key === key);
    const values = facets[key];
    if (!def || !values?.length) continue;
    out.push({ key, text: formatSpec(def.label, values.slice(0, 2).join(" / ")) });
  }
  return out;
}

/** Удобная обёртка: характеристики из сырых пар «название — значение» товара. */
export const specsFromParams = (params: FeedParam[], order?: string[], max?: number) => pickSpecs(extractFacets(params), order, max);
