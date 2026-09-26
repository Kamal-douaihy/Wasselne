"use client";

import { useId, useRef, useState } from "react";

/** Every sensitive action asks for a reason first (03_Admin_Console §3.3): Confirm stays disabled until one is typed. */
export function ReasonButton(props: {
  label: string;
  title: string;
  minLength?: number;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<string | null>; // returns an error message or null on success
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const fieldId = useId(); // one dialog per button: ids must be unique for label association
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const min = props.minLength ?? 3;

  async function confirm() {
    setBusy(true);
    setError(null);
    const err = await props.onConfirm(reason.trim());
    setBusy(false);
    if (err) setError(err);
    else {
      ref.current?.close();
      setReason("");
    }
  }

  return (
    <>
      <button className={props.danger ? "danger" : ""} onClick={() => ref.current?.showModal()}>
        {props.label}
      </button>
      <dialog ref={ref}>
        <h3 style={{ marginTop: 0 }}>{props.title}</h3>
        <div className="field">
          <label htmlFor={fieldId}>Reason (required, recorded in the audit log)</label>
          <textarea id={fieldId} rows={3} style={{ width: "100%" }} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button onClick={() => ref.current?.close()}>Cancel</button>
          <button className="primary" disabled={busy || reason.trim().length < min} onClick={confirm}>
            {busy ? "Working…" : "Confirm"}
          </button>
        </div>
      </dialog>
    </>
  );
}
