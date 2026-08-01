import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./ui.js";

export function Modal({
  title,
  onClose,
  children,
  dismissable = true,
  size = "md",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  dismissable?: boolean;
  size?: "md" | "xl";
}) {
  const titleId = useId();

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={dismissable ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`max-h-[calc(100vh-2rem)] w-full overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 ${
          size === "xl" ? "max-w-4xl" : "max-w-md"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="font-semibold">{title}</h2>
          {dismissable && (
            <button
              type="button"
              aria-label="Close dialog"
              onClick={onClose}
              className="cursor-pointer rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={danger ? "danger" : "primary"} busy={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
