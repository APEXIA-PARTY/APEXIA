import { NextRequest } from 'next/server'
import { createMasterHandlers, handleReorder } from '../_crud'
import { floorSchema } from '@/lib/validations/master'

export const { GET, POST } = createMasterHandlers({
  tableName: 'floor_master',
  schema: floorSchema,
})

export async function PATCH(request: NextRequest) {
  return handleReorder(request, 'floor_master')
}