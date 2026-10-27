/** jsdom no implementa showModal/close de <dialog>: se simulan con el atributo open. */
export function stubDialog(): void {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}

export const tick = () => new Promise((resolve) => setTimeout(resolve));
