// Пересобрать `deploy/gtm-container.json` из `src/gtm-container.ts` (шаг А2): `pnpm gtm:container`.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gtmContainerJson } from "../src/gtm-container";

const out = fileURLToPath(new URL("../../../deploy/gtm-container.json", import.meta.url));
writeFileSync(out, gtmContainerJson());
console.log(`Записан ${out}`);
