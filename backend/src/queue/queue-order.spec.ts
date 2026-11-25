import { describe, expect, it } from 'vitest';
import { queueOrder } from './queue.service.js';

describe('orden de la cola', () => {
  it('consultorio primero, luego urgencias aunque hayan llegado después, luego por estado', () => {
    const list = [
      { name: 'Zarina', status: 'WAITING', urgent: false },
      { name: 'Copo', status: 'ARRIVED', urgent: true },
      { name: 'Luna', status: 'ARRIVED', urgent: false },
      { name: 'Sasha', status: 'IN_PROGRESS', urgent: false },
    ] as const;
    expect([...list].sort(queueOrder).map((x) => x.name)).toEqual([
      'Sasha',
      'Copo',
      'Zarina',
      'Luna',
    ]);
  });
});
