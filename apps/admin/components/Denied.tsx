export function LoadError({ status, message }: { status: number; message: string }) {
  if (status === 403) {
    return (
      <div className="card" role="alert">
        <h3 style={{ marginTop: 0 }}>You don&apos;t have permission to view this</h3>
        <p className="muted">This attempt was logged. If you need access, ask a super admin.</p>
      </div>
    );
  }
  return <p className="error" role="alert">{message}</p>;
}
