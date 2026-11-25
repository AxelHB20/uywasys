import {
  BillingProviderClient,
  OutgoingDocument,
  ProviderConfig,
  ProviderError,
  ProviderOutcome,
} from '../billing.types.js';

/**
 * Nubefact (PSE/OSE autorizado por SUNAT), API JSON "online".
 * Cada clínica tiene su RUTA y su TOKEN, que copia del panel de Nubefact (en pruebas y en producción
 * son distintos). Nubefact firma el XML, lo envía a SUNAT y devuelve el PDF, el XML y el CDR.
 * Antes de pasar a producción se valida cada caso con la cuenta de pruebas (docs/FACTURACION.md).
 */
const TYPE = { FACTURA: 1, BOLETA: 2, CREDIT_NOTE: 3 } as const;
const IGV_TYPE = { TAXED: 1, EXEMPT: 8, UNAFFECTED: 9 } as const;
/** Catálogo 09: 01 = anulación de la operación */
const CREDIT_NOTE_VOID = 1;
/** "Este documento ya existe en NubeFacT": se envió antes y no llegó la respuesta */
const ALREADY_EXISTS = 23;
const TIMEOUT_MS = 20_000;

/** AAAA-MM-DD → DD-MM-AAAA */
const nubefactDate = (iso: string) => iso.split('-').reverse().join('-');
const amount = (value: number) =>
  value > 0 ? Number(value.toFixed(2)) : undefined;

export function nubefactPayload(
  doc: OutgoingDocument,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    operacion: 'generar_comprobante',
    tipo_de_comprobante: TYPE[doc.type],
    serie: doc.series,
    numero: doc.number,
    sunat_transaction: 1,
    cliente_tipo_de_documento: doc.customer.docType,
    cliente_numero_de_documento: doc.customer.docNumber,
    cliente_denominacion: doc.customer.name,
    cliente_direccion: doc.customer.address ?? '',
    cliente_email: doc.customer.email ?? '',
    fecha_de_emision: nubefactDate(doc.issueDate),
    moneda: 1,
    porcentaje_de_igv: 18.0,
    total_gravada: amount(doc.totals.taxed),
    total_exonerada: amount(doc.totals.exempt),
    total_inafecta: amount(doc.totals.unaffected),
    total_igv: Number(doc.totals.igv.toFixed(2)),
    total: Number(doc.totals.total.toFixed(2)),
    enviar_automaticamente_a_la_sunat: true,
    enviar_automaticamente_al_cliente: false,
    // Evita duplicados si el mismo documento se reenvía
    codigo_unico: `${doc.series}-${doc.number}`,
    formato_de_pdf: 'TICKET',
    items: doc.lines.map((l) => ({
      unidad_de_medida: l.unit,
      codigo: l.code,
      descripcion: l.description,
      cantidad: l.quantity,
      valor_unitario: l.unitValue,
      precio_unitario: l.unitPrice,
      descuento: '',
      subtotal: Number(l.taxable.toFixed(2)),
      tipo_de_igv: IGV_TYPE[l.affectation],
      igv: Number(l.igv.toFixed(2)),
      total: Number(l.total.toFixed(2)),
      anticipo_regularizacion: false,
    })),
  };
  if (doc.type === 'CREDIT_NOTE' && doc.related) {
    payload['documento_que_se_modifica_tipo'] = TYPE[doc.related.type];
    payload['documento_que_se_modifica_serie'] = doc.related.series;
    payload['documento_que_se_modifica_numero'] = doc.related.number;
    payload['tipo_de_nota_de_credito'] = CREDIT_NOTE_VOID;
    payload['observaciones'] = doc.reason ?? '';
  }
  // Nubefact espera solo los totales que existen
  for (const key of Object.keys(payload))
    if (payload[key] === undefined) delete payload[key];
  return payload;
}

interface NubefactResponse {
  aceptada_por_sunat?: boolean;
  sunat_description?: string | null;
  sunat_responsecode?: string | null;
  sunat_soap_error?: string | null;
  codigo_hash?: string | null;
  cadena_para_codigo_qr?: string | null;
  enlace_del_pdf?: string | null;
  enlace_del_xml?: string | null;
  enlace_del_cdr?: string | null;
  errors?: string;
  codigo?: number;
}

export function parseNubefact(body: NubefactResponse): ProviderOutcome {
  const code = Number(body.sunat_responsecode ?? 0);
  // 2000–3999: SUNAT rechazó el comprobante. 4000+: aceptado con observaciones
  const rejected = !body.aceptada_por_sunat && code >= 2000 && code < 4000;
  return {
    status: body.aceptada_por_sunat
      ? 'ACCEPTED'
      : rejected
        ? 'REJECTED'
        : 'SENT',
    description: body.sunat_description ?? body.sunat_soap_error ?? null,
    hash: body.codigo_hash ?? null,
    qrText: body.cadena_para_codigo_qr ?? null,
    pdfUrl: body.enlace_del_pdf ?? null,
    xmlUrl: body.enlace_del_xml ?? null,
    cdrUrl: body.enlace_del_cdr ?? null,
  };
}

export class NubefactProvider implements BillingProviderClient {
  async send(
    doc: OutgoingDocument,
    config: ProviderConfig,
  ): Promise<ProviderOutcome> {
    try {
      return parseNubefact(await this.post(config, nubefactPayload(doc)));
    } catch (error) {
      if (error instanceof NubefactApiError && error.code === ALREADY_EXISTS)
        return this.query(doc, config);
      throw error;
    }
  }

  async query(
    doc: OutgoingDocument,
    config: ProviderConfig,
  ): Promise<ProviderOutcome> {
    return parseNubefact(
      await this.post(config, {
        operacion: 'consultar_comprobante',
        tipo_de_comprobante: TYPE[doc.type],
        serie: doc.series,
        numero: doc.number,
      }),
    );
  }

  /** Consulta un documento que no existe: si responde "no existe", la ruta y el token sirven. */
  async check(config: ProviderConfig): Promise<void> {
    try {
      await this.post(config, {
        operacion: 'consultar_comprobante',
        tipo_de_comprobante: 2,
        serie: 'B001',
        numero: 99999999,
      });
    } catch (error) {
      if (error instanceof NubefactApiError) return;
      throw error;
    }
  }

  private async post(
    config: ProviderConfig,
    payload: Record<string, unknown>,
  ): Promise<NubefactResponse> {
    if (!config.url || !config.token)
      throw new ProviderError(
        'Falta la ruta o el token del PSE en Configuración → Facturación',
        false,
        'auth',
      );
    let res: Response;
    try {
      res = await fetch(config.url, {
        method: 'POST',
        headers: {
          Authorization: `Token token="${config.token}"`,
          'Content-Type': 'application/json',
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
        'El PSE rechazó la ruta o el token: revísalos en Configuración → Facturación',
        false,
        'auth',
      );
    if (res.status >= 500)
      throw new ProviderError(
        `El PSE tuvo un error (${res.status}); se reintentará`,
        true,
        'network',
      );
    const body = (await res.json().catch(() => ({}))) as NubefactResponse;
    if (!res.ok || body.errors)
      throw new NubefactApiError(
        body.errors ?? `Error ${res.status}`,
        body.codigo ?? 0,
      );
    return body;
  }
}

/** Error de datos que devuelve Nubefact: reintentar no lo arregla (salvo el código 23, ya manejado). */
export class NubefactApiError extends ProviderError {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(`PSE: ${message}`, false);
  }
}
