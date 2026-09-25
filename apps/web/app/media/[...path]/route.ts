// Свои копии фото товаров: /media/ab/<sha1>.webp из папки MEDIA_DIR (скачиваются в админке «Фото товаров»).
// Имя файла — отпечаток адреса фото, содержимое не меняется: браузер и Cloudflare могут хранить его год.
import { readMediaFile } from "@handyman/db/media";

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const file = await readMediaFile(`/media/${path.join("/")}`);
  if (!file) return new Response("Не знайдено", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(new Uint8Array(file), {
    headers: { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
  });
}
