import { NextRequest } from 'next/server'
import { createMasterHandlers, handleReorder } from '../_crud'
import { foodPlanSchema } from '@/lib/validations/master'

const { GET, POST } = createMasterHandlers({
  tableName: 'food_plan_master',
  schema: foodPlanSchema,
})

export { GET, POST }

export async function PATCH(request: NextRequest) {
  return handleReorder(request, 'food_plan_master')
}
