import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Unit 1 Lab",
  description: "Isolated Unit 1 greenfield app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

