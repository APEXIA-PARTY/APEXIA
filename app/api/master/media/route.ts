import { NextRequest } from 'next/server'
import { createMasterHandlers, handleReorder } from '../_crud'
import { mediaSchema } from '@/lib/validations/master'

const { GET, POST } = createMasterHandlers({
  tableName: 'media_master',
  schema: mediaSchema,
})

export { GET, POST }

// 👇これが無いと405になる
export async function PATCH(request: NextRequest) {
  return handleReorder(request, 'media_master')
}