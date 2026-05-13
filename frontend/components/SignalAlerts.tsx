"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import { X, TrendingUp, TrendingDown, Target, Zap, Bell, BellOff, BellRing } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertPage = "Binance Futures" | "ICT / SMC";

export interface SignalAlert {
  id: string;
  page: AlertPage;
  symbol: string;
  name: string;
  image?: string;
  signalType: "BUY" | "SELL" | "LONG" | "SHORT";
  timeframe: string;
  score: number;
  setupType?: string;
  createdAt: number;
}

// ─── Browser Notification API helpers ────────────────────────────────────────

type PermState = "default" | "granted" | "denied" | "unsupported";

function getBrowserPerm(): PermState {
  if (typeof window === "undefined") return "unsupported";
  // Notifications require a secure context (HTTPS or localhost).
  // On plain HTTP, Chrome reports "denied" without prompting — surface this as "unsupported".
  if (!window.isSecureContext) return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission as PermState;
}

async function requestBrowserPerm(): Promise<PermState> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission as PermState;
  const result = await Notification.requestPermission();
  return result as PermState;
}

// ─── Web Push subscription management ────────────────────────────────────────

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function urlBase64ToUint8Array(base64String: string): any {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)));
}

let swRegistration: ServiceWorkerRegistration | null = null;

async function getSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  if (swRegistration) return swRegistration;
  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return swRegistration;
  } catch {
    return null;
  }
}

async function getPushSubscription(): Promise<PushSubscription | null> {
  const reg = await getSwRegistration();
  if (!reg) return null;
  try {
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

async function subscribeToPush(): Promise<PushSubscription | null> {
  const reg = await getSwRegistration();
  if (!reg || !VAPID_PUBLIC_KEY) return null;
  try {
    const existing = await reg.pushManager.getSubscription();
    if (existing) return existing;
    return await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  } catch {
    return null;
  }
}

async function syncSubscriptionToServer(pages: string[]) {
  const sub = pages.length > 0 ? await subscribeToPush() : await getPushSubscription();
  if (!sub) return;

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys) return;

  if (pages.length === 0) {
    // No pages enabled — remove subscription from server
    await fetch("/api/push", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint }),
    }).catch(() => {});
    return;
  }

  await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, pages }),
  }).catch(() => {});
}

async function fireNativeNotification(alert: SignalAlert) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const isBull = alert.signalType === "BUY" || alert.signalType === "LONG";
  const emoji = isBull ? "🟢" : "🔴";
  const pageLabel = alert.page === "ICT / SMC" ? "ICT/SMC" : "Binance";

  const title = `${emoji} ${alert.symbol} ${alert.signalType}  |  Score ${alert.score}`;
  const lines: string[] = [
    `📊 ${alert.name}`,
    `⏱  Timeframe: ${alert.timeframe.toUpperCase()}`,
    `📍 Page: ${pageLabel}`,
  ];
  if (alert.setupType) lines.push(`🔷 Setup: ${alert.setupType}`);
  lines.push(`⚡ Signal Score: ${alert.score}/100`);

  const options: NotificationOptions = {
    body: lines.join("\n"),
    icon: alert.image || "/favicon.ico",
  };

  // Prefer service worker showNotification() — required by Chrome when a SW is registered
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, options);
      return;
    }
  } catch {
    // SW not available or failed — fall through to direct Notification
  }

  try {
    const n = new Notification(title, options);
    setTimeout(() => n.close(), 9000);
  } catch {
    // Silently blocked by browser policy
  }
}

// ─── Per-page enabled state — persisted in localStorage ──────────────────────
// Each page has its own enabled flag, independent of the other.
// State survives page navigation, refresh, and tab close.

const LS_KEY = "coinpree_alert_prefs_v1";

function loadPersistedEnabled(): Record<AlertPage, boolean> {
  if (typeof window === "undefined") return { "Binance Futures": false, "ICT / SMC": false };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { "Binance Futures": false, "ICT / SMC": false };
    return JSON.parse(raw) as Record<AlertPage, boolean>;
  } catch {
    return { "Binance Futures": false, "ICT / SMC": false };
  }
}

function persistEnabled(state: Record<AlertPage, boolean>) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* quota */ }
}

// Initialise from localStorage immediately — so state is correct before any component mounts
const pageEnabled: Record<AlertPage, boolean> = loadPersistedEnabled();

// ─── Global pub/sub ───────────────────────────────────────────────────────────

type AlertListener  = (alerts: SignalAlert[]) => void;
type PermListener   = (perm: PermState) => void;
type EnabledListener = (page: AlertPage, enabled: boolean) => void;
type CountListener  = (page: AlertPage, count: number) => void;

const alertListeners   = new Set<AlertListener>();
const permListeners    = new Set<PermListener>();
const enabledListeners = new Set<EnabledListener>();
const countListeners   = new Set<CountListener>();

let globalAlerts: SignalAlert[] = [];
let globalPerm: PermState = "default";
const globalCount: Record<AlertPage, number> = { "Binance Futures": 0, "ICT / SMC": 0 };

function broadcastAlerts()  { alertListeners.forEach(fn => fn([...globalAlerts])); }
function broadcastPerm()    { permListeners.forEach(fn => fn(globalPerm)); }
function broadcastEnabled(page: AlertPage) {
  enabledListeners.forEach(fn => fn(page, pageEnabled[page]));
}
function broadcastCount(page: AlertPage) {
  countListeners.forEach(fn => fn(page, globalCount[page]));
}

export function subscribeAlerts(fn: AlertListener)   { alertListeners.add(fn);   return () => { alertListeners.delete(fn); }; }
export function subscribePerm(fn: PermListener)      { permListeners.add(fn);    return () => { permListeners.delete(fn); }; }
export function subscribeEnabled(fn: EnabledListener){ enabledListeners.add(fn); return () => { enabledListeners.delete(fn); }; }
export function subscribeCount(fn: CountListener)    { countListeners.add(fn);   return () => { countListeners.delete(fn); }; }

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fire alerts for a specific page. Only runs if that page's alerts are enabled
 * AND browser permission is granted.
 */
export function pushAlerts(page: AlertPage, incoming: Omit<SignalAlert, "id" | "createdAt" | "page">[]) {
  if (incoming.length === 0) return;
  if (!pageEnabled[page]) return;
  if (globalPerm !== "granted") return;

  const now = Date.now();
  const fresh: SignalAlert[] = incoming.map((a, i) => ({
    ...a,
    page,
    id: `${now}-${i}-${a.symbol}`,
    createdAt: now,
  }));

  // In-app toasts — cap at 8 total visible
  globalAlerts = [...fresh, ...globalAlerts].slice(0, 8);
  globalCount[page] += fresh.length;

  broadcastAlerts();
  broadcastCount(page);

  // Native OS notifications — one per signal
  fresh.forEach(fireNativeNotification);
}

export function dismissAlert(id: string) {
  globalAlerts = globalAlerts.filter(a => a.id !== id);
  broadcastAlerts();
}

export function clearPageCount(page: AlertPage) {
  globalCount[page] = 0;
  broadcastCount(page);
}

/**
 * Request browser permission then enable a specific page's alerts.
 * Persists the enabled state to localStorage so it survives navigation/refresh.
 */
export async function enablePageAlerts(page: AlertPage): Promise<PermState> {
  const perm = await requestBrowserPerm();
  globalPerm = perm;
  broadcastPerm();

  if (perm === "granted") {
    pageEnabled[page] = true;
    persistEnabled(pageEnabled);
    broadcastEnabled(page);
    // Register SW + subscribe to Web Push so notifications work when tab is closed
    const enabledPages = (Object.keys(pageEnabled) as AlertPage[]).filter(p => pageEnabled[p]);
    syncSubscriptionToServer(enabledPages).catch(() => {});
  }

  return perm;
}

export function disablePageAlerts(page: AlertPage) {
  pageEnabled[page] = false;
  persistEnabled(pageEnabled);
  globalAlerts = globalAlerts.filter(a => a.page !== page);
  globalCount[page] = 0;
  broadcastEnabled(page);
  broadcastAlerts();
  broadcastCount(page);
  // Update server subscription — remove this page from push targets
  const enabledPages = (Object.keys(pageEnabled) as AlertPage[]).filter(p => pageEnabled[p]);
  syncSubscriptionToServer(enabledPages).catch(() => {});
}

// ─── Single toast card ────────────────────────────────────────────────────────

const DISMISS_MS = 9000;

function AlertCard({ alert, onDismiss }: { alert: SignalAlert; onDismiss: () => void }) {
  const [exiting, setExiting] = useState(false);
  const [progress, setProgress] = useState(100);
  const startRef = useRef(Date.now());
  const rafRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(onDismiss, 300);
  }, [onDismiss]);

  useEffect(() => {
    startRef.current = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const pct = Math.max(0, 100 - (elapsed / DISMISS_MS) * 100);
      setProgress(pct);
      if (pct > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        dismiss();
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [dismiss]);

  const isBull    = alert.signalType === "BUY" || alert.signalType === "LONG";
  const isICT     = alert.page === "ICT / SMC";
  const accent    = isBull ? "#0ecb81" : "#f6465d";

  return (
    <div
      className={cn(
        "relative w-[320px] rounded-xl border shadow-2xl overflow-hidden",
        "transition-all duration-300 ease-out",
        isBull ? "border-[#0ecb81]/25" : "border-[#f6465d]/25",
        exiting ? "opacity-0 translate-x-full scale-95" : "opacity-100 translate-x-0 scale-100",
      )}
      style={{ background: "hsl(var(--card))" }}
    >
      {/* Left accent bar */}
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent }} />

      {/* Countdown progress bar */}
      <div
        className="absolute bottom-0 left-1 right-0 h-[2px] transition-none"
        style={{ background: accent, width: `${progress}%`, opacity: 0.45 }}
      />

      <div className="pl-4 pr-3 py-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            {isICT
              ? <Target size={11} className="text-muted-foreground" />
              : <Zap size={11} className="text-muted-foreground" />
            }
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {alert.page}
            </span>
            <span className="text-[9px] text-muted-foreground/50">· New Signal</span>
          </div>
          <button
            onClick={dismiss}
            className="text-muted-foreground/40 hover:text-muted-foreground transition-colors p-0.5 rounded"
          >
            <X size={13} />
          </button>
        </div>

        {/* Coin row */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-muted flex-shrink-0 flex items-center justify-center overflow-hidden border border-border">
            {alert.image
              ? <img src={alert.image} alt={alert.symbol} className="w-full h-full object-cover" loading="lazy" />
              : <span className="text-[10px] font-bold text-muted-foreground">{alert.symbol.slice(0, 2)}</span>
            }
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-black text-[15px] text-foreground leading-none">{alert.symbol}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: `${accent}20`, color: accent }}>
                {alert.signalType}
              </span>
              <span className="text-[10px] font-black tabular-nums ml-auto" style={{ color: accent }}>
                {alert.score}
              </span>
            </div>

            <p className="text-[11px] text-muted-foreground font-medium truncate leading-none mb-1">
              {alert.name}
            </p>

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px] font-bold uppercase tracking-wide bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                {alert.timeframe}
              </span>
              {alert.setupType && (
                <span className="text-[9px] font-bold uppercase tracking-wide bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                  {alert.setupType}
                </span>
              )}
              <span className="ml-auto">
                {isBull
                  ? <TrendingUp size={12} style={{ color: accent }} />
                  : <TrendingDown size={12} style={{ color: accent }} />
                }
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Toast stack (mounted once in root layout) ────────────────────────────────

export function SignalAlertContainer() {
  const [alerts, setAlerts] = useState<SignalAlert[]>([]);

  // On mount: register SW early so it's ready before the user enables alerts
  useEffect(() => {
    getSwRegistration().catch(() => {});
  }, []);

  // On mount: restore persisted enabled state + sync real browser permission.
  // This runs once (root layout) and handles all page navigations.
  useEffect(() => {
    const perm = getBrowserPerm();
    globalPerm = perm;
    broadcastPerm();

    // If browser permission is still granted, re-activate any pages that were enabled
    // in a previous session. If permission was revoked, clear persisted state.
    if (perm === "granted") {
      const saved = loadPersistedEnabled();
      const pages: AlertPage[] = ["Binance Futures", "ICT / SMC"];
      pages.forEach(p => {
        if (saved[p] && !pageEnabled[p]) {
          pageEnabled[p] = true;
          broadcastEnabled(p);
        }
      });
    } else if (perm === "denied") {
      // Permission was revoked externally — clear saved prefs
      pageEnabled["Binance Futures"] = false;
      pageEnabled["ICT / SMC"] = false;
      persistEnabled(pageEnabled);
      broadcastEnabled("Binance Futures");
      broadcastEnabled("ICT / SMC");
    }
  }, []);

  useEffect(() => subscribeAlerts(setAlerts), []);

  if (alerts.length === 0) return null;

  return (
    <div
      className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-[9999] flex flex-col-reverse gap-2 pointer-events-none"
      aria-live="polite"
    >
      {alerts.map(alert => (
        <div key={alert.id} className="pointer-events-auto">
          <AlertCard alert={alert} onDismiss={() => dismissAlert(alert.id)} />
        </div>
      ))}
    </div>
  );
}

// ─── Per-page Alerts button ───────────────────────────────────────────────────

interface AlertsButtonProps {
  /** Which page this button controls */
  page: AlertPage;
}

export function AlertsButton({ page }: AlertsButtonProps) {
  // Use neutral defaults that match SSR output — populate real values after mount
  const [perm, setPerm]       = useState<PermState>("default");
  const [enabled, setEnabled] = useState<boolean>(false);
  const [count, setCount]     = useState(0);
  const [requesting, setRequesting] = useState(false);
  const [mounted, setMounted] = useState(false);

  // After mount: read real browser state and subscribe to changes
  useEffect(() => {
    const realPerm = getBrowserPerm();
    setPerm(realPerm);
    setEnabled(pageEnabled[page]);
    setMounted(true);
  }, [page]);

  // Subscribe to global changes
  useEffect(() => subscribePerm(setPerm), []);
  useEffect(() => subscribeEnabled((p, e) => { if (p === page) setEnabled(e); }), [page]);
  useEffect(() => subscribeCount((p, c)   => { if (p === page) setCount(c); }),   [page]);

  const isDenied      = mounted && perm === "denied";
  const isUnsupported = mounted && perm === "unsupported";
  const isActive      = mounted && enabled && perm === "granted";

  const handleClick = async () => {
    if (isUnsupported) return;

    // Already enabled → disable this page
    if (isActive) {
      disablePageAlerts(page);
      clearPageCount(page);
      return;
    }

    // Browser already denied → show instructions
    if (isDenied) {
      window.alert(
        "Browser notifications are blocked.\n\n" +
        "To enable:\n" +
        "  • Click the 🔒 lock icon in your browser address bar\n" +
        "  • Set Notifications → Allow\n" +
        "  • Refresh the page, then click Alerts again."
      );
      return;
    }

    // Request permission then enable this page
    setRequesting(true);
    const result = await enablePageAlerts(page);
    setRequesting(false);

    if (result === "denied") {
      window.alert(
        "Notifications were denied.\n\n" +
        "To enable later:\n" +
        "  • Click the 🔒 lock icon in the address bar\n" +
        "  • Set Notifications → Allow\n" +
        "  • Refresh and try again."
      );
    }
  };

  const Icon = requesting ? BellRing : isActive ? Bell : BellOff;

  const isHttpOnly = mounted && typeof window !== "undefined" && !window.isSecureContext;

  const label = requesting
    ? "Enabling..."
    : isDenied
    ? "Blocked"
    : isHttpOnly
    ? "HTTPS Required"
    : isUnsupported
    ? "N/A"
    : "Alerts";

  return (
    <button
      onClick={handleClick}
      disabled={!mounted || requesting || isUnsupported}
      title={
        isHttpOnly     ? "Alerts require HTTPS — access the site via https:// to enable notifications" :
        isUnsupported  ? "Notifications not supported in this browser" :
        isDenied       ? "Notifications blocked — click for instructions" :
        isActive       ? `Disable ${page} signal alerts` :
                         `Enable ${page} signal alerts`
      }
      className={cn(
        "relative inline-flex items-center gap-1.5 h-8 px-3 rounded-lg",
        "text-[11px] font-bold border transition-colors select-none",
        isActive
          ? "border-border text-foreground bg-background hover:bg-muted"
          : isDenied
          ? "border-red-400/40 text-red-400 bg-background hover:bg-red-500/5"
          : "border-border text-muted-foreground bg-background hover:text-foreground hover:bg-muted",
        (requesting || isUnsupported) && "opacity-50 cursor-not-allowed",
      )}
    >
      <Icon size={13} strokeWidth={2.5} className={cn(requesting && "animate-bounce")} />

      <span className="uppercase tracking-wide">{label}</span>

      {/* Unread badge */}
      {isActive && count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-black flex items-center justify-center bg-orange-500 text-white leading-none">
          {count > 99 ? "99+" : count}
        </span>
      )}

      {/* Active orange underline */}
      {isActive && (
        <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-orange-400" />
      )}
    </button>
  );
}
