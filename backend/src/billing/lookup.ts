/**
 * Consulta de RUC (SUNAT) y DNI (RENIEC) con APISPERU: plan gratis de 1000 consultas al mes,
 * token desde su panel (apisperu.com → Consultas DNI y RUC). Si no responde, se agotó el cupo o
 * no existe, devuelve null: la pantalla deja escribir los datos a mano y el cobro sigue.
 */
export const APISPERU_LOOKUP = 'https://dniruc.apisperu.com/api/v1';
const TIMEOUT_MS = 6_000;

export interface LookupResult {
  name: string;
  address: string | null;
  /** RUC: ACTIVO, BAJA DE OFICIO… (null si no se sabe) */
  status: string | null;
  /** RUC: HABIDO, NO HABIDO… */
  condition: string | null;
  /** LOCAL = ya estaba en la clínica (no gasta consultas) */
  source: 'LOCAL' | 'APISPERU';
}

interface ApisperuRuc {
  ruc?: string;
  razonSocial?: string;
  direccion?: string | null;
  departamento?: string | null;
  provincia?: string | null;
  distrito?: string | null;
  estado?: string | null;
  condicion?: string | null;
}
interface ApisperuDni {
  dni?: string;
  nombres?: string;
  apellidoPaterno?: string;
  apellidoMaterno?: string;
}

const clean = (v: string | null | undefined) =>
  v?.replace(/\s+/g, ' ').trim() || null;

export function parseApisperuRuc(body: ApisperuRuc): LookupResult | null {
  const name = clean(body.razonSocial);
  if (!name) return null;
  const place = [body.distrito, body.provincia, body.departamento]
    .map(clean)
    .filter(Boolean)
    .join(' - ');
  const street = clean(body.direccion);
  // La dirección de SUNAT a veces ya trae el distrito: no se repite
  const address =
    street && place && !street.toUpperCase().includes(place.toUpperCase())
      ? `${street}, ${place}`
      : street;
  return {
    name,
    address: address?.slice(0, 200) ?? null,
    status: clean(body.estado),
    condition: clean(body.condicion),
    source: 'APISPERU',
  };
}

export function parseApisperuDni(body: ApisperuDni): LookupResult | null {
  const name = clean(
    [body.nombres, body.apellidoPaterno, body.apellidoMaterno].join(' '),
  );
  return name
    ? { name, address: null, status: null, condition: null, source: 'APISPERU' }
    : null;
}

export async function lookupApisperu(
  token: string,
  type: 'RUC' | 'DNI',
  number: string,
): Promise<LookupResult | null> {
  const path = type === 'RUC' ? 'ruc' : 'dni';
  try {
    const res = await fetch(
      `${APISPERU_LOOKUP}/${path}/${number}?token=${encodeURIComponent(token)}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as ApisperuRuc &
      ApisperuDni;
    return type === 'RUC' ? parseApisperuRuc(body) : parseApisperuDni(body);
  } catch {
    // Caído, sin cupo o lento: se escribe a mano
    return null;
  }
}
