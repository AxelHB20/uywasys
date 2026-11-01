/**
 * Texto de consentimiento (Ley 29733). BORRADOR: debe revisarlo un abogado antes de vender.
 * Si el texto cambia, sube la versión: cada cliente guarda la versión que aceptó.
 */
export const CONSENT_VERSION = '2026-10-v2';

/*
 * v2 (28/10/2026): informa que la clínica es la responsable del banco de datos, que el sistema y
 * la facturación electrónica son encargados suyos con servidores que pueden estar fuera del Perú
 * (DS 016-2024-JUS exige consentimiento expreso para el flujo transfronterizo), cuánto tiempo se
 * guardan los datos y que se puede reclamar ante la ANPD. Los clientes que aceptaron la v1 la
 * conservan registrada; la v2 rige para los nuevos.
 */
export const CONSENT_TEXT =
  'Autorizo a la clínica a tratar mis datos personales y los de mi mascota ' +
  '(nombre, documento, celular, correo, dirección e historia clínica) para brindar ' +
  'los servicios veterinarios, emitir comprobantes y comunicarme sobre la atención ' +
  'de mi mascota. La clínica es la responsable del banco de datos. Para operar usa ' +
  'proveedores que tratan los datos solo por su encargo (el sistema de gestión y el ' +
  'servicio de facturación electrónica), cuyos servidores pueden estar fuera del ' +
  'Perú; acepto ese envío al extranjero. Mis datos no se comparten con otros, salvo ' +
  'por mandato legal. Se guardan mientras sea cliente y luego el tiempo que exijan ' +
  'las normas tributarias y sanitarias. Puedo pedir el acceso, la rectificación, la ' +
  'cancelación o la oposición al uso de mis datos dirigiéndome a la clínica y, si no ' +
  'me atienden, reclamar ante la Autoridad Nacional de Protección de Datos Personales ' +
  '(Ley N.° 29733).';

export const MARKETING_CONSENT_TEXT =
  'Acepto recibir promociones y recordatorios comerciales por WhatsApp o correo.';
