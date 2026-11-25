import { Resource, Signal, computed } from '@angular/core';

/**
 * Lo último que llegó de un recurso (también mientras carga lo siguiente), o `undefined` si aún no
 * llega nada o el servidor falló.
 *
 * `resource.value()` lanza un error cuando el recurso falló, y si eso pasa dentro de un `computed`
 * o del template la pantalla entera queda en blanco. Leer siempre el valor con esto (o preguntar
 * antes `hasValue()`); el aviso de error lo muestra el template con `resource.error()`.
 */
export function loaded<T>(resource: Resource<T>): Signal<T | undefined> {
  // Mientras carga lo nuevo (otro filtro, otra página) se queda lo anterior: la lista no se
  // vacía, la página no se achica y no salta arriba
  let last: T | undefined;
  return computed(() => {
    if (resource.hasValue()) return (last = resource.value());
    if (resource.isLoading()) return last;
    return (last = undefined);
  });
}
