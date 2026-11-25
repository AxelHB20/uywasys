import { PetSex, Species } from './clients.models';

export type LabStatus = 'REQUESTED' | 'SAMPLE_TAKEN' | 'RESULT_READY' | 'REVIEWED' | 'CANCELLED';
export type LabFilter = 'pending' | 'ready' | 'reviewed' | 'cancelled' | 'all';

export interface LabOrder {
  id: number;
  code: string;
  status: LabStatus;
  destination: 'IN_HOUSE' | 'EXTERNAL';
  externalLab: string | null;
  labCost: number | null;
  indication: string | null;
  visitId: number;
  pet: {
    id: number;
    number: number;
    name: string;
    species: Species;
    breed: string | null;
    sex: PetSex | null;
    birthDate: string | null;
    weightKg: number | null;
  };
  client: { id: number; name: string; phone: string };
  items: { id: number; name: string; careServiceId: number; charged: boolean }[];
  total: number;
  /** Lo ya pagado en caja: al cancelar, eso se queda */
  paid: number;
  requestedAt: string;
  requestedBy: string;
  sampleAt: string | null;
  sampleBy: string | null;
  resultAt: string | null;
  resultBy: string | null;
  resultText: string | null;
  attachment: { id: number; fileName: string; mime: string } | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  interpretation: string | null;
  notifiedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  waitingDays: number | null;
  overdue: boolean;
}

export type LabPlace = 'IN_HOUSE' | 'EXTERNAL';

/** Una página de Exámenes con los números de cada pestaña */
export interface LabOrderPage {
  items: LabOrder[];
  hasMore: boolean;
  counts: { pending: number; ready: number; reviewed: number; overdue: number; toNotify: number };
}

export interface LabListQuery {
  status: LabFilter;
  q?: string;
  destination?: LabPlace | null;
  skip?: number;
  take?: number;
}

export interface LabOrderInput {
  careServiceIds: number[];
  destination: 'IN_HOUSE' | 'EXTERNAL';
  externalLab: string | null;
  labCost: number | null;
  indication: string | null;
  charge: boolean;
}

export const LAB_STATUS_LABELS: Record<LabStatus, string> = {
  REQUESTED: 'Pedido',
  SAMPLE_TAKEN: 'Muestra tomada',
  RESULT_READY: 'Por revisar',
  REVIEWED: 'Revisado',
  CANCELLED: 'Cancelado',
};

/** Los pasos que se ven en cada pedido (cancelado se muestra aparte) */
export const LAB_STEPS: { status: LabStatus; label: string }[] = [
  { status: 'REQUESTED', label: 'Pedido' },
  { status: 'SAMPLE_TAKEN', label: 'Muestra' },
  { status: 'RESULT_READY', label: 'Resultado' },
  { status: 'REVIEWED', label: 'Revisado' },
];

/** Mensaje para avisar al dueño (solo con el resultado revisado) */
export function labWhatsapp(order: LabOrder, clinicName: string): string {
  const exams = order.items.map((i) => i.name).join(', ');
  const text = `Hola, le escribimos de ${clinicName}. Ya tenemos el resultado de ${exams} de ${order.pet.name} y el veterinario lo revisó. ¿Desea que se lo expliquemos por aquí o prefiere venir a la clínica?`;
  return `https://wa.me/51${order.client.phone}?text=${encodeURIComponent(text)}`;
}
