import { NextRequest } from 'next/server'
import { createMasterHandlers, handleReorder } from '../_crud'
import { eventCategorySchema } from '@/lib/validations/master'

const { GET, POST } = createMasterHandlers({
  tableName: 'event_category_master',
  schema: eventCategorySchema,
})

export { GET, POST }

export async function PATCH(request: NextRequest) {
  return handleReorder(request, 'event_category_master')
}