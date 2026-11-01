/**
 * Importe en letras para la representación impresa: "SON: CIENTO VEINTICINCO CON 50/100 SOLES".
 */
const UNITS = [
  '',
  'UNO',
  'DOS',
  'TRES',
  'CUATRO',
  'CINCO',
  'SEIS',
  'SIETE',
  'OCHO',
  'NUEVE',
];
const TEENS = [
  'DIEZ',
  'ONCE',
  'DOCE',
  'TRECE',
  'CATORCE',
  'QUINCE',
  'DIECISÉIS',
  'DIECISIETE',
  'DIECIOCHO',
  'DIECINUEVE',
];
const TWENTIES = [
  'VEINTE',
  'VEINTIUNO',
  'VEINTIDÓS',
  'VEINTITRÉS',
  'VEINTICUATRO',
  'VEINTICINCO',
  'VEINTISÉIS',
  'VEINTISIETE',
  'VEINTIOCHO',
  'VEINTINUEVE',
];
const TENS = [
  '',
  '',
  '',
  'TREINTA',
  'CUARENTA',
  'CINCUENTA',
  'SESENTA',
  'SETENTA',
  'OCHENTA',
  'NOVENTA',
];
const HUNDREDS = [
  '',
  'CIENTO',
  'DOSCIENTOS',
  'TRESCIENTOS',
  'CUATROCIENTOS',
  'QUINIENTOS',
  'SEISCIENTOS',
  'SETECIENTOS',
  'OCHOCIENTOS',
  'NOVECIENTOS',
];

function belowHundred(n: number): string {
  if (n < 10) return UNITS[n];
  if (n < 20) return TEENS[n - 10];
  if (n < 30) return TWENTIES[n - 20];
  const unit = n % 10;
  return unit
    ? `${TENS[Math.floor(n / 10)]} Y ${UNITS[unit]}`
    : TENS[Math.floor(n / 10)];
}

function belowThousand(n: number): string {
  if (n === 100) return 'CIEN';
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [HUNDREDS[hundreds], belowHundred(rest)].filter(Boolean).join(' ');
}

function integerToWords(n: number): string {
  if (n === 0) return 'CERO';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions)
    parts.push(
      millions === 1 ? 'UN MILLÓN' : `${integerToWords(millions)} MILLONES`,
    );
  if (thousands)
    parts.push(thousands === 1 ? 'MIL' : `${belowThousand(thousands)} MIL`);
  if (rest) parts.push(belowThousand(rest));
  // "VEINTIUNO MIL" → "VEINTIÚN MIL", "UNO MILLONES" no ocurre por la rama de arriba
  return parts
    .join(' ')
    .replace(/VEINTIUNO MIL/g, 'VEINTIÚN MIL')
    .replace(/UNO MIL/g, 'UN MIL');
}

export function amountInWords(amount: number): string {
  const cents = Math.round(amount * 100);
  const integer = Math.floor(cents / 100);
  const decimals = String(cents % 100).padStart(2, '0');
  return `SON: ${integerToWords(integer)} CON ${decimals}/100 SOLES`;
}
