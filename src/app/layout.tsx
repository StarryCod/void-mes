import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Void Mes - Теневой мессенджер",
  description: "Защищённый мессенджер без цензуры. Часть экосистемы Void Engine.",
  keywords: ["Void Mes", "мессенджер", "шифрование", "Void Engine", "безопасность", "PWA"],
  authors: [{ name: "Void Engine Team" }],
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-512x512.svg",
    apple: "/icons/apple-touch-icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Void Mes",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#a855f7" },
    { media: "(prefers-color-scheme: dark)", color: "#050508" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#050508] text-white`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
