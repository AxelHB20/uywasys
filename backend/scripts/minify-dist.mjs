// Producción: compacta el JavaScript compilado (dist/) antes de armar la imagen del servidor.
// Quita comentarios, espacios y nombres internos, y borra los mapas de código (.map), para que lo que
// queda en el servidor de la clínica no sea el código fuente legible. Conserva los nombres de clases
// y funciones porque NestJS los usa (inyección de dependencias, registros).
// Uso: node scripts/minify-dist.mjs   (lo corre backend/Dockerfile después de "npm run build")
// esbuild llega con tsx (dependencia del proyecto).
import { transform } from 'esbuild';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
let files = 0;
let before = 0;
let after = 0;

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (
      entry.name.endsWith('.map') ||
      entry.name.endsWith('.d.ts') ||
      entry.name.endsWith('.tsbuildinfo')
    )
      await rm(path);
    else if (entry.name.endsWith('.js')) {
      const code = await readFile(path, 'utf8');
      const out = await transform(code, {
        loader: 'js',
        format: 'esm',
        target: 'node24',
        minify: true,
        keepNames: true,
        legalComments: 'none',
      });
      await writeFile(path, out.code);
      files++;
      before += code.length;
      after += out.code.length;
    }
  }
}

await walk(root);
console.log(
  `dist compactado: ${files} archivos, ${Math.round(before / 1024)} KB → ${Math.round(after / 1024)} KB`,
);
