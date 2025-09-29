import React from 'react';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline';
};

export function Button({ variant='primary', className='', ...props }: Props) {
  const base = 'h-10 px-4 rounded-xl text-sm font-medium transition-colors';
  const styles = variant === 'primary'
    ? 'bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200'
    : 'border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800';
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}
