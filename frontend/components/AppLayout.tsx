"use client";

import * as React from "react";
import { useTheme } from "@/components/theme-provider";
import {
  Zap,
  Sun,
  Moon,
  Activity,
  TrendingUp,
  Target,
  Database,
  Home,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { usePathname } from "next/navigation";
import Link from "next/link";

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
      <header className="h-[52px] border-b border-border bg-[var(--header-bg)] flex items-center px-3 sm:px-6 z-50 shrink-0 transition-colors duration-200">
        {/* Logo Area */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-white shrink-0 shadow-lg shadow-primary/20">
            <Zap className="w-5 h-5 fill-current" />
          </div>
          <div className="flex flex-col">
            <span className="font-black text-[var(--header-text)] text-[15px] sm:text-[18px] tracking-tight leading-none">
              Coinpree
            </span>
            <span className="text-[9px] font-bold text-[var(--header-subtext)] uppercase tracking-widest">
              Algo Terminal
            </span>
          </div>
        </div>

        {/* Vertical Divider */}
        <div className="hidden sm:block h-8 w-px bg-border mx-6" />

        {/* Navigation */}
        <div className="hidden md:flex items-center gap-1 mr-6">
          <Link href="/ema3crossover">
            <Button
              variant={pathname === "/ema3crossover" ? "secondary" : "ghost"}
              className={cn(
                "h-8 text-[12px] font-bold px-3",
                pathname === "/ema3crossover"
                  ? "bg-primary/10 text-primary hover:bg-primary/15"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              EMA 3 Cross
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
              ICT
            </Button>
          </Link>
          <Link href="/smc">
            <Button
              variant={pathname === "/smc" ? "secondary" : "ghost"}
              className={cn(
                "h-8 text-[12px] font-bold px-3",
                pathname === "/smc"
                  ? "bg-primary/10 text-primary hover:bg-primary/15"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              SMC
            </Button>
          </Link>
          <Link href="/derivatives">
            <Button
              variant={pathname === "/derivatives" ? "secondary" : "ghost"}
              className={cn(
                "h-8 text-[12px] font-bold px-3",
                pathname === "/derivatives"
                  ? "bg-primary/10 text-primary hover:bg-primary/15"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Market Sentiment
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

        </div>
      </header >

      <div className="flex flex-1 overflow-hidden">
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
          {/* Content Viewport */}
          <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 lg:p-8 pb-20 md:pb-8 space-y-4 md:space-y-6 bg-background scroll-smooth">
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
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-card border-t border-border flex items-center justify-around z-50 px-2 pb-safe">
        <Link href="/" className="flex flex-col items-center gap-0.5 w-full h-full justify-center">
          <div className={cn("p-1.5 rounded-lg transition-colors", pathname === "/" ? "bg-primary/10 text-primary" : "text-muted-foreground")}>
            <Home size={18} className={cn(pathname === "/" && "fill-current")} />
          </div>
          <span className={cn("text-[9px] font-bold", pathname === "/" ? "text-primary" : "text-muted-foreground")}>Home</span>
        </Link>

        <Link href="/ema3crossover" className="flex flex-col items-center gap-0.5 w-full h-full justify-center">
          <div className={cn("p-1.5 rounded-lg transition-colors", pathname === "/ema3crossover" ? "bg-primary/10 text-primary" : "text-muted-foreground")}>
            <TrendingUp size={18} className={cn(pathname === "/ema3crossover" && "fill-current")} />
          </div>
          <span className={cn("text-[9px] font-bold", pathname === "/ema3crossover" ? "text-primary" : "text-muted-foreground")}>EMA</span>
        </Link>

        <Link href="/ict" className="flex flex-col items-center gap-0.5 w-full h-full justify-center">
          <div className={cn("p-1.5 rounded-lg transition-colors", pathname === "/ict" ? "bg-primary/10 text-primary" : "text-muted-foreground")}>
            <Target size={18} className={cn(pathname === "/ict" && "fill-current")} />
          </div>
          <span className={cn("text-[9px] font-bold", pathname === "/ict" ? "text-primary" : "text-muted-foreground")}>ICT</span>
        </Link>

        <Link href="/smc" className="flex flex-col items-center gap-0.5 w-full h-full justify-center">
          <div className={cn("p-1.5 rounded-lg transition-colors", pathname === "/smc" ? "bg-primary/10 text-primary" : "text-muted-foreground")}>
            <Activity size={18} className={cn(pathname === "/smc" && "fill-current")} />
          </div>
          <span className={cn("text-[9px] font-bold", pathname === "/smc" ? "text-primary" : "text-muted-foreground")}>SMC</span>
        </Link>

        <Link href="/derivatives" className="flex flex-col items-center gap-0.5 w-full h-full justify-center">
          <div className={cn("p-1.5 rounded-lg transition-colors", pathname === "/derivatives" ? "bg-primary/10 text-primary" : "text-muted-foreground")}>
            <BarChart3 size={18} className={cn(pathname === "/derivatives" && "fill-current")} />
          </div>
          <span className={cn("text-[9px] font-bold", pathname === "/derivatives" ? "text-primary" : "text-muted-foreground")}>Sentiment</span>
        </Link>
      </div>
    </div >
  );
}
