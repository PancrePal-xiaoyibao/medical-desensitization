import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "病历脱敏工作台",
  description: "在把病历、检查报告和患者资料发送给 AI 前，先自动识别并脱敏敏感信息。",
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
