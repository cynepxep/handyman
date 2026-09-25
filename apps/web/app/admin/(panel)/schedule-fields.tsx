// График работы в админке: для каждого дня «с [09:00] до [18:00]» из списков или «выходной», плюс примечание.
// Общий для «Контакты и график» и «Магазины и склады». Разбор формы — parseScheduleForm (packages/core, site/schedule.ts).
import { DAY_FULL_RU, DAY_KEYS, DEFAULT_WEEK, TIME_OPTIONS, scheduleText, type WeekSchedule } from "@handyman/core/site";

export function ScheduleFields({ value, prefix = "h.", idPrefix = "h" }: { value: WeekSchedule | null; prefix?: string; idPrefix?: string }) {
  const s = value ?? DEFAULT_WEEK;
  return (
    <div className="adm-week">
      {DAY_KEYS.map((key, i) => {
        const d = s.days[i];
        const id = `${idPrefix}-${key}`;
        return (
          <div key={key} className="adm-week-row" role="group" aria-label={DAY_FULL_RU[i]}>
            <b>{DAY_FULL_RU[i]}</b>
            <label className="adm-week-time">
              <span>с</span>
              <select id={`${id}-from`} name={`${prefix}${key}.from`} className="adm-select" defaultValue={d.off ? "09:00" : d.from} aria-label={`${DAY_FULL_RU[i]}: с`}>
                {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="adm-week-time">
              <span>до</span>
              <select id={`${id}-to`} name={`${prefix}${key}.to`} className="adm-select" defaultValue={d.off ? "18:00" : d.to} aria-label={`${DAY_FULL_RU[i]}: до`}>
                {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="adm-check">
              <input type="checkbox" name={`${prefix}${key}.off`} defaultChecked={d.off === true} /> выходной
            </label>
          </div>
        );
      })}
      <div className="adm-grid2">
        <div className="adm-field">
          <label htmlFor={`${idPrefix}-noteUk`}>Примечание (українською), необязательно</label>
          <input id={`${idPrefix}-noteUk`} name={`${prefix}noteUk`} defaultValue={s.noteUk} className="adm-input wide" placeholder="Перерва 13:00–14:00" maxLength={200} />
        </div>
        <div className="adm-field">
          <label htmlFor={`${idPrefix}-noteRu`}>Примечание (по-русски)</label>
          <input id={`${idPrefix}-noteRu`} name={`${prefix}noteRu`} defaultValue={s.noteRu} className="adm-input wide" placeholder="Перерыв 13:00–14:00" maxLength={200} />
        </div>
      </div>
      {value ? (
        <p className="adm-muted">
          На сайте: «{scheduleText(value, "uk") || "—"}» / «{scheduleText(value, "ru") || "—"}»
        </p>
      ) : (
        <p className="adm-muted">График ещё не выбран: показан стандартный (Пн–Сб 9:00–18:00). Проверьте и сохраните.</p>
      )}
    </div>
  );
}
