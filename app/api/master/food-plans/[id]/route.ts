import { createMasterItemHandlers } from '../../_crud'
import { foodPlanSchema } from '@/lib/validations/master'

const { PUT, DELETE } = createMasterItemHandlers({
  tableName: 'food_plan_master',
  schema: foodPlanSchema,
})

export { PUT, DELETE }
