import React, { useState } from "react";

interface ModalDialogProps {
  title: string;
  message: string;
  mode: "info" | "confirm" | "prompt";
  defaultValue?: string;
  onClose: (result: string | boolean | null) => void;
}

export const ModalDialog: React.FC<ModalDialogProps> = ({
  title,
  message,
  mode,
  defaultValue = "",
  onClose,
}) => {
  const [val, setVal] = useState(defaultValue);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-xl border border-slate-200">
        <div className="flex h-1.5">
          <div className="flex-1 bg-[#009246]" />
          <div className="flex-1 bg-white" />
          <div className="flex-1 bg-[#CE2B37]" />
        </div>
        <div className="bg-[#1f2a37] px-4 py-3 text-white font-semibold text-sm">
          {title}
        </div>
        <div className="p-5 space-y-4">
          <p className="whitespace-pre-line text-sm text-slate-700 leading-relaxed">
            {message}
          </p>
          {mode === "prompt" && (
            <input
              type="text"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onClose(val);
              }}
              autoFocus
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#009246] focus:outline-none"
            />
          )}
          <div className="flex justify-end gap-2 pt-2">
            {mode !== "info" && (
              <button
                type="button"
                onClick={() => onClose(mode === "prompt" ? null : false)}
                className="rounded border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                onClose(mode === "prompt" ? val : mode === "confirm" ? true : true)
              }
              className="rounded bg-[#009246] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#007a3a]"
            >
              {mode === "confirm" ? "Confirmar" : "OK"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
