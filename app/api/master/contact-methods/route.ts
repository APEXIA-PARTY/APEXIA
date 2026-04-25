import { NextRequest } from 'next/server'
import { createMasterHandlers, handleReorder } from '../_crud'
import { contactMethodSchema } from '@/lib/validations/master'

const { GET, POST } = createMasterHandlers({
  tableName: 'contact_method_master',
  schema: contactMethodSchema,
})

export { GET, POST }

export async function PATCH(request: NextRequest) {
  return handleReorder(request, 'contact_method_master')
}