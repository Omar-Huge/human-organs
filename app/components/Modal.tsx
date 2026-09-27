'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog.
 *
 * Implements the four things a dialog has to get right and is usually missing at least
 * one of: focus moves in on open, Tab is trapped inside, Escape closes, and focus
 * returns to whatever opened it. The last one matters most — without it a keyboard
 * user who closes a dialog is dumped at the top of the document with no idea where
 * they were.
 */
export default function Modal({ open, title, onClose, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      // Wrap in both directions rather than letting focus escape to the page behind.
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;

    // Remember the trigger before moving focus, so it can be handed back on close.
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const panel = panelRef.current;
    const target = panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
    target?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = overflow;
      restoreRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-graphite/45 p-0 md:items-center md:p-6"
      onKeyDown={handleKeyDown}
    >
      {/*
        A click-catcher sibling rather than a handler on the backdrop container, so a
        click that starts inside the panel and drags out does not dismiss it.
      */}
      <button
        type="button"
        aria-label={`Close ${title}`}
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto border border-trace bg-paper p-5 md:max-h-[80vh]"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="font-display text-lg text-graphite">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="tool-button shrink-0"
            aria-label={`Close ${title}`}
          >
            <X size={14} aria-hidden="true" />
            Close
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}
