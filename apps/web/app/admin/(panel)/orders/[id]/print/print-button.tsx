"use client";

export function PrintButton() {
  return <button type="button" className="adm-btn primary" onClick={() => window.print()}>🖨 Печать</button>;
}
