import React from 'react';

export function Card({ children, className='' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm p-5 ${className}`}>
      {children}
    </div>
  );
}
