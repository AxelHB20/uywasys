import { createHash } from 'node:crypto';
import {
  BillingProviderClient,
  OutgoingDocument,
  ProviderOutcome,
  SUNAT_TYPE,
} from '../billing.types.js';

/**
 * Proveedor de simulación: responde como si SUNAT hubiera aceptado, sin enviar nada.
 * Sirve para mostrar el sistema y para las pruebas. Sus comprobantes NO tienen valor tributario
 * y la representación impresa lo dice en grande.
 */
export class SimulatedProvider implements BillingProviderClient {
  send(doc: OutgoingDocument): Promise<ProviderOutcome> {
    const hash = createHash('sha256')
      .update(`${doc.series}-${doc.number}-${doc.totals.total}`)
      .digest('base64')
      .slice(0, 28);
    return Promise.resolve({
      status: 'ACCEPTED',
      description: 'Simulación: no se envió a SUNAT',
      hash,
      qrText: [
        doc.clinicRuc ?? '00000000000',
        SUNAT_TYPE[doc.type],
        doc.series,
        doc.number,
        doc.totals.igv.toFixed(2),
        doc.totals.total.toFixed(2),
        doc.issueDate,
        doc.customer.docType,
        doc.customer.docNumber,
        hash,
        '',
      ].join('|'),
    });
  }

  query(doc: OutgoingDocument): Promise<ProviderOutcome> {
    return this.send(doc);
  }

  check(): Promise<void> {
    return Promise.resolve();
  }
}
