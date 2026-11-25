import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

/** Monta una página de Reportes con HTTP de prueba y la dirección dada */
export async function mountReport<T>(page: Type<T>, url = '/') {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  const http = TestBed.inject(HttpTestingController);
  await TestBed.inject(Router).navigateByUrl(url);
  const fixture = TestBed.createComponent(page);
  await settle(fixture);
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
}

/** Deja que corran las señales, el recurso y la vista */
export async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
  }
}

export const buttonByText = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.replace(/\s+/g, ' ').trim().startsWith(text),
  );
