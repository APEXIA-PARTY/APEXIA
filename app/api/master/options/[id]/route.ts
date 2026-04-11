import { NextRequest } from 'next/server'
import { createMasterItemHandlers } from '../../_crud'
import { optionSchema } from '@/lib/validations/master'

const { PUT, DELETE } = createMasterItemHandlers({ tableName: 'option_master', schema: optionSchema })
export { PUT, DELETE }
