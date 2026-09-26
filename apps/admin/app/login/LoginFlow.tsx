"use client";

import QRCode from "qrcode";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { bff, errorText } from "../../components/bff";

type Step = "credentials" | "code" | "enrol" | "recovery";

export function LoginFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enrol, setEnrol] = useState<{ qr: string; secret: string; codes: string[] } | null>(null);
  const [saved, setSaved] = useState(false);

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const err = await fn();
    setBusy(false);
    if (err) setError(err);
  }

  const finish = () => {
    router.push("/");
    router.refresh();
  };

  const submitCredentials = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await bff("auth/login", "POST", { email, password });
      if (r.status !== 200) return r.status === 401 ? "Email or password is incorrect." : errorText(r);
      setPassword("");
      setStep(r.body.mfa_enrolled ? "code" : "enrol");
      return null;
    });
  };

  const startEnrol = () =>
    run(async () => {
      const r = await bff("auth/mfa/enrol", "POST");
      if (r.status !== 200) return errorText(r);
      setEnrol({ qr: await QRCode.toDataURL(r.body.qr_uri), secret: r.body.secret, codes: r.body.recovery_codes });
      return null;
    });

  const submitEnrolCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const c = await bff("auth/mfa/confirm", "POST", { code });
      if (c.status !== 204 && c.status !== 200) return errorText(c);
      const v = await bff("auth/mfa/verify", "POST", { code });
      if (v.status !== 200) return errorText(v);
      finish();
      return null;
    });
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await bff("auth/mfa/verify", "POST", { code });
      if (r.status !== 200) return r.status === 401 ? "That code is not correct or was already used." : errorText(r);
      finish();
      return null;
    });
  };

  const submitRecovery = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await bff("auth/mfa/recovery", "POST", { recovery_code: recovery });
      if (r.status !== 200) return "That recovery code is not valid.";
      finish();
      return null;
    });
  };

  return (
    <>
      {step === "credentials" && (
        <form onSubmit={submitCredentials}>
          <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} /></div>
          <div className="field"><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%" }} /></div>
          <button className="primary" disabled={busy}>Continue</button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={submitCode}>
          <p>Enter the 6-digit code from your authenticator app.</p>
          <div className="field"><label htmlFor="code">Code</label><input id="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} /></div>
          <div className="row"><button className="primary" disabled={busy}>Sign in</button><button type="button" onClick={() => { setError(null); setStep("recovery"); }}>Lost your device?</button></div>
        </form>
      )}

      {step === "recovery" && (
        <form onSubmit={submitRecovery}>
          <p>Enter one of your recovery codes. Each works once.</p>
          <div className="field"><label htmlFor="rc">Recovery code</label><input id="rc" required value={recovery} onChange={(e) => setRecovery(e.target.value)} /></div>
          <div className="row"><button className="primary" disabled={busy}>Sign in</button><button type="button" onClick={() => setStep("code")}>Back</button></div>
        </form>
      )}

      {step === "enrol" && !enrol && (
        <>
          <p>Multi-factor sign-in is mandatory for every admin. Set up an authenticator app to continue.</p>
          <button className="primary" disabled={busy} onClick={startEnrol}>Set up authenticator</button>
        </>
      )}

      {step === "enrol" && enrol && (
        <form onSubmit={submitEnrolCode}>
          <p>Scan this code with your authenticator app, or type the key by hand.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrol.qr} alt="Authenticator QR code" width={180} height={180} />
          <p className="muted">Key: <code>{enrol.secret}</code></p>
          <h3>Recovery codes</h3>
          <p className="muted">Shown once. Store them somewhere safe: each lets you in once if you lose your device.</p>
          <div className="codes">{enrol.codes.map((c) => <div key={c}>{c}</div>)}</div>
          <p><label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I saved these recovery codes</label></p>
          <div className="field"><label htmlFor="ecode">Code from the app</label><input id="ecode" inputMode="numeric" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} /></div>
          <button className="primary" disabled={busy || !saved}>Confirm and sign in</button>
        </form>
      )}

      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
