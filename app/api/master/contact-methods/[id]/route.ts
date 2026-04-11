import { NextRequest } from 'next/server'
import { createMasterItemHandlers } from '../../_crud'
import { contactMethodSchema } from '@/lib/validations/master'

const { PUT, DELETE } = createMasterItemHandlers({ tableName: 'contact_method_master', schema: contactMethodSchema })
export { PUT, DELETE }
