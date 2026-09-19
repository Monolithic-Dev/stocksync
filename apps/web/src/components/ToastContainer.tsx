import { useToastQueue, type Toast, type ToastVariant } from "../state/ToastContext";
import { AlertTriangleIcon, CheckCircleIcon, XCircleIcon, XIcon } from "./icons";

const VARIANT_STYLE: Record<ToastVariant, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  error: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300",
  info: "border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
};

const VARIANT_ICON: Record<ToastVariant, typeof CheckCircleIcon> = {
  success: CheckCircleIcon,
  error: XCircleIcon,
  info: AlertTriangleIcon,
};

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const Icon = VARIANT_ICON[toast.variant];
  return (
    <div
      role="status"
      className={`flex animate-[toastIn_150ms_ease-out] items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg ${VARIANT_STYLE[toast.variant]}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Renders the shared toast queue fixed to the bottom-right — mount once, at the app root. */
export function ToastContainer() {
  const { toasts, dismissToast } = useToastQueue();
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>
  );
}
