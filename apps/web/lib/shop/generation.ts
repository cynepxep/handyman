// «Поколение» контента витрины внутри процесса сайта: фоновая задача (lib/worker.ts) меняет меню без запроса из админки,
// а сбросить кэш тегом (updateTag) можно только из действия админки. Номер входит в ключ кэша контента (content.ts):
// увеличили — следующий запрос возьмёт меню из базы заново.
const g = globalThis as unknown as { hmShopGen?: number };

export const shopGeneration = (): number => g.hmShopGen ?? 0;

export function bumpShopGeneration(): void {
  g.hmShopGen = shopGeneration() + 1;
}
