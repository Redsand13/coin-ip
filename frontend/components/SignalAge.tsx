"use client";

import { useState, useEffect } from "react";

/**
 * Renders a live "Xs ago / Xm Xs ago / Xh Xm ago" label that updates itself
 * every second — isolated so the parent component never re-renders.
 */
export function SignalAge({ ts, className }: { ts: number; className?: string }) {
  const [label, setLabel] = useState(() => calcLabel(ts));

  useEffect(() => {
    setLabel(calcLabel(ts));
    const t = setInterval(() => setLabel(calcLabel(ts)), 1000);
    return () => clearInterval(t);
  }, [ts]);

  return <span className={className} suppressHydrationWarning>{label}</span>;
}

/**
 * "X seconds ago" display used in the scan header (e.g. "Scanned 12s ago").
 */
export function ScannedAgo({ ts, className }: { ts: number; className?: string }) {
  const [secs, setSecs] = useState(() => Math.floor((Date.now() - ts) / 1000));

  useEffect(() => {
    setSecs(Math.floor((Date.now() - ts) / 1000));
    const t = setInterval(() => setSecs(Math.floor((Date.now() - ts) / 1000)), 1000);
    return () => clearInterval(t);
  }, [ts]);

  return <span className={className} suppressHydrationWarning>{secs}s ago</span>;
}

function calcLabel(ts: number): string {
  const secs = Math.floor(Math.max(0, Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}
