import { Injectable, inject } from '@angular/core';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

interface NotificationOptions {
  message: string;
  type?: NotificationType;
  duration?: number;
  action?: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);

  private readonly defaultDuration = 4000;
  private readonly errorDuration = 8000;

  private readonly panelClasses: Record<NotificationType, string> = {
    success: 'notification-success',
    error: 'notification-error',
    warning: 'notification-warning',
    info: 'notification-info',
  };

  show(options: NotificationOptions): void {
    const { message, type = 'info', duration, action = 'Dismiss' } = options;

    const config: MatSnackBarConfig = {
      duration: duration ?? (type === 'error' ? this.errorDuration : this.defaultDuration),
      horizontalPosition: 'right',
      verticalPosition: 'bottom',
      panelClass: [this.panelClasses[type]],
    };

    this.snackBar.open(message, action, config);
  }

  success(message: string, duration?: number): void {
    this.show({ message, type: 'success', duration });
  }

  error(message: string, duration?: number): void {
    this.show({ message, type: 'error', duration });
  }

  warning(message: string, duration?: number): void {
    this.show({ message, type: 'warning', duration });
  }

  info(message: string, duration?: number): void {
    this.show({ message, type: 'info', duration });
  }

  dismiss(): void {
    this.snackBar.dismiss();
  }
}
