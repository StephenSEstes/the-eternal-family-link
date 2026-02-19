import type { Metadata } from "next";
import { Nunito, Source_Sans_3 } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-display",
  subsets: ["latin"],
});

const sourceSans = Source_Sans_3({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "The Eternal Family Link",
  description: "Family memory support and connection app.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${nunito.variable} ${sourceSans.variable}`}>
        {children}
      </body>
    </html>
  );
}
