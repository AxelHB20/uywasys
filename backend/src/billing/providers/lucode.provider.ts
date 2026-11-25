import {
  BillingProviderClient,
  DocumentKind,
  OutgoingDocument,
  ProviderConfig,
  ProviderError,
  ProviderOutcome,
  SUNAT_TYPE,
} from '../billing.types.js';

/**
 * Lucode (APISUNAT, PSE autorizado por SUNAT), API JSON v3 (docs.apisunat.pe).
 * Cada clínica tiene su TOKEN (módulo Organizaciones de su panel). La ruta no se pide: es el
 * sandbox mientras "Producción" esté sin marcar y la app de producción cuando se marca (si la
 * clínica pega una ruta, se usa esa). Lucode firma con su certificado: la clínica no necesita
 * certificado digital, solo autorizar a Lucode como PSE en su Clave SOL.
 * Antes de producción se valida cada caso en el sandbox (docs/FACTURACION.md).
 */
export const LUCODE_SANDBOX = 'https://sandbox.apisunat.pe';
export const LUCODE_PRODUCTION = 'https://app.apisunat.pe';

const DOCUMENT: Record<DocumentKind, string> = {
  FACTURA: 'factura',
  BOLETA: 'boleta',
  CREDIT_NOTE: 'nota_credito',
};
/** Catálogo 07 de SUNAT (afectación del IGV) y el tributo que va con cada una */
const AFFECTATION = {
  TAXED: { code: '10', percent: '18', tax: 'IGV' },
  EXEMPT: { code: '20', percent: '0', tax: 'EXO' },
  UNAFFECTED: { code: '30', percent: '0', tax: 'INA' },
} as const;
/** Catálogo 09: 01 = anulación de la operación */
const CREDIT_NOTE_VOID = { code: '01', label: 'Anulación de la operación' };
/** Venta interna (catálogo 51) */
const INTERNAL_SALE = '0101';
/** Boleta sin documento del cliente: así lo pide Lucode (hasta S/ 700) */
const NO_DOCUMENT = { docType: '1', docNumber: '99999999' };
const TIMEOUT_MS = 20_000;

const money = (value: number) => value.toFixed(2);
/** "1" y no "1.000": la cantidad va como texto, sin ceros de más */
const quantity = (value: number) => String(Number(value.toFixed(3)));

function customerOf(doc: OutgoingDocument) {
  const anonymous = doc.customer.docType === '-';
  return {
    docType: anonymous ? NO_DOCUMENT.docType : doc.customer.docType,
    docNumber: anonymous ? NO_DOCUMENT.docNumber : doc.customer.docNumber,
  };
}

export function lucodePayload(doc: OutgoingDocument): Record<string, unknown> {
  const customer = customerOf(doc);
  const payload: Record<string, unknown> = {
    documento: DOCUMENT[doc.type],
    serie: doc.series,
    numero: doc.number,
    fecha_de_emision: doc.issueDate,
    moneda: 'PEN',
    cliente_tipo_de_documento: customer.docType,
    cliente_numero_de_documento: customer.docNumber,
    cliente_denominacion: doc.customer.name,
    cliente_direccion: doc.customer.address?.trim() || '-',
    items: doc.lines.map((l) => ({
      unidad_de_medida: l.unit,
      codigo_interno: l.code,
      descripcion: l.description,
      cantidad: quantity(l.quantity),
      valor_unitario: l.unitValue,
      porcentaje_igv: AFFECTATION[l.affectation].percent,
      codigo_tipo_afectacion_igv: AFFECTATION[l.affectation].code,
      nombre_tributo: AFFECTATION[l.affectation].tax,
    })),
    total: money(doc.totals.total),
  };
  if (doc.type === 'CREDIT_NOTE') {
    if (!doc.related)
      throw new ProviderError(
        'La nota de crédito no indica qué comprobante anula',
        false,
      );
    payload['nota_credito_codigo_tipo'] = CREDIT_NOTE_VOID.code;
    payload['nota_credito_motivo'] =
      doc.reason?.trim() || CREDIT_NOTE_VOID.label;
    payload['documento_afectado'] = {
      documento: DOCUMENT[doc.related.type],
      serie: doc.related.series,
      numero: doc.related.number,
    };
  } else {
    payload['tipo_operacion'] = INTERNAL_SALE;
  }
  return payload;
}

/**
 * Texto del código QR de la representación impresa (formato de SUNAT):
 * RUC | tipo | serie | número | IGV | total | fecha | tipo doc. cliente | n.º doc. cliente | hash |
 * Lucode no lo devuelve, así que se arma con el hash que sí devuelve.
 */
export function lucodeQr(doc: OutgoingDocument, hash: string): string {
  const customer = customerOf(doc);
  return [
    doc.clinicRuc ?? '',
    SUNAT_TYPE[doc.type],
    doc.series,
    doc.number,
    money(doc.totals.igv),
    money(doc.totals.total),
    doc.issueDate,
    customer.docType,
    customer.docNumber,
    hash,
    '',
  ].join('|');
}

interface LucodeResponse {
  success?: boolean;
  message?: string;
  payload?: {
    estado?: string;
    hash?: string | null;
    xml?: string | null;
    cdr?: string | null;
    pdf?: { ticket?: string | null; a4?: string | null } | null;
  } | null;
}

export function parseLucode(
  body: LucodeResponse,
  doc: OutgoingDocument,
): ProviderOutcome {
  const p = body.payload ?? {};
  const estado = (p.estado ?? '').toUpperCase();
  const hash = p.hash ?? null;
  return {
    status:
      estado === 'ACEPTADO'
        ? 'ACCEPTED'
        : estado === 'RECHAZADO'
          ? 'REJECTED'
          : // PENDIENTE: firmado, SUNAT aún no responde (las boletas suelen quedar así un rato)
            'SENT',
    description: body.message ?? null,
    hash,
    qrText: hash ? lucodeQr(doc, hash) : null,
    pdfUrl: p.pdf?.a4 ?? p.pdf?.ticket ?? null,
    xmlUrl: p.xml ?? null,
    cdrUrl: p.cdr ?? null,
  };
}

export class LucodeProvider implements BillingProviderClient {
  async send(
    doc: OutgoingDocument,
    config: ProviderConfig,
  ): Promise<ProviderOutcome> {
    try {
      return parseLucode(
        await this.post(config, '/api/v3/documents', lucodePayload(doc)),
        doc,
      );
    } catch (error) {
      // Se envió antes y no llegó la respuesta (corte, tiempo agotado): se consulta en vez de fallar
      if (
        error instanceof LucodeApiError &&
        /emitid[oa] anteriormente/i.test(error.message)
      )
        return this.query(doc, config);
      throw error;
    }
  }

  async query(
    doc: OutgoingDocument,
    config: ProviderConfig,
  ): Promise<ProviderOutcome> {
    return parseLucode(
      await this.post(config, '/api/v3/status', {
        documento: DOCUMENT[doc.type],
        serie: doc.series,
        numero: doc.number,
      }),
      doc,
    );
  }

  /** Consulta un documento que no existe: si responde "no se encuentra registrado", el token sirve. */
  async check(config: ProviderConfig): Promise<void> {
    try {
      await this.post(config, '/api/v3/status', {
        documento: 'boleta',
        serie: 'B001',
        numero: 99999999,
      });
    } catch (error) {
      if (error instanceof LucodeApiError) return;
      throw error;
    }
  }

  private async post(
    config: ProviderConfig,
    path: string,
    payload: Record<string, unknown>,
  ): Promise<LucodeResponse> {
    if (!config.token)
      throw new ProviderError(
        'Falta el token del PSE en Configuración → Facturación',
        false,
        'auth',
      );
    const base = (
      config.url?.trim() ||
      (config.production ? LUCODE_PRODUCTION : LUCODE_SANDBOX)
    ).replace(/\/+$/, '');
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new ProviderError(
        `El PSE no respondió: ${error instanceof Error ? error.message : String(error)}`,
        true,
        'network',
      );
    }
    if (res.status === 401 || res.status === 403)
      throw new ProviderError(
        'El PSE rechazó el token: revísalo en Configuración → Facturación',
        false,
        'auth',
      );
    if (res.status === 429 || res.status >= 500)
      throw new ProviderError(
        `El PSE tuvo un error (${res.status}); se reintentará`,
        true,
        'network',
      );
    const body = (await res.json().catch(() => ({}))) as LucodeResponse;
    if (!res.ok || body.success === false)
      throw new LucodeApiError(body.message ?? `Error ${res.status}`);
    return body;
  }
}

/** Error de datos que devuelve Lucode (422/400): reintentar no lo arregla (salvo el duplicado, ya manejado). */
export class LucodeApiError extends ProviderError {
  constructor(message: string) {
    super(`PSE: ${message}`, false);
  }
}
