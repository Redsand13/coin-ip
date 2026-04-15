"use client";

import * as React from "react";
import { useTheme } from "@/components/theme-provider";
import {
  Zap,
  Sun,
  Moon,
  Settings,
  Activity,
  TrendingUp,
  Target,
  Database
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { usePathname } from "next/navigation";
import Link from "next/link";
// ... imports

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans">
      {/* Top Bar */}
      <header className="h-[52px] border-b border-border bg-[var(--header-bg)] flex items-center px-6 z-50 shrink-0 transition-colors duration-200">
        {/* Logo Area */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-white shrink-0 shadow-lg shadow-primary/20">
            <Zap className="w-5 h-5 fill-current" />
          </div>
          <div className="flex flex-col">
            <span className="font-black text-[var(--header-text)] text-[18px] tracking-tight leading-none">
              Coinpree
            </span>
            <span className="text-[9px] font-bold text-[var(--header-subtext)] uppercase tracking-widest">
              Algo Terminal
            </span>
          </div>
        </div>

        {/* Vertical Divider */}
        <div className="h-8 w-px bg-border mx-6" />

        {/* Navigation */}
        <div className="hidden md:flex items-center gap-1 mr-6">
          <Link href="/coingecko">
            <Button
              variant={pathname === "/coingecko" ? "secondary" : "ghost"}
              className={cn(
                "h-8 text-[12px] font-bold px-3",
                pathname === "/coingecko"
                  ? "bg-primary/10 text-primary hover:bg-primary/15"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              CoinGecko Market
            </Button>
          </Link>
          <Link href="/binance">
            <Button
              variant={pathname === "/binance" ? "secondary" : "ghost"}
              className={cn(
                "h-8 text-[12px] font-bold px-3",
                pathname === "/binance"
                  ? "bg-primary/10 text-primary hover:bg-primary/15"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Binance Market
            </Button>
          </Link>
          <Link href="/ict">
            <Button
              variant={pathname === "/ict" ? "secondary" : "ghost"}
              className={cn(
                "h-8 text-[12px] font-bold px-3",
                pathname === "/ict"
                  ? "bg-primary/10 text-primary hover:bg-primary/15"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              ICT / SMC
            </Button>
          </Link>
          <Link href="/history">
            <Button
              variant={pathname === "/history" ? "secondary" : "ghost"}
              className={cn(
                "h-8 text-[12px] font-bold px-3 ml-2",
                pathname === "/history"
                  ? "bg-primary/10 text-primary hover:bg-primary/15"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Database size={13} className="mr-1.5" />
              Signal Database
            </Button>
          </Link>
        </div>

        {/* Search */}


        <div className="flex-1" />

        {/* Right Side Actions */}
        <div className="flex items-center gap-3">
          {/* Stats Removed as per request */}

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-[var(--header-subtext)] hover:text-[var(--header-text)] hover:bg-[var(--header-search-bg)] rounded-lg transition-colors"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            suppressHydrationWarning
          >
            {mounted ? (theme === "dark" ? <Sun size={18} /> : <Moon size={18} />) : <Sun size={18} />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-[var(--header-subtext)] hover:text-[var(--header-text)] hover:bg-[var(--header-search-bg)] rounded-lg transition-colors"
          >
            <Settings size={18} />
          </Button>

          <div className="h-8 w-px bg-border mx-2" />
        </div>
      </header >

      <div className="flex flex-1 overflow-hidden">
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
          {/* Content Viewport */}
          <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-20 md:pb-8 space-y-8 bg-background scroll-smooth">
            <div className="max-w-[1600px] mx-auto">{children}</div>
          </main>

          <footer className="bg-card border-t border-border py-3 px-6 text-[10px] text-muted-foreground flex items-center justify-center shrink-0 hidden md:flex">
            <div className="flex items-center gap-4">
              <span className="font-bold">© 2026 Coinpree</span>
              <span className="opacity-50">|</span>
              <Link href="/disclaimer" className="hover:text-foreground transition-colors">
                Disclaimer
              </Link>
              <span className="opacity-50">|</span>
              <Link href="/terms" className="hover:text-foreground transition-colors">
                Terms of Service
              </Link>
              <span className="opacity-50">|</span>
              <Link href="/privacy" className="hover:text-foreground transition-colors">
                Privacy Policy
              </Link>

            </div>
          </footer>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-card border-t border-border flex items-center justify-around z-50 px-4 pb-safe">
        <Link href="/coingecko" className="flex flex-col items-center gap-1 w-full h-full justify-center">
          <div className={cn("p-1.5 rounded-lg transition-colors", pathname === "/coingecko" ? "bg-primary/10 text-primary" : "text-muted-foreground")}>
            <Activity size={20} className={cn(pathname === "/coingecko" && "fill-current")} />
          </div>
          <span className={cn("text-[10px] font-bold", pathname === "/coingecko" ? "text-primary" : "text-muted-foreground")}>CoinGecko Market</span>
        </Link>

        <Link href="/binance" className="flex flex-col items-center gap-1 w-full h-full justify-center">
          <div className={cn("p-1.5 rounded-lg transition-colors", pathname === "/binance" ? "bg-primary/10 text-primary" : "text-muted-foreground")}>
            <TrendingUp size={20} className={cn(pathname === "/binance" && "fill-current")} />
          </div>
          <span className={cn("text-[10px] font-bold", pathname === "/binance" ? "text-primary" : "text-muted-foreground")}>Binance Market</span>
        </Link>

        <Link href="/ict" className="flex flex-col items-center gap-1 w-full h-full justify-center">
          <div className={cn("p-1.5 rounded-lg transition-colors", pathname === "/ict" ? "bg-primary/10 text-primary" : "text-muted-foreground")}>
            <Target size={20} className={cn(pathname === "/ict" && "fill-current")} />
          </div>
          <span className={cn("text-[10px] font-bold", pathname === "/ict" ? "text-primary" : "text-muted-foreground")}>ICT / SMC</span>
        </Link>

        <Link href="/history" className="flex flex-col items-center gap-1 w-full h-full justify-center">
          <div className={cn("p-1.5 rounded-lg transition-colors", pathname === "/history" ? "bg-primary/10 text-primary" : "text-muted-foreground")}>
            <Database size={20} />
          </div>
          <span className={cn("text-[10px] font-bold", pathname === "/history" ? "text-primary" : "text-muted-foreground")}>Database</span>
        </Link>
      </div>
    </div >
  );
}
