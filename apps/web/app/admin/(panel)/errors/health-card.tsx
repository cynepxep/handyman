// Блок «Здоровье сайта» (шаг 8.2) — на главной админки и в «Ошибках»: база, поиск, фоновые задачи, диск, копия, ошибки за сутки.
import Link from "next/link";
import { healthReport } from "@handyman/db/health";

const CHIP = { ok: "adm-chip ok", warn: "adm-chip warn", bad: "adm-chip bad" } as const;
const WORD = { ok: "в порядке", warn: "внимание", bad: "проблема" } as const;

export async function HealthCard({ link = true }: { link?: boolean }) {
  const r = await healthReport();
  const worst = r.checks.some((c) => c.level === "bad") ? "bad" : r.checks.some((c) => c.level === "warn") ? "warn" : "ok";
  return (
    <section className="adm-card" aria-labelledby="health-h">
      <div className="adm-row" style={{ justifyContent: "space-between" }}>
        <h2 id="health-h" style={{ margin: 0 }}>Здоровье сайта <span className={CHIP[worst]}>{WORD[worst]}</span></h2>
        {link && <Link className="adm-link" href="/admin/errors">Ошибки →</Link>}
      </div>
      <ul className="adm-health">
        {r.checks.map((c) => (
          <li key={c.key}>
            <span className={CHIP[c.level]}>{WORD[c.level]}</span> <b>{c.label}</b> <span className="adm-muted">— {c.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
