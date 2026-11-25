import { CLINICAL_MAX_BYTES, clinicalFileError, prepareClinicalFile } from './image';
import { UserFacingError, apiErrorMessage } from './validators';

const fileOf = (type: string, size: number, name = 'f') =>
  new File([new Uint8Array(size)], name, { type });

describe('archivos clínicos', () => {
  it('acepta fotos grandes (se comprimen) pero exige 10 MB para PDF y calidad original', () => {
    const photo = fileOf('image/jpeg', 15 * 1024 * 1024);
    expect(clinicalFileError(photo, false)).toBeNull();
    expect(clinicalFileError(photo, true)).toContain('máximo es 10 MB en calidad original');
    expect(clinicalFileError(fileOf('application/pdf', CLINICAL_MAX_BYTES + 1), false)).toContain(
      '10 MB',
    );
    expect(clinicalFileError(fileOf('image/heic', 3_000_000), false)).toBeNull();
    expect(clinicalFileError(fileOf('application/zip', 10), false)).toContain('Solo fotos');
    expect(clinicalFileError(fileOf('image/jpeg', 41 * 1024 * 1024), false)).toContain('40 MB');
  });

  it('el PDF y la calidad original suben tal cual', async () => {
    const pdf = fileOf('application/pdf', 100, 'hemograma.pdf');
    expect(await prepareClinicalFile(pdf, false)).toEqual({ blob: pdf, name: 'hemograma.pdf' });
    const photo = fileOf('image/jpeg', 100, 'rx.jpg');
    expect(await prepareClinicalFile(photo, true)).toEqual({ blob: photo, name: 'rx.jpg' });
  });

  it('una foto que el navegador no puede leer no rompe: JPG sube original, HEIC avisa claro', async () => {
    // jsdom no decodifica imágenes: es como un navegador que no puede leer la foto
    const jpg = fileOf('image/jpeg', 100, 'herida.jpg');
    expect((await prepareClinicalFile(jpg, false)).blob).toBe(jpg);
    const heic = fileOf('image/heic', 100, 'IMG_1.HEIC');
    const error = await prepareClinicalFile(heic, false).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(apiErrorMessage(error)).toContain('HEIC');
  });
});
