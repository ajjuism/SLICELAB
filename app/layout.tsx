import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import { Providers } from './providers';

const siteTitle = 'SliceLab · Slice audio into samples in your browser';
const siteDescription =
  'Auto-detect slice points, tune fades and names, export WAVs as a ZIP, and layer patterns in the loop builder. Runs locally—your audio stays on device.';

/** Public URL for Open Graph and absolute links; production host. */
const CANONICAL_SITE = 'https://slicelab.pxl8.studio';

function siteUrl(): URL {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL);
  }
  // Vercel preview deployments: use the preview hostname for accurate OG URLs
  if (process.env.VERCEL_URL && process.env.VERCEL_ENV === 'preview') {
    return new URL(`https://${process.env.VERCEL_URL}`);
  }
  if (process.env.NODE_ENV !== 'production') {
    return new URL('http://localhost:3000');
  }
  return new URL(CANONICAL_SITE);
}

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: siteTitle,
  description: siteDescription,
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: '/favicon.svg',
  },
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: siteTitle,
    description: siteDescription,
  },
};

/** Syncs persisted theme before paint — must match `storageKey` / values in `providers.tsx` (next-themes). */
const THEME_INIT = `(function(){try{var k='slicelab-theme';var v=localStorage.getItem(k);if(v==='dark')document.documentElement.classList.add('dark');else document.documentElement.classList.remove('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
