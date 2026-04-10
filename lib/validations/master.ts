import { z } from 'zod'

// ─── 共通フィールド ───────────────────────────────────────────
const baseSchema = {
  name:          z.string().min(1, '名称は必須です').max(100),
  display_order: z.number().int().min(0).default(0),
  is_active:     z.boolean().default(true),
}

// ─── 認知経路 ─────────────────────────────────────────────────
export const mediaSchema = z.object({
  ...baseSchema,
  monthly_cost: z.number().int().min(0).nullable().optional(),
  note:         z.string().max(500).optional().or(z.literal('')),
})
export type MediaFormValues = z.infer<typeof mediaSchema>

// ─── 連絡方法 ─────────────────────────────────────────────────
export const contactMethodSchema = z.object({ ...baseSchema })
export type ContactMethodFormValues = z.infer<typeof contactMethodSchema>

// ─── イベント大分類 ───────────────────────────────────────────
export const eventCategorySchema = z.object({ ...baseSchema })
export type EventCategoryFormValues = z.infer<typeof eventCategorySchema>

// ─── イベント中分類 ───────────────────────────────────────────
export const eventSubcategorySchema = z.object({
  ...baseSchema,
  category_id: z.string().uuid('大分類を選択してください'),
})
export type EventSubcategoryFormValues = z.infer<typeof eventSubcategorySchema>

// ─── フロア ───────────────────────────────────────────────────
export const floorSchema = z.object({ ...baseSchema })
export type FloorFormValues = z.infer<typeof floorSchema>

// ─── キャンセル理由 ───────────────────────────────────────────
export const cancelReasonSchema = z.object({
  ...baseSchema,
  is_auto_cancel: z.boolean().default(false),
})
export type CancelReasonFormValues = z.infer<typeof cancelReasonSchema>

// ─── オプション ───────────────────────────────────────────────
export const optionSchema = z.object({
  ...baseSchema,
  category:         z.enum(['equipment', 'machine']),
  machine_category: z.enum(['音響', '照明', '映像']).nullable().optional(),
  default_price:    z.number().int().min(0).default(0),
  unit:             z.string().min(1).max(20).default('式'),
}).refine(
  (d) => d.category !== 'machine' || !!d.machine_category,
  { message: '機材カテゴリを選択してください', path: ['machine_category'] }
)
export type OptionFormValues = z.infer<typeof optionSchema>

// ─── display_order 一括更新 ───────────────────────────────────
export const reorderSchema = z.object({
  // [{ id, display_order }, ...]
  items: z.array(z.object({
    id:            z.string().uuid(),
    display_order: z.number().int().min(0),
  })).min(1),
})
export type ReorderValues = z.infer<typeof reorderSchema>
