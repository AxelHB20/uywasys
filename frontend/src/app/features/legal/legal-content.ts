/**
 * Términos del servicio y Política de privacidad de Uywa.
 * BORRADOR: los revisa un abogado antes de vender (ver docs/legal/README.md).
 * Si cambian, se actualiza UPDATED y se avisa a las clínicas.
 */

/** Datos del titular de Uywa: se completan al constituir la empresa. */
export const UYWA_COMPANY = {
  name: 'Uywa',
  /** Razón social y RUC del titular */
  owner: 'el titular de Uywa',
  /** Correo para consultas de privacidad y soporte; vacío = no se muestra */
  email: '',
};

export const LEGAL_UPDATED = '2026-10-28';

export interface LegalSection {
  title: string;
  paragraphs: string[];
}

export interface LegalDocument {
  title: string;
  intro: string;
  sections: LegalSection[];
}

const contact = () =>
  UYWA_COMPANY.email
    ? `Puedes escribirnos a ${UYWA_COMPANY.email}.`
    : 'Puedes escribirnos por el canal de soporte de tu clínica.';

export const PRIVACY: LegalDocument = {
  title: 'Política de privacidad',
  intro:
    'Uywa es un sistema de gestión para clínicas veterinarias. Aquí explicamos qué datos personales trata, para qué y cómo se protegen, conforme a la Ley N.° 29733 y su reglamento (D. S. N.° 016-2024-JUS).',
  sections: [
    {
      title: 'Quién es responsable de cada dato',
      paragraphs: [
        'Los datos de los clientes de una clínica (dueños de mascotas) pertenecen a esa clínica: ella es la titular del banco de datos y la responsable de su tratamiento. Uywa los trata solo por encargo de la clínica, para prestarle el servicio, según un contrato de encargo de tratamiento.',
        'Los datos del personal que usa el sistema (nombre, correo, rol y registros de acceso) los trata Uywa para dar acceso seguro y soporte.',
      ],
    },
    {
      title: 'Qué datos se tratan',
      paragraphs: [
        'De los clientes de la clínica: nombre, documento de identidad, celular, correo, dirección, personas autorizadas a recoger a la mascota, datos de la mascota, su historia clínica, cargos y pagos.',
        'Del personal: nombre, correo, rol, colegiatura en el caso de veterinarios, fecha y conexión (IP) de cada ingreso, y las acciones que registra la bitácora.',
      ],
    },
    {
      title: 'Para qué se usan',
      paragraphs: [
        'Para prestar el servicio a la clínica (atenciones, caja, inventario, comprobantes), para la seguridad del sistema (bitácora y prevención de accesos indebidos), para el soporte técnico y para cumplir obligaciones legales.',
        'Uywa no vende datos personales ni usa los datos de los clientes de la clínica para fines propios o publicitarios.',
      ],
    },
    {
      title: 'Portal del dueño',
      paragraphs: [
        'Si la clínica lo activa, el dueño recibe un enlace personal para ver las próximas vacunas y citas de sus mascotas (y, si la clínica lo permite, el carnet y las recetas recientes). Muestra solo su primer nombre: no incluye su documento, celular, dirección ni cuentas.',
        'Desde ese enlace el dueño puede activar avisos en su celular o agregar las fechas a su calendario. Para los avisos se guarda solo la dirección técnica que entrega su navegador; se borra al desactivarlos, al quitar el permiso o al revocar el enlace.',
        'El enlace vence a los 6 meses, la clínica puede desactivarlo en cualquier momento y crear uno nuevo deja sin efecto el anterior. No se indexa en buscadores. Quien tenga el enlace puede ver esa información, por eso no debe compartirse.',
      ],
    },
    {
      title: 'Dónde se guardan y cómo se protegen',
      paragraphs: [
        'Los datos se guardan en servidores de proveedores de nube que pueden estar fuera del Perú. Por eso el consentimiento que firma cada cliente informa ese envío al extranjero.',
        'Medidas de seguridad: conexión cifrada (HTTPS), contraseñas guardadas de forma irreversible, sesiones que vencen, bloqueo tras intentos fallidos, acceso según el rol de cada persona, bitácora de acciones y copias de respaldo diarias guardadas fuera del servidor principal.',
      ],
    },
    {
      title: 'Cuánto tiempo se conservan',
      paragraphs: [
        'Mientras la clínica use Uywa. Si deja de usarlo, puede descargar sus datos y luego se eliminan, salvo lo que la ley obligue a conservar, por ejemplo la información tributaria.',
      ],
    },
    {
      title: 'Derechos de acceso, rectificación, cancelación y oposición',
      paragraphs: [
        'Los clientes de una clínica ejercen sus derechos ante esa clínica. Uywa le da las herramientas: descargar todo lo que guarda de un cliente y borrar sus datos personales cuando lo pida, conservando sin ellos lo que la ley exige.',
        `El personal puede ejercer sus derechos ante Uywa. ${contact()} Si no recibes respuesta, puedes reclamar ante la Autoridad Nacional de Protección de Datos Personales.`,
      ],
    },
    {
      title: 'Incidentes de seguridad',
      paragraphs: [
        'Si ocurre un incidente que afecte datos personales, Uywa avisa a la clínica sin demora y le da la información necesaria para que comunique el incidente a la autoridad y a los afectados en el plazo que fija el reglamento.',
      ],
    },
    {
      title: 'Cambios en esta política',
      paragraphs: [
        'Si esta política cambia, se publica la nueva versión con su fecha y se avisa a las clínicas.',
      ],
    },
  ],
};

export const TERMS: LegalDocument = {
  title: 'Términos del servicio',
  intro:
    'Estas condiciones rigen el uso de Uywa por parte de la clínica veterinaria que lo contrata y de su personal. Al usar el sistema, la clínica las acepta.',
  sections: [
    {
      title: 'El servicio',
      paragraphs: [
        'Uywa es un software por suscripción para gestionar la clínica: clientes y mascotas, cola de atención, atenciones, inventario, caja y, cuando se active, comprobantes electrónicos. Se usa desde el navegador y necesita conexión a internet.',
      ],
    },
    {
      title: 'Cuentas y acceso',
      paragraphs: [
        'La clínica designa a uno o más administradores, que crean las cuentas de su personal y les asignan un rol. Cada persona usa su propia cuenta; las contraseñas son personales y no se comparten.',
        'La clínica es responsable de quitar el acceso a quien deje de trabajar con ella. El sistema registra en una bitácora las acciones importantes de cada usuario.',
      ],
    },
    {
      title: 'Los datos de la clínica',
      paragraphs: [
        'La clínica es dueña de los datos que registra y responsable de contar con el consentimiento de sus clientes, que el sistema pide al registrarlos. Uywa trata esos datos solo para prestar el servicio, según el contrato de encargo de tratamiento y la Política de privacidad.',
        'La clínica puede descargar sus datos en cualquier momento, incluso al terminar el servicio.',
      ],
    },
    {
      title: 'Comprobantes de pago',
      paragraphs: [
        'Mientras no esté activa la facturación electrónica, el sistema emite notas de venta internas, que no son comprobantes de pago. Cuando se active, las boletas y facturas se envían a SUNAT por medio de un proveedor autorizado. La clínica es responsable de la información tributaria que registra.',
      ],
    },
    {
      title: 'Uso correcto',
      paragraphs: [
        'No se permite usar el sistema para fines ilegales, intentar acceder a datos de otras clínicas, sobrecargarlo a propósito ni copiar o revender el software.',
      ],
    },
    {
      title: 'Disponibilidad, respaldo y soporte',
      paragraphs: [
        'Uywa procura que el sistema esté disponible todo el tiempo, hace copias de respaldo diarias y avisa con anticipación los mantenimientos programados. Las caídas de internet de la clínica están fuera de su alcance.',
      ],
    },
    {
      title: 'Precio y pago',
      paragraphs: [
        'El precio y la forma de pago son los del plan contratado. Si un pago se atrasa, Uywa avisa antes de suspender el acceso; los datos se conservan para que la clínica pueda recuperarlos.',
      ],
    },
    {
      title: 'Responsabilidad',
      paragraphs: [
        'Uywa responde por prestar el servicio con diligencia. No responde por decisiones clínicas, comerciales o tributarias que tome la clínica con la información del sistema, ni por daños causados por un uso indebido de las cuentas de su personal.',
      ],
    },
    {
      title: 'Fin del servicio',
      paragraphs: [
        'La clínica puede dejar de usar Uywa cuando quiera. Al terminar, puede descargar sus datos; luego se eliminan, salvo lo que la ley obligue a conservar.',
      ],
    },
    {
      title: 'Ley aplicable y reclamos',
      paragraphs: [`Estos términos se rigen por las leyes del Perú. ${contact()}`],
    },
  ],
};
