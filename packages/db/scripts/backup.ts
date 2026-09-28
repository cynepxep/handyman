// Резервные копии из командной строки (шаг 8.1; пошагово — docs/BACKUPS.md):
//   pnpm backup:now                          — сделать копию сейчас (как кнопка в админке)
//   pnpm backup:check [имя копии]            — проверить восстановление (во временную базу; рабочую не трогает)
//   pnpm backup:restore <копия> --yes        — ВОССТАНОВИТЬ копию в рабочую базу (всё, что в базе сейчас, заменится)
// <копия> — имя копии (2026-09-28_033000-auto), путь к её папке или к файлу db.dump. Перед восстановлением сайт остановить.
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { formatBytes, parseBackupName } from "@handyman/core/backups";
import { prisma } from "../src/client";
import { backupDir, backupPath, createBackup, restoreBackup, verifyBackup } from "../src/backups";

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const arg = rest.find((a) => !a.startsWith("--"));

/** Папка копии по имени/пути. Относительный путь — от папки, где набрали команду (pnpm запускает скрипт из packages/db). */
function resolveFolder(a: string): string | null {
  if (parseBackupName(a)) return backupPath(a);
  const p = isAbsolute(a) ? a : resolve(process.env.INIT_CWD || process.cwd(), a);
  if (!existsSync(p)) return null;
  return statSync(p).isDirectory() ? p : dirname(p);
}

async function main() {
  if (cmd === "now") {
    console.log(`Делаю копию в ${backupDir()}…`);
    const r = await createBackup({ kind: "manual", who: "командная строка" });
    if (!r.ok) throw new Error(r.error);
    const m = r.manifest;
    console.log(`Готово: ${r.name} — база ${formatBytes(m.db?.size ?? 0)}, фото ${m.media?.files ?? 0} (новых ${m.media?.copied ?? 0}).`);
    if (m.offsite) console.log(m.offsite.ok ? "Вторая копия выгружена в облако." : `Вторая копия НЕ выгружена: ${m.offsite.error}`);
    return;
  }
  if (cmd === "check") {
    console.log("Проверяю восстановление во временную базу…");
    const r = await verifyBackup({ who: "командная строка", name: arg, alert: false });
    console.log(r.ok ? `Проверка прошла: ${r.name} восстанавливается (${r.seconds} с).` : `Проверка НЕ прошла (${r.name ?? "—"}): ${r.problems.join("; ")}`);
    if (!r.ok) process.exitCode = 1;
    return;
  }
  if (cmd === "restore") {
    const folder = arg ? resolveFolder(arg) : null;
    if (!folder) {
      console.error(`Укажите копию: pnpm backup:restore <имя копии или путь к папке> --yes\nКопии лежат в ${backupDir()}.`);
      process.exitCode = 1;
      return;
    }
    if (!flags.has("--yes")) {
      console.log(
        [
          `Будет восстановлена копия из ${folder}.`,
          "ВСЁ, что сейчас в базе (заказы, клиенты, товары), заменится данными копии. Перед этим сайт сам сделает копию текущей базы.",
          "Сайт на время восстановления остановите. Если всё верно — повторите команду с --yes в конце.",
        ].join("\n"),
      );
      process.exitCode = 1;
      return;
    }
    const r = await restoreBackup(folder, { safety: !flags.has("--no-safety"), log: (s) => console.log(s) });
    console.log(`\nГотово: база восстановлена из копии ${r.name}.`);
    if (r.safety) console.log(`Прежняя база сохранена копией ${r.safety} (на случай, если восстановили не ту).`);
    if (r.key === "written" || r.key === "replaced") console.log(`Ключ шифрования из копии положен на место${r.keyBackup ? ` (прежний — ${r.keyBackup})` : ""}.`);
    if (r.key === "env-differs") console.log("ВНИМАНИЕ: в .env задан SECRETS_KEY, который не совпадает с ключом копии. Впишите в SECRETS_KEY содержимое файла secrets.key из копии, иначе ключи «Интеграций» не прочитаются.");
    if (r.key === "missing") console.log("ВНИМАНИЕ: в копии нет ключа шифрования — ключи «Интеграций» придётся ввести заново.");
    if (r.media) console.log(`Фото: в копии ${r.media.files}, скопировано новых ${r.media.copied}.`);
    console.log("Дальше: pnpm db:migrate (если копия со старой версии сайта), pnpm search:reindex, затем запустить сайт.");
    return;
  }
  console.log("Команды: pnpm backup:now | pnpm backup:check [имя] | pnpm backup:restore <копия> --yes (подробно — docs/BACKUPS.md)");
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("Не получилось:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
