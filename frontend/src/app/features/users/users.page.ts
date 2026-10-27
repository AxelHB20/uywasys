import { DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, Role } from '../../core/auth/auth.models';
import { SessionService, initialsOf } from '../../core/auth/session.service';
import { TeamMember, UsersService } from '../../core/services/users.service';
import { BadgeComponent, BadgeTone } from '../../shared/ui/badge/badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ModalComponent } from '../../shared/ui/modal/modal.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { apiErrorMessage } from '../../shared/utils/validators';

type Confirmation = { kind: 'reset' | 'deactivate' | 'activate'; member: TeamMember };
type Status = { label: string; tone: BadgeTone };

const ROLES: Role[] = ['ADMIN', 'VET', 'RECEPTION', 'GROOMER', 'CASHIER'];

@Component({
  selector: 'app-users-page',
  imports: [
    ReactiveFormsModule,
    DatePipe,
    NgTemplateOutlet,
    IconComponent,
    BadgeComponent,
    ModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './users.page.html',
})
export class UsersPage implements OnInit {
  private readonly users = inject(UsersService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionService);

  protected readonly roles = ROLES;
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly roleDescriptions = ROLE_DESCRIPTIONS;
  protected readonly myId = computed(() => this.session.user()?.id);

  protected readonly members = signal<TeamMember[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly activeCount = computed(() => this.members().filter((m) => m.active).length);

  // Formulario crear/editar
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<TeamMember | null>(null);
  protected readonly saving = signal(false);
  protected readonly form = new FormGroup({
    fullName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(120)],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email, Validators.maxLength(120)],
    }),
    role: new FormControl<Role>('RECEPTION', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    licenseNumber: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(20)],
    }),
  });
  protected readonly selectedRole = signal<Role>('RECEPTION');

  // Confirmaciones y clave temporal
  protected readonly confirmation = signal<Confirmation | null>(null);
  protected readonly confirming = signal(false);
  protected readonly temporary = signal<{ name: string; email: string; password: string } | null>(
    null,
  );
  protected readonly copied = signal(false);

  constructor() {
    this.form.controls.role.valueChanges.subscribe((role) => {
      this.selectedRole.set(role);
      const license = this.form.controls.licenseNumber;
      license.setValidators(
        role === 'VET'
          ? [Validators.required, Validators.maxLength(20)]
          : [Validators.maxLength(20)],
      );
      license.updateValueAndValidity({ emitEvent: false });
    });
  }

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.users.list().subscribe({
      next: (members) => {
        this.members.set(members);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loadError.set(apiErrorMessage(error, 'No se pudo cargar el equipo.'));
        this.loading.set(false);
      },
    });
  }

  protected status(member: TeamMember): Status {
    if (!member.active) return { label: 'Inactivo', tone: 'neutral' };
    if (member.locked) return { label: 'Bloqueado', tone: 'danger' };
    if (member.mustChangePassword) return { label: 'Clave temporal', tone: 'warning' };
    return { label: 'Activo', tone: 'success' };
  }

  protected initials(name: string): string {
    return initialsOf(name);
  }

  protected openCreate(): void {
    this.editing.set(null);
    this.form.reset({ fullName: '', email: '', role: 'RECEPTION', licenseNumber: '' });
    this.form.controls.email.enable();
    this.formOpen.set(true);
  }

  protected openEdit(member: TeamMember): void {
    this.editing.set(member);
    this.form.reset({
      fullName: member.fullName,
      email: member.email,
      role: member.role,
      licenseNumber: member.licenseNumber ?? '',
    });
    this.form.controls.email.disable();
    this.formOpen.set(true);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      document.querySelector<HTMLElement>('dialog form [aria-invalid="true"]')?.focus();
      return;
    }
    const value = this.form.getRawValue();
    const data = {
      fullName: value.fullName.trim(),
      role: value.role,
      licenseNumber: value.licenseNumber.trim() || null,
    };
    const editing = this.editing();
    this.saving.set(true);

    if (editing) {
      this.users.update(editing.id, data).subscribe({
        next: (member) => {
          this.replace(member);
          this.finishForm();
          this.toast.success('Usuario actualizado');
        },
        error: (error: unknown) => this.failForm(error),
      });
      return;
    }

    this.users.create({ ...data, email: value.email.trim().toLowerCase() }).subscribe({
      next: ({ user, temporaryPassword }) => {
        this.members.update((list) =>
          [...list, user].sort((a, b) => a.fullName.localeCompare(b.fullName, 'es')),
        );
        this.finishForm();
        this.showTemporary(user, temporaryPassword);
      },
      error: (error: unknown) => this.failForm(error),
    });
  }

  protected ask(kind: Confirmation['kind'], member: TeamMember): void {
    this.confirmation.set({ kind, member });
  }

  protected confirm(): void {
    const pending = this.confirmation();
    if (!pending) return;
    const { kind, member } = pending;
    this.confirming.set(true);

    if (kind === 'reset') {
      this.users.resetPassword(member.id).subscribe({
        next: ({ temporaryPassword }) => {
          this.replace({ ...member, mustChangePassword: true, locked: false });
          this.closeConfirmation();
          this.showTemporary(member, temporaryPassword);
        },
        error: (error: unknown) => this.failConfirmation(error),
      });
      return;
    }

    this.users.update(member.id, { active: kind === 'activate' }).subscribe({
      next: (updated) => {
        this.replace(updated);
        this.closeConfirmation();
        this.toast.success(
          kind === 'activate'
            ? `${updated.fullName} puede volver a ingresar`
            : `${updated.fullName} ya no puede ingresar`,
        );
      },
      error: (error: unknown) => this.failConfirmation(error),
    });
  }

  protected closeConfirmation(): void {
    this.confirming.set(false);
    this.confirmation.set(null);
  }

  protected async copyPassword(): Promise<void> {
    const temp = this.temporary();
    if (!temp) return;
    try {
      await navigator.clipboard.writeText(temp.password);
      this.copied.set(true);
    } catch {
      this.toast.info('No se pudo copiar. Selecciona la clave y cópiala a mano.');
    }
  }

  protected invalid(name: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[name];
    return control.invalid && control.touched;
  }

  private showTemporary(member: Pick<TeamMember, 'fullName' | 'email'>, password: string): void {
    this.copied.set(false);
    this.temporary.set({ name: member.fullName, email: member.email, password });
  }

  private replace(member: TeamMember): void {
    this.members.update((list) => list.map((m) => (m.id === member.id ? member : m)));
  }

  private finishForm(): void {
    this.saving.set(false);
    this.formOpen.set(false);
  }

  private failForm(error: unknown): void {
    this.saving.set(false);
    this.toast.error(apiErrorMessage(error));
  }

  private failConfirmation(error: unknown): void {
    this.confirming.set(false);
    this.confirmation.set(null);
    this.toast.error(apiErrorMessage(error));
  }
}
