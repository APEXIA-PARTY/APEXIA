import { NextRequest } from 'next/server'
import { createMasterHandlers, handleReorder } from '../_crud'
import { eventSubcategorySchema } from '@/lib/validations/master'

export const { GET, POST } = createMasterHandlers({
  tableName: 'event_subcategory_master',
  schema: eventSubcategorySchema,
  extraFilters: (query, params) => {
    const categoryId = params.get('category_id')
    return categoryId ? query.eq('category_id', categoryId) : query
  },
})

export async function PATCH(request: NextRequest) {
  return handleReorder(request, 'event_subcategory_master')
}