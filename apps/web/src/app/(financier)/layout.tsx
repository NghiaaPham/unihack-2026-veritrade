'use client';

import type { ReactNode } from 'react';
import { FinancierShell } from '@/components/shell';
import { RequireAuth } from '@/lib/auth';

export default function FinancierLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth role="financier">
      <FinancierShell>{children}</FinancierShell>
    </RequireAuth>
  );
}
