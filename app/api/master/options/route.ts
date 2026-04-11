import { NextRequest } from 'next/server'
import { createMasterHandlers, handleReorder } from '../_crud'
import { optionSchema } from '@/lib/validations/master'

const { GET, POST } = createMasterHandlers({
  tableName: 'option_master',
  schema: optionSchema,
  extraFilters: (query, params) => {
    const cat = params.get('category')
    return cat ? query.eq('category', cat) : query
  },
})
export { GET, POST }
export async function PATCH(request: NextRequest) { return handleReorder(request, 'option_master') }
