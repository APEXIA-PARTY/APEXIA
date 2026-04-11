import { NextRequest } from 'next/server'
import { createMasterItemHandlers } from '../../_crud'
import { mediaSchema } from '@/lib/validations/master'

const { PUT, DELETE } = createMasterItemHandlers({ tableName: 'media_master', schema: mediaSchema })
export { PUT, DELETE }
