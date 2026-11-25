import { UserFacingError } from './validators';

/**
 * Achica una foto del celular (3–8 MB) antes de subirla, para no engordar la base ni los
 * respaldos. Un PDF (u otro archivo que no sea imagen) pasa tal cual. Si el navegador no puede
 * leer la foto (p. ej. un HEIC del iPhone en Chrome) o el resultado pesa más, se devuelve la
 * original: nunca falla por comprimir.
 */
export async function shrinkImage(
  file: File,
  maxSide = 1600,
  quality = 0.78,
  type: 'image/jpeg' | 'image/webp' = 'image/jpeg',
): Promise<{ blob: Blob; name: string }> {
  const original = { blob: file as Blob, name: file.name };
  if (!file.type.startsWith('image/')) return original;
  let bitmap: ImageBitmap;
  try {
    // Respeta la orientación con la que se tomó la foto
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return original;
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    return original;
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (as: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, as, quality));
  let blob = await encode(type);
  // Un navegador que no sabe crear WebP (Safari antiguo) entrega PNG: entonces JPEG
  if (blob && blob.type !== type) blob = await encode('image/jpeg');
  if (!blob || blob.size >= file.size) return original;
  const ext = blob.type === 'image/webp' ? '.webp' : '.jpg';
  return { blob, name: file.name.replace(/\.[^.]+$/, '') + ext };
}

/** Límite del servidor para archivos clínicos */
export const CLINICAL_MAX_BYTES = 10 * 1024 * 1024;
/** Una foto se acepta más grande porque se achica antes de subir */
const PHOTO_MAX_BYTES = 40 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const CLINICAL_ACCEPT = [...PHOTO_TYPES, 'application/pdf'].join(',');

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Por qué no se puede subir este archivo clínico, o null si se puede. */
export function clinicalFileError(file: File, original: boolean): string | null {
  const isPhoto = PHOTO_TYPES.includes(file.type);
  if (!isPhoto && file.type !== 'application/pdf')
    return 'Solo fotos (JPG, PNG, WebP o del iPhone) o PDF.';
  if (isPhoto && !original) {
    return file.size > PHOTO_MAX_BYTES
      ? `La foto pesa ${mb(file.size)}: el máximo es 40 MB.`
      : null;
  }
  return file.size > CLINICAL_MAX_BYTES
    ? `El archivo pesa ${mb(file.size)}: el máximo es 10 MB${isPhoto ? ' en calidad original' : ''}.`
    : null;
}

/**
 * Foto clínica lista para subir: WebP de 2048 px al 85 % (~0,35 MB, se ve igual en pantalla e
 * impresa). Con "calidad original" o si es PDF, sube tal cual.
 */
export async function prepareClinicalFile(
  file: File,
  original: boolean,
): Promise<{ blob: Blob; name: string }> {
  if (original || !file.type.startsWith('image/')) return { blob: file, name: file.name };
  const result = await shrinkImage(file, 2048, 0.85, 'image/webp');
  if (/^image\/hei[cf]$/.test(result.blob.type))
    throw new UserFacingError(
      'Esta foto del iPhone (HEIC) no se pudo convertir en este navegador: envíala como JPG o súbela desde el celular.',
    );
  if (result.blob.size > CLINICAL_MAX_BYTES)
    throw new UserFacingError(`La foto sigue pesando ${mb(result.blob.size)}: el máximo es 10 MB.`);
  return result;
}
