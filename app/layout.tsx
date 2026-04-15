import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cookies } from "next/headers";
import AppLayout from "@/components/AppLayout";
import { ThemeProvider } from "@/components/theme-provider";
import { SignalAlertContainer } from "@/components/SignalAlerts";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("theme")?.value;
  const theme = themeCookie === "dark" ? "dark" : "light";

  return (
    <html lang="en" className={theme === "dark" ? "dark" : ""}>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased font-sans`}
      >
        <ThemeProvider defaultTheme={theme} enableSystem>
          <AppLayout>
            {children}
          </AppLayout>
          <SignalAlertContainer />
        </ThemeProvider>
      </body>
    </html>
  );
}
