import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppLaunchSplash } from "@/components/AppLaunchSplash";
import "./globals.css";

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "The Eternal Family Link",
  description: "Keep your family story alive.",
  applicationName: "The Eternal Family Link",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "EFL",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/site.webmanifest",
  themeColor: "#111827",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable}`}>
        <AppLaunchSplash />
        {children}
      </body>
    </html>
  );
}
