import { z } from 'zod'

/**
 * 案件オプション（case_options）の数量。
 * 小数第1位までの小数（0.1, 1.2, 10.9 など）を許可する。
 * DB の qty は NUMERIC(10,2) + CHECK（qty > 0 かつ小数第1位まで）。migration 参照。
 * 0以下・小数第2位以下・極端に大きい値は不可。
 */
export const optionQtySchema = z
  .number()
  .positive()
  .max(999999)
  .refine((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9, {
    message: '数量は小数第1位までで入力してください',
  })

/** POST /api/cases/[id]/options */
export const optionItemSchema = z.object({
  option_id:        z.string().uuid().nullable().optional(),
  name:             z.string().min(1, '名称は必須です').max(200),
  category:         z.enum(['equipment', 'machine']),
  machine_category: z.enum(['音響', '照明', '映像', 'その他オペ']).nullable().optional(),
  qty:              optionQtySchema.default(1),
  unit_price:       z.number().int().min(0).default(0),
  unit:             z.string().max(20).default('式'),
  state:            z.enum(['未確認', '質問中', '検討中', '確定', '不要']).default('未確認'),
  note:             z.string().max(500).optional().or(z.literal('')),
  sort_order:       z.number().int().min(0).default(0),
}).superRefine((v, ctx) => {
  // 小数数量は機材・オペレーター（machine）のみ。備品・設備（equipment）は整数のみ
  if (v.category === 'equipment' && !Number.isInteger(v.qty)) {
    ctx.addIssue({ code: 'custom', path: ['qty'], message: '備品・設備の数量は整数で入力してください' })
  }
})

/** PUT /api/cases/[id]/options */
export const optionUpdateSchema = z.object({
  id:         z.string().uuid(),
  name:       z.string().min(1).max(200).optional(),
  qty:        optionQtySchema.optional(),
  unit_price: z.number().int().min(0).optional(),
  unit:       z.string().max(20).optional(),
  state:      z.enum(['未確認', '質問中', '検討中', '確定', '不要']).optional(),
  note:       z.string().max(500).nullable().optional(),
  sort_order: z.number().int().min(0).optional(),
})
