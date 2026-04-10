import { cn } from '@/lib/utils/cn'
import { LucideIcon } from 'lucide-react'

interface KpiCardProps {
  label: string
  value: string | number
  sub?: string
  icon?: LucideIcon
  color?: 'default' | 'blue' | 'green' | 'red' | 'orange' | 'purple'
  className?: string
}

const COLOR_MAP = {
  default: 'text-foreground',
  blue:    'text-blue-600',
  green:   'text-green-700',
  red:     'text-red-600',
  orange:  'text-orange-600',
  purple:  'text-purple-600',
}

export function KpiCard({ label, value, sub, icon: Icon, color = 'default', className }: KpiCardProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        {Icon && <Icon className={cn('h-4 w-4 shrink-0', COLOR_MAP[color])} />}
      </div>
      <p className={cn('mt-2 text-2xl font-bold tabular-nums', COLOR_MAP[color])}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}
