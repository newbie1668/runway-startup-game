'use client';

import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

interface Props {
  children: ReactNode;
  labelledBy: string;
  describedBy?: string;
  dismissible?: boolean;
  onDismiss?: () => void;
  panelClassName: string;
}

/**
 * Native modal wrapper. `showModal()` gives us browser-level background
 * inertness and focus containment instead of trying to recreate either.
 */
export function ModalDialog({
  children,
  labelledBy,
  describedBy,
  dismissible = false,
  onDismiss,
  panelClassName,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!dialog.open) dialog.showModal();
    const initialFocus = dialog.querySelector<HTMLElement>('[data-dialog-autofocus]');
    initialFocus?.focus();

    return () => {
      if (dialog.open) dialog.close();
      queueMicrotask(() => {
        if (previousFocus?.isConnected) previousFocus.focus();
      });
    };
  }, []);

  const dismiss = () => {
    if (dismissible) onDismiss?.();
  };

  const onCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    dismiss();
  };

  const onBackdropClick = (event: ReactMouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) dismiss();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (element) =>
        !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
    );
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={onCancel}
      onClick={onBackdropClick}
      onKeyDown={onKeyDown}
      tabIndex={-1}
      className="runway-dialog fixed inset-0 z-50 m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-transparent p-4 text-slate-200 open:flex open:items-start open:justify-center"
    >
      <div
        className={`runway-dialog-panel my-auto ${panelClassName}`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </dialog>
  );
}
