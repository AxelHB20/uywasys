import { PetSex, Species } from './clients.models';
import { ImmunizationKind } from './medical.models';

/** Estado del enlace del portal de un cliente (el token no vuelve: solo se ve al generarlo) */
export interface PortalLinkStatus {
  active: boolean;
  createdAt: string | null;
  expiresAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
  createdBy: string | null;
}

export interface PortalImmunization {
  id: number;
  kind: ImmunizationKind;
  name: string;
  laboratory: string | null;
  batchNumber: string | null;
  appliedAt: string;
  nextDueAt: string | null;
  external: boolean;
  externalClinic: string | null;
  appliedBy: string | null;
  licenseNumber: string | null;
}

export interface PortalAppointment {
  id: number;
  startsAt: string;
  durationMin: number;
  type: string;
  reason: string | null;
  status: 'SCHEDULED' | 'CONFIRMED';
  vet: string | null;
}

export interface PortalPrescription {
  id: number;
  number: number;
  createdAt: string;
  vet: string;
  licenseNumber: string | null;
  notes: string | null;
  items: {
    drug: string;
    dose: string;
    route: string | null;
    frequency: string;
    duration: string;
    instructions: string | null;
  }[];
}

export interface PortalPet {
  id: number;
  number: number;
  name: string;
  species: Species;
  breed: string | null;
  sex: PetSex | null;
  neutered: boolean;
  birthDate: string | null;
  birthDateEstimated: boolean;
  weightKg: number | null;
  microchip: string | null;
  immunizations: PortalImmunization[];
  appointments: PortalAppointment[];
  prescriptions: PortalPrescription[];
}

export interface PortalView {
  clinic: { name: string; address: string | null; phone: string | null; hasLogo: boolean };
  ownerFirstName: string;
  expiresAt: string;
  /** La clínica muestra el carnet completo y las recetas; si no, solo próximas dosis y citas */
  showRecords: boolean;
  pets: PortalPet[];
}

/** Lo último aplicado de cada vacuna o antiparasitario, con su próximo refuerzo */
export function nextDoses(items: PortalImmunization[]): PortalImmunization[] {
  const latest = new Map<string, PortalImmunization>();
  for (const i of items) {
    const key = `${i.kind}|${i.name.trim().toLowerCase()}`;
    const prev = latest.get(key);
    if (!prev || i.appliedAt > prev.appliedAt) latest.set(key, i);
  }
  return [...latest.values()]
    .filter((i) => i.nextDueAt)
    .sort((a, b) => a.nextDueAt!.localeCompare(b.nextDueAt!));
}

/** Mensaje para enviar el enlace por WhatsApp */
export function portalWhatsapp(phone: string, firstName: string, clinic: string, url: string) {
  const text = `Hola ${firstName}, te saluda ${clinic}. En este enlace puedes ver las próximas vacunas y citas de tus mascotas, y activar recordatorios gratis en tu celular: ${url}\nEs personal, no lo compartas.`;
  return `https://wa.me/51${phone}?text=${encodeURIComponent(text)}`;
}
