"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function SearchBox({ base, initial, extra }: { base: string; initial: string; extra?: Record<string, string> }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams({ ...(extra ?? {}), ...(q ? { q } : {}) });
    router.push(`${base}?${p.toString()}`);
  };
  return (
    <form onSubmit={submit} className="row" role="search" style={{ marginBottom: 12 }}>
      <input aria-label="Search" placeholder="Search name, phone or plate" value={q} onChange={(e) => setQ(e.target.value)} />
      <button>Search</button>
    </form>
  );
}
