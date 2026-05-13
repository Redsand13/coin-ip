import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import AppLayout from "@/components/AppLayout";
import { ThemeProvider } from "@/components/theme-provider";
import { SignalAlertContainer } from "@/components/SignalAlerts";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://coinpree.com"),
  title: {
    default: "Coinpree | Institutional Crypto Audit & Signals Terminal",
    template: "%s | Coinpree Terminal"
  },
  description: "Coinpree provides advanced algorithmic detection, Algo signals, and institutional accumulation tracking for crypto assets.",
  keywords: ["crypto terminal", "institutional signals", "Algo Terminal", "crypto audit", "smart money tracker", "bitcoin alpha"],
  authors: [{ name: "Coinpree Labs" }],
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://coinpree.com",
    siteName: "Coinpree Terminal",
    title: "Coinpree | Institutional Crypto Terminal",
    description: "Real-time algorithmic monitoring for institutional traders.",
    images: [{ url: "/og-image.png" }]
  },
  twitter: {
    card: "summary_large_image",
    title: "Coinpree | Institutional Crypto Terminal",
    description: "Real-time algorithmic monitoring for institutional traders.",
    creator: "@coinpree"
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply saved theme before first paint to avoid flash */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var c=document.cookie.match(/theme=([^;]+)/);if(c&&c[1]==='dark')document.documentElement.classList.add('dark');}catch(e){}})();` }} />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased font-sans`}
      >
        <ThemeProvider enableSystem>
          <AppLayout>
            {children}
          </AppLayout>
          <SignalAlertContainer />
        </ThemeProvider>
      </body>
    </html>
  );
}
