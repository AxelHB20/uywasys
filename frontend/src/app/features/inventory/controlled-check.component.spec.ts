import { Component } from '@angular/core';
import { FormControl } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { ControlledCheckComponent } from './controlled-check.component';
import '../../shared/testing';

@Component({
  imports: [ControlledCheckComponent],
  template: `<app-controlled-check [control]="control" />`,
})
class Host {
  readonly control = new FormControl(false, { nonNullable: true });
}

describe('ControlledCheckComponent (psicotrópico)', () => {
  it('no se marca hasta confirmar; "No, cancelar" lo deja como estaba', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const box = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.control.value).toBe(false);
    expect(document.body.textContent).toContain('¿Es un estupefaciente o psicotrópico?');
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('dialog button')];
    buttons.find((b) => b.textContent?.includes('No, cancelar'))!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.control.value).toBe(false);
    box.click();
    fixture.detectChanges();
    [...document.querySelectorAll<HTMLButtonElement>('dialog button')]
      .find((b) => b.textContent?.includes('Sí, es psicotrópico'))!
      .click();
    fixture.detectChanges();
    expect(fixture.componentInstance.control.value).toBe(true);
  });
});
