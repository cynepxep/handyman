// Сообщение в чат менеджеров из командной строки сервера: hm notify "текст" (автообновление сайта — deploy/auto-update.sh).
// Без токена бота или чата менеджеров — сообщение только сохраняется в Outbox (режим-заглушка), как у notifyManagers.
import { prisma } from "../src/client";
import { notifyManagers } from "../src/notify";

async function main() {
  const text = process.argv.slice(2).join(" ").trim();
  if (!text) {
    console.error('Нужен текст: hm notify "текст сообщения"');
    process.exitCode = 2;
    return;
  }
  const r = await notifyManagers(text.slice(0, 3500));
  console.log(`Сообщение менеджерам: ${r}`);
  if (r === "FAILED") process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("Не удалось отправить сообщение:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
