"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { useTheme } from "@/components/theme-provider";
import { Zap, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import Link from "next/link";

const NAV_ITEMS = [
  { href: "/derivatives",   label: "Market Sentiment", short: "Sentiment" },
  { href: "/market-flow",   label: "Market Flow",      short: "Flow"      },
  { href: "/ema3crossover", label: "EMA 3 Cross",      short: "EMA"       },
  { href: "/ict",           label: "ICT",              short: "ICT"       },
  { href: "/smc",           label: "SMC",              short: "SMC"       },
  { href: "/history",       label: "Signal Database",  short: "DB"        },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => { setMounted(true); }, []);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans">

      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <header
        className="h-[54px] border-b border-border/60 flex items-center px-4 sm:px-6 z-50 shrink-0 transition-colors duration-200"
        style={{ background: "var(--header-bg)", backdropFilter: "blur(16px)" }}
      >
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 shrink-0 group mr-5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-white shadow-md shadow-primary/20 group-hover:shadow-lg group-hover:shadow-primary/30 transition-all duration-200">
            <Zap className="w-4 h-4 fill-current" />
          </div>
          <div className="flex flex-col leading-none hidden sm:flex">
            <span className="font-black text-foreground text-[14px] tracking-tight">Coinpree</span>
            <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-[0.13em] mt-px">
              Algo Terminal
            </span>
          </div>
        </Link>

        {/* Divider */}
        <div className="hidden md:block h-6 w-px bg-border/60 mr-4" />

        {/* ── Desktop Navigation ─────────────────────────────────────────── */}
        <nav className="hidden md:flex items-center gap-0.5" aria-label="Main navigation">
          {NAV_ITEMS.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link key={href} href={href}>
                <div
                  className={cn(
                    "relative h-[30px] px-3 rounded-lg flex items-center",
                    "text-[11.5px] font-semibold cursor-pointer select-none whitespace-nowrap",
                    "transition-colors duration-150",
                    active
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]"
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active-pill"
                      className="absolute inset-0 rounded-lg bg-primary/10 border border-primary/15"
                      transition={{ type: "spring", stiffness: 400, damping: 35 }}
                    />
                  )}
                  <span className="relative z-10">{label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
          suppressHydrationWarning
          aria-label="Toggle theme"
        >
          {mounted
            ? theme === "dark" ? <Sun size={15} strokeWidth={2} /> : <Moon size={15} strokeWidth={2} />
            : <Sun size={15} strokeWidth={2} />}
        </button>
      </header>

      {/* ── Page Body ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
          <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 lg:p-8 pb-20 md:pb-8 space-y-4 md:space-y-6 scroll-smooth">
            <div className="max-w-[1600px] mx-auto">{children}</div>
          </main>

          <footer className="bg-card border-t border-border py-3 px-6 text-[10px] text-muted-foreground hidden md:flex items-center justify-center shrink-0">
            <div className="flex items-center gap-4">
              <span className="font-bold">© 2026 Coinpree</span>
              <span className="opacity-40">|</span>
              <Link href="/disclaimer" className="hover:text-foreground transition-colors">Disclaimer</Link>
              <span className="opacity-40">|</span>
              <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
              <span className="opacity-40">|</span>
              <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            </div>
          </footer>
        </div>
      </div>

      {/* ── Mobile Bottom Navigation ─────────────────────────────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border/60"
        style={{ background: "var(--header-bg)", backdropFilter: "blur(16px)" }}
      >
        <div className="flex items-stretch justify-around h-[56px]">
          {NAV_ITEMS.map(({ href, short }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className="flex flex-col items-center justify-center flex-1 relative"
              >
                {active && (
                  <motion.span
                    layoutId="mobile-nav-pill"
                    className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-8 rounded-full bg-primary"
                    transition={{ type: "spring", stiffness: 400, damping: 35 }}
                  />
                )}
                <span className={cn(
                  "text-[9px] font-bold",
                  active ? "text-primary" : "text-muted-foreground"
                )}>
                  {short}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

    </div>
  );
}
