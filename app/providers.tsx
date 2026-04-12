'use client';

import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

/**
 * next-themes: default light, persisted choice, `class="dark"` on <html>.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="slicelab-theme" themes={['light', 'dark']}>
      {children}
    </ThemeProvider>
  );
}
