'use client';

import type { ReactNode } from 'react';
import { SupplierShell } from '@/components/shell';
import { RequireAuth } from '@/lib/auth';

export default function SupplierLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth role="supplier">
      <SupplierShell>{children}</SupplierShell>
    </RequireAuth>
  );
}
