// «Проверка перед запуском» (шаг 8.3): собрать факты для списка «готово / не готово» (правила — @handyman/core/launch-check).
// Значения ключей наружу не отдаются — только «задан / шаблон / нет».

import { existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "./client";
import { verifyPassword } from "@handyman/core";
import { launchChecklist, type LaunchFacts, type LaunchItem } from "@handyman/core/launch-check";
import { integrationsOverview, projectRoot } from "./integrations";
import { backupOverview } from "./backups";
import { loadSecurity } from "./staff";

const TMP_LOGIN = "claude-test";

// ---------- открытие сайта для поисковиков (шаг 8.5): Setting «site.indexing», переключает владелец ----------
const INDEXING_KEY = "site.indexing";
export type IndexingState = { open: boolean; at: string | null; by: string | null };

/** Открыт ли сайт для поисковиков. Нет записи или база недоступна — закрыт (безопасно). */
export async function loadIndexing(): Promise<IndexingState> {
  const v = (await prisma.setting.findUnique({ where: { key: INDEXING_KEY } }).catch(() => null))?.value as Partial<IndexingState> | undefined;
  return { open: v?.open === true, at: typeof v?.at === "string" ? v.at : null, by: typeof v?.by === "string" ? v.by : null };
}

export async function saveIndexing(open: boolean, who: string): Promise<IndexingState> {
  const value: IndexingState = { open, at: new Date().toISOString(), by: who };
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: INDEXING_KEY }, update: { value }, create: { key: INDEXING_KEY, value } }),
    prisma.auditLog.create({ data: { who, action: open ? "site.indexing.open" : "site.indexing.close" } }),
  ]);
  return value;
}

/** Временный адрес входа для проверок в исходниках или в собранном сайте. */
function tmpRouteExists(): boolean {
  const web = join(/*turbopackIgnore: true*/ projectRoot(), "apps", "web");
  return [join(web, "app", "api", "tmp-claude-login"), join(web, ".next", "server", "app", "api", "tmp-claude-login")].some((p) => existsSync(/*turbopackIgnore: true*/ p));
}

export async function launchFacts(): Promise<LaunchFacts> {
  const env = process.env;
  const [owner, security, staff, tmpAccount, integrations, backups, openErrors, indexing] = await Promise.all([
    prisma.staff.findUnique({ where: { username: "owner" }, select: { passwordSalt: true, passwordHash: true, twoFactorSecret: true } }),
    loadSecurity(),
    prisma.staff.count({ where: { active: true, twoFactorSecret: null, username: { not: TMP_LOGIN } } }),
    prisma.staff.count({ where: { username: TMP_LOGIN } }),
    integrationsOverview(),
    backupOverview().catch(() => null),
    prisma.errorLog.count({ where: { closedAt: null } }),
    loadIndexing(),
  ]);
  const token = env.ADMIN_TOKEN?.trim() ?? "";
  return {
    production: env.NODE_ENV === "production",
    env: {
      ADMIN_TOKEN: env.ADMIN_TOKEN, SECRETS_KEY: env.SECRETS_KEY, MEILI_MASTER_KEY: env.MEILI_MASTER_KEY, PUBLIC_URL: env.PUBLIC_URL,
      DATABASE_URL: env.DATABASE_URL, HEALTH_KEY: env.HEALTH_KEY, HM_TMP_LOGIN: env.HM_TMP_LOGIN,
    },
    owner: {
      exists: Boolean(owner),
      defaultPassword: owner ? verifyPassword("change-me", owner.passwordSalt, owner.passwordHash) : false,
      passwordIsAdminToken: owner && token ? verifyPassword(token, owner.passwordSalt, owner.passwordHash) : false,
      twoFactor: Boolean(owner?.twoFactorSecret),
    },
    staff: { require2fa: security.require2fa, activeWithout2fa: staff },
    tmp: { route: tmpRouteExists(), account: tmpAccount > 0 },
    backup: {
      lastOkAt: backups?.lastOk?.manifest?.finishedAt ?? null,
      checkOk: backups?.lastCheck ? backups.lastCheck.ok : null,
      checkAt: backups?.lastCheck?.at ?? null,
      offsite: backups?.offsite.configured ?? false,
    },
    integrations: integrations.map((i) => ({ id: i.id, title: i.title, configured: i.configured, check: i.check ? { ok: i.check.ok, at: i.check.at } : null })),
    openErrors,
    indexing: { open: indexing.open, at: indexing.at },
  };
}

export async function launchCheck(now: Date = new Date()): Promise<LaunchItem[]> {
  return launchChecklist(await launchFacts(), now);
}
