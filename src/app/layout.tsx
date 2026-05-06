import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "病历脱敏工作台",
  description: "病历资料脱敏与整理。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased" suppressHydrationWarning>{children}</body>
    </html>
  );
}
