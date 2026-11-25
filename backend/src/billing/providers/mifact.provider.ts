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
 * Mifact (Osys Company S.A.C., PSE autorizado por SUNAT), API JSON (github.com/mifact/apijson).
 * Cada clínica tiene su TOKEN, que va dentro del JSON (Mifact lo rota cada cierto tiempo, ~6 meses:
 * la clínica lo actualiza en Configuración → Facturación). Mifact arma el XML y firma con su
 * certificado: la clínica no necesita certificado digital.
 * Sin ruta guardada se usa el ambiente demo; para producción Mifact entrega la ruta.
 */
export const MIFACT_DEMO = 'https://demo.mifact.net.pe/api/invoiceService.svc';

/** Catálogo 07 (afectación) y 05 (tributo) de SUNAT, como los pide Mifact */
const AFFECTATION = {
  TAXED: { code: '10', tribute: '1000', percent: '18' },
  EXEMPT: { code: '20', tribute: '9997', percent: '0.00' },
  UNAFFECTED: { code: '30', tribute: '9998', percent: '0.00' },
} as const;
/** Catálogo 09: 01 = anulación de la operación */
const CREDIT_NOTE_VOID = { code: '01', label: 'Anulación de la operación' };
/** Boleta sin documento del cliente: así lo pide Mifact */
const NO_DOCUMENT = { docType: '0', docNumber: '00000000' };
const TIMEOUT_MS = 20_000;

/** Estados de Mifact (estado_documento) */
const STATUS: Record<string, ProviderOutcome['status']> = {
  '101': 'SENT', // en proceso
  '102': 'ACCEPTED',
  '103': 'ACCEPTED', // aceptado con observación
  '104': 'REJECTED',
  '105': 'REJECTED', // anulado (no debería pasar al emitir)
  '108': 'SENT', // solicitud de baja aún no enviada
};

const money = (value: number) => value.toFixed(2);
const quantity = (value: number) => String(Number(value.toFixed(3)));
const correlative = (n: number) => String(n).padStart(8, '0');

function customerOf(doc: OutgoingDocument) {
  const anonymous = doc.customer.docType === '-';
  return {
    docType: anonymous ? NO_DOCUMENT.docType : doc.customer.docType,
    docNumber: anonymous ? NO_DOCUMENT.docNumber : doc.customer.docNumber,
    name: doc.customer.name?.trim() || 'CLIENTE SIN NOMBRE',
  };
}

function key(doc: OutgoingDocument, token: string) {
  return {
    TOKEN: token,
    NUM_NIF_EMIS: doc.clinicRuc ?? '',
    COD_TIP_CPE: SUNAT_TYPE[doc.type],
    NUM_SERIE_CPE: doc.series,
    NUM_CORRE_CPE: correlative(doc.number),
    FEC_EMIS: doc.issueDate,
  };
}

export function mifactPayload(
  doc: OutgoingDocument,
  config: ProviderConfig,
): Record<string, unknown> {
  const issuer = config.issuer;
  if (!issuer?.legalName || !issuer.fiscalAddress || !issuer.ubigeo)
    throw new ProviderError(
      'Faltan la razón social, la dirección fiscal o el ubigeo en Configuración → Facturación',
      false,
    );
  const customer = customerOf(doc);
  const payload: Record<string, unknown> = {
    ...key(doc, config.token ?? ''),
    COD_TIP_NIF_EMIS: '6',
    NOM_RZN_SOC_EMIS: issuer.legalName,
    COD_UBI_EMIS: issuer.ubigeo,
    TXT_DMCL_FISC_EMIS: issuer.fiscalAddress,
    COD_TIP_NIF_RECP: customer.docType,
    NUM_NIF_RECP: customer.docNumber,
    NOM_RZN_SOC_RECP: customer.name,
    TXT_DMCL_FISC_RECEP: doc.customer.address?.trim() || 'SIN DIRECCION',
    // Mifact le envía el PDF al comprador
    ...(doc.customer.email ? { TXT_CORREO_ENVIO: doc.customer.email } : {}),
    COD_MND: 'PEN',
    COD_PRCD_CARGA: '001',
    MNT_TOT_GRAVADO: money(doc.totals.taxed),
    MNT_TOT_EXONERADO: money(doc.totals.exempt),
    MNT_TOT_INAFECTO: money(doc.totals.unaffected),
    MNT_TOT_TRIB_IGV: money(doc.totals.igv),
    MNT_TOT: money(doc.totals.total),
    ENVIAR_A_SUNAT: 'true',
    RETORNA_XML_ENVIO: 'false',
    RETORNA_XML_CDR: 'false',
    RETORNA_PDF: 'false',
    COD_FORM_IMPR: '001',
    TXT_VERS_UBL: '2.1',
    TXT_VERS_ESTRUCT_UBL: '2.0',
    COD_ANEXO_EMIS: '0000',
    COD_TIP_OPE_SUNAT: '0101',
    items: doc.lines.map((l) => {
      const a = AFFECTATION[l.affectation];
      return {
        COD_ITEM: l.code,
        COD_UNID_ITEM: l.unit,
        CANT_UNID_ITEM: quantity(l.quantity),
        VAL_UNIT_ITEM: l.unitValue,
        PRC_VTA_UNIT_ITEM: l.unitPrice,
        VAL_VTA_ITEM: money(l.taxable),
        MNT_BRUTO: money(l.taxable),
        MNT_PV_ITEM: money(l.total),
        COD_TIP_PRC_VTA: '01',
        COD_TIP_AFECT_IGV_ITEM: a.code,
        COD_TRIB_IGV_ITEM: a.tribute,
        POR_IGV_ITEM: a.percent,
        MNT_IGV_ITEM: money(l.igv),
        TXT_DESC_ITEM: l.description,
      };
    }),
  };
  if (doc.type === 'CREDIT_NOTE') {
    if (!doc.related?.issueDate)
      throw new ProviderError(
        'La nota de crédito no indica qué comprobante anula',
        false,
      );
    payload['COD_TIP_NC'] = CREDIT_NOTE_VOID.code;
    payload['TXT_DESC_MTVO'] = (
      doc.reason?.trim() || CREDIT_NOTE_VOID.label
    ).slice(0, 100);
    payload['docs_referenciado'] = [
      {
        COD_TIP_DOC_REF: SUNAT_TYPE[doc.related.type as DocumentKind],
        NUM_SERIE_CPE_REF: doc.related.series,
        NUM_CORRE_CPE_REF: correlative(doc.related.number),
        FEC_DOC_REF: doc.related.issueDate,
      },
    ];
  }
  return payload;
}

interface MifactResponse {
  estado_documento?: string | null;
  errors?: string | null;
  codigo_hash?: string | null;
  cadena_para_codigo_qr?: string | null;
  sunat_description?: string | null;
  sunat_note?: string | null;
  url?: string | null;
}

export function parseMifact(body: MifactResponse): ProviderOutcome {
  const code = String(body.estado_documento ?? '').trim();
  const description =
    [body.sunat_description, body.sunat_note]
      .map((t) => t?.trim())
      .filter(Boolean)
      .join(' · ') || null;
  return {
    status: STATUS[code] ?? 'SENT',
    description,
    hash: body.codigo_hash?.trim() || null,
    qrText: body.cadena_para_codigo_qr?.trim() || null,
    pdfUrl: body.url?.trim() || null,
    // Mifact entrega el XML y el CDR en base64 bajo pedido (GetInvoice), no como enlace
    xmlUrl: null,
    cdrUrl: null,
  };
}

/**
 * ¿Mifact dice que el documento ya se había enviado? ("ya existe", "registrado anteriormente").
 * "ya que …" es una explicación, no un aviso de duplicado, y "no existe" nunca lo es.
 */
export function alreadySent(message: string): boolean {
  const text = message.replace(/\bya\s+que\b/gi, '');
  return (
    !/\bno\s+(existe|est[aá]\s+registrad)/i.test(text) &&
    /\bya\b|anteriormente/i.test(text) &&
    /existe|registrad|enviad|emitid/i.test(text)
  );
}

export class MifactProvider implements BillingProviderClient {
  async send(
    doc: OutgoingDocument,
    config: ProviderConfig,
  ): Promise<ProviderOutcome> {
    try {
      return parseMifact(
        await this.post(config, 'SendInvoice', mifactPayload(doc, config)),
      );
    } catch (error) {
      // Se envió antes y no llegó la respuesta (corte, tiempo agotado): se consulta en vez de fallar
      if (error instanceof MifactApiError && alreadySent(error.message)) {
        try {
          return await this.query(doc, config);
        } catch {
          // Mifact dice que ese número ya existe, pero no con esta fecha ni estos datos:
          // ese número ya se usó (otro sistema, o el RUC compartido de pruebas)
          throw new ProviderError(
            `${error.message} · ese número ya se usó en Mifact con otros datos: usa una serie nueva en Facturación`,
            false,
          );
        }
      }
      throw error;
    }
  }

  async query(
    doc: OutgoingDocument,
    config: ProviderConfig,
  ): Promise<ProviderOutcome> {
    return parseMifact(
      await this.post(
        config,
        'GetEstatusInvoice',
        key(doc, config.token ?? ''),
      ),
    );
  }

  /**
   * Consulta un documento inexistente de la clínica. Mifact valida el token contra el RUC: si se
   * queja del token, el token no es de esa clínica; cualquier otra respuesta (p. ej. "no existe")
   * prueba que la ruta, el token y el RUC calzan.
   */
  async check(config: ProviderConfig): Promise<void> {
    const ruc = config.issuer?.ruc;
    if (!ruc)
      throw new ProviderError(
        'Falta el RUC de la clínica en Configuración → Clínica',
        false,
      );
    try {
      await this.post(config, 'GetEstatusInvoice', {
        TOKEN: config.token ?? '',
        NUM_NIF_EMIS: ruc,
        COD_TIP_CPE: '03',
        NUM_SERIE_CPE: 'B999',
        NUM_CORRE_CPE: '99999999',
        FEC_EMIS: '2000-01-01',
      });
    } catch (error) {
      // "No existe ese comprobante" = el token sirve; token o servicio cortado, no
      if (error instanceof MifactApiError && !error.kind) return;
      if (error instanceof MifactApiError && error.kind === 'auth')
        throw new ProviderError(
          `El token no corresponde al RUC ${ruc} de la clínica: revisa el token o el RUC (${error.message})`,
          false,
          'auth',
        );
      throw error;
    }
  }

  private async post(
    config: ProviderConfig,
    method: string,
    payload: Record<string, unknown>,
  ): Promise<MifactResponse> {
    if (!config.token)
      throw new ProviderError(
        'Falta el token del PSE en Configuración → Facturación',
        false,
        'auth',
      );
    const base = (config.url?.trim() || MIFACT_DEMO).replace(/\/+$/, '');
    let res: Response;
    try {
      res = await fetch(`${base}/${method}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
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
      throw new ProviderError(TOKEN_MESSAGE, false, 'auth');
    if (res.status === 429 || res.status >= 500)
      throw new ProviderError(
        `El PSE tuvo un error (${res.status}); se reintentará`,
        true,
        'network',
      );
    const body = (await res.json().catch(() => ({}))) as MifactResponse;
    const errors = body.errors?.trim();
    if (!res.ok || errors)
      throw new MifactApiError(friendlyError(errors || `Error ${res.status}`));
    return body;
  }
}

const SUSPENDED_MESSAGE =
  'Mifact restringió el servicio: revisa el pago de la suscripción';

const TOKEN_MESSAGE =
  'El token de Mifact venció o no es válido: actualízalo en Comprobantes → Actualizar token';

/**
 * Lo que el dueño puede resolver solo, dicho en claro (el texto de Mifact va al final para soporte).
 * El del token conserva la palabra "token": check() la usa para distinguirlo.
 */
export function friendlyError(message: string): string {
  if (/token/i.test(message)) return `${TOKEN_MESSAGE} (Mifact: ${message})`;
  if (
    /suspendid|restringid|deuda|(cuenta|servicio|usuario)\s+(inactiv|bloquead|suspendid)/i.test(
      message,
    )
  )
    return `${SUSPENDED_MESSAGE} (Mifact: ${message})`;
  return message;
}

/** Error de datos que devuelve Mifact en "errors": reintentar no lo arregla (salvo el duplicado). */
export class MifactApiError extends ProviderError {
  constructor(message: string) {
    super(
      `PSE: ${message}`,
      false,
      message.startsWith(TOKEN_MESSAGE)
        ? 'auth'
        : message.startsWith(SUSPENDED_MESSAGE)
          ? 'suspended'
          : null,
    );
  }
}
