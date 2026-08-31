import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "模擬臨床カルテ",
  description: "医学生向け 模擬電子カルテ・オーダリングシステム",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
