import "react-quill-new/dist/quill.snow.css";
import "./globals.css";
export const metadata = { title: "Meridian Operations Hub", description: "Faction Management Dashboard" };
export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" type="image/png" href="/meridian-logo.png" />
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('meridian-theme')||'dark';document.documentElement.setAttribute('data-theme',t)}catch(e){}` }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,500&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
