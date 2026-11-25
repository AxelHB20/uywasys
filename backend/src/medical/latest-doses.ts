/** Lo último de cada vacuna o antiparasitario (la lista llega de la más reciente a la más antigua) */
export function latestDoses<T extends { kind: string; name: string }>(
  items: T[],
): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = `${i.kind}:${i.name.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
