import { NextRequest } from 'next/server'
import { createMasterItemHandlers } from '../../_crud'
import { floorSchema } from '@/lib/validations/master'

const { PUT, DELETE } = createMasterItemHandlers({ tableName: 'floor_master', schema: floorSchema })
export { PUT, DELETE }
