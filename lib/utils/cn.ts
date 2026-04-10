import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Tailwind CSS クラスのマージユーティリティ
 * shadcn/ui の標準パターン
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
