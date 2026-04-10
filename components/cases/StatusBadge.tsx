'use client'

import { CaseStatus } from '@/types/database'
import { STATUS_CONFIG } from '@/lib/constants/status'
import { cn } from '@/lib/utils/cn'

interface StatusBadgeProps {
  status: CaseStatus
  autoCancel?: boolean
  size?: 'sm' | 'md'
  className?: string
}

/**
 * ステータスバッジコンポーネント
 * 自動キャンセルは "(自動)" サフィックスを追加して区別する
 */
export function StatusBadge({ status, autoCancel, size = 'md', className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status]
  if (!config) return null

  const label = status === 'cancelled' && autoCancel
    ? `${config.label}（自動）`
    : config.label

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        config.bgColor,
        config.color,
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
        className
      )}
    >
      {label}
    </span>
  )
}
