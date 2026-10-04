import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MobileNav, Sidebar } from "@/surface/Sidebar";
import { CornerControls } from "@/surface/TopBar";
import { VoiceProvider } from "@/surface/voice/VoiceAssistant";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StopLoss",
  description: "Try software without surprise charges.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full font-sans">
        <VoiceProvider>
        <div className="flex min-h-full">
          <Sidebar />
          <div className="relative flex min-w-0 flex-1 flex-col">
            <MobileNav />
            <CornerControls />
            <main className="mx-auto w-full max-w-[2400px] flex-1 px-5 py-6 md:px-10 md:py-7 2xl:px-14">{children}</main>
          </div>
        </div>
        </VoiceProvider>
      </body>
    </html>
  );
}
