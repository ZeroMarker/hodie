import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hodie 背单词 · Hodie, non cras",
  description: "Hodie, non cras —— 今天,而不是明天。为备考打造的间隔重复背单词应用。",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          <nav className="mx-auto flex max-w-xl items-center gap-4 px-6 py-3">
            <Link href="/" className="font-bold">
              Hodie
            </Link>
            <Link href="/study" className="ml-auto text-sm text-zinc-600 hover:text-zinc-900">
              学习
            </Link>
            <Link href="/settings" className="text-sm text-zinc-600 hover:text-zinc-900">
              设置
            </Link>
          </nav>
        </header>
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
