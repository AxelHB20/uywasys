import { detectImageType } from './clinic.service.js';

describe('detectImageType', () => {
  it('reconoce PNG, JPG y WebP por sus primeros bytes', () => {
    expect(
      detectImageType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
      ),
    ).toBe('image/png');
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
    expect(detectImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'ascii'))).toBe(
      'image/webp',
    );
  });

  it('rechaza archivos que no son imágenes aunque se llamen .png', () => {
    expect(
      detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull();
    expect(detectImageType(Buffer.from('MZ\x90\0'))).toBeNull();
  });
});
