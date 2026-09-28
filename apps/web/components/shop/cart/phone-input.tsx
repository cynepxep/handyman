"use client";

// Поле телефона с маской +380 (XX) XXX-XX-XX и цифровой клавиатурой на телефоне.
// Проверка номера — на сервере (normalizePhone); здесь только удобный ввод.

/** Любой ввод → «+380 (93) 366-24-07» по мере набора. «093…», «380…» и «+380 093…» понимаются. */
export function formatPhoneInput(value: string): string {
  let d = value.replace(/\D/g, "");
  if (d.startsWith("0")) d = `38${d}`;
  else if (d.startsWith("80")) d = `3${d}`;
  else if (d && !d.startsWith("3")) d = `380${d}`;
  // поле уже показывает «+380», а покупатель набирает номер как привык — «093…»: ноль после 380 лишний (кодов на 0 нет)
  if (d.startsWith("3800")) d = `380${d.slice(4)}`;
  d = d.slice(0, 12);
  if (d.length <= 3) return d ? `+${d}` : "";
  const p = d.slice(3);
  let out = "+380";
  if (p.length) out += ` (${p.slice(0, 2)}`;
  if (p.length >= 2) out += ")";
  if (p.length > 2) out += ` ${p.slice(2, 5)}`;
  if (p.length > 5) out += `-${p.slice(5, 7)}`;
  if (p.length > 7) out += `-${p.slice(7, 9)}`;
  return out;
}

export function PhoneInput({ id, value, onChange, invalid, describedBy, autoFocus }: {
  id: string; value: string; onChange: (v: string) => void; invalid?: boolean; describedBy?: string; autoFocus?: boolean;
}) {
  return (
    <input
      id={id}
      name="phone"
      className="hm-input"
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="+380 (__) ___-__-__"
      value={value}
      onChange={(e) => onChange(formatPhoneInput(e.target.value))}
      onFocus={() => !value && onChange("+380")}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      autoFocus={autoFocus}
      maxLength={19}
    />
  );
}
