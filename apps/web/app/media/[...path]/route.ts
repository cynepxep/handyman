// Свои копии фото товаров: /media/ab/<sha1>.webp из папки MEDIA_DIR (скачиваются в админке «Фото товаров»).
// Имя файла — отпечаток адреса фото, содержимое не меняется: браузер и Cloudflare могут хранить его год.
// Файла нет на диске (папку удалили или перенесли) — фото скачивается у поставщика заново прямо сейчас.
import { readMediaFile, recoverMediaFile } from "@handyman/db/media";

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = `/media/${path.join("/")}`;
  const stored = await readMediaFile(url);
  const got = stored ? { file: stored, temporary: false } : await recoverMediaFile(url);
  if (!got) return new Response("Не знайдено", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(new Uint8Array(got.file), {
    headers: {
      "content-type": "image/webp",
      "cache-control": got.temporary ? "no-store" : "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
