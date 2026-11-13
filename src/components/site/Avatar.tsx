"use client";

// Аватар игрока: фото, а если его нет — первая буква ника. Список «у кого есть фото» грузится один раз на страницу.

import { useEffect, useSyncExternalStore } from "react";
import { PHOTO_SIZE } from "@/lib/account";

let photos: Record<number, number> | null = null;
let asked = false;
const subs = new Set<() => void>();
const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};

/** Перечитать список фото (после загрузки или удаления фото) */
export function refreshPhotos() {
  asked = true;
  fetch("/api/site?get=photos", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { photos?: Record<number, number> } | null) => {
      if (!d?.photos) return;
      photos = d.photos;
      subs.forEach((fn) => fn());
    })
    .catch(() => {});
}

function usePhotos() {
  const value = useSyncExternalStore(
    subscribe,
    () => photos,
    () => null,
  );
  useEffect(() => {
    if (!asked) refreshPhotos();
  }, []);
  return value;
}

export const photoUrl = (id: number, version: number) => `/api/photo?id=${id}&v=${version}`;

/**
 * Кружок с фото или первой буквой ника. Размер, рамку и цвет буквы задаёт className
 * (например "h-11 w-11 text-lg border-2 border-amber-300 text-amber-200").
 */
export function Avatar({ id, name, className = "", version }: { id: number; name: string; className?: string; version?: number | null }) {
  const all = usePhotos();
  const v = version === undefined ? all?.[id] : version;
  return (
    <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#0b131c] font-black uppercase ${className}`}>
      {v ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl(id, v)} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        ([...name.trim()][0] ?? "?")
      )}
    </span>
  );
}

/** Выбранную картинку обрезать до квадрата по центру, уменьшить и превратить в JPEG (строка data:…) */
export async function fileToJpeg(file: File): Promise<string> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Не получилось прочитать фото — выберите обычную картинку (JPG или PNG)");
  }
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_SIZE;
  canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Браузер не смог обработать фото");
  ctx.fillStyle = "#0b131c";
  ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}
