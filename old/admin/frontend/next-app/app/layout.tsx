import { Geist, JetBrains_Mono } from "next/font/google"

import "./globals.css"
import { Toaster } from "@aether/ui/sonner"
import { TooltipProvider } from "@aether/ui/tooltip"
import { cn } from "@aether/ui/utils"

import { AuthProvider } from "@/lib/auth-context"

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata = {
  title: "AETHER · Admin",
  description: "Командный центр AETHER — управление доступом",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="ru"
      className={cn(
        "dark antialiased",
        fontSans.variable,
        "font-mono",
        jetbrainsMono.variable,
      )}
    >
      <body>
        <AuthProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </AuthProvider>
        <Toaster />
      </body>
    </html>
  )
}
