import { NextRequest } from 'next/server'
import { createMasterHandlers, handleReorder } from '../_crud'
import { cancelReasonSchema } from '@/lib/validations/master'

export const { GET, POST } = createMasterHandlers({
  tableName: 'cancel_reason_master',
  schema: cancelReasonSchema,
})

export async function PATCH(request: NextRequest) {
  return handleReorder(request, 'cancel_reason_master')
}