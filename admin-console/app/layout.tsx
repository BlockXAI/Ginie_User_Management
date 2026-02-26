import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'EVI Admin',
  description: 'Admin Console for User Management',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container py-6">{children}</div>
      </body>
    </html>
  )
}
