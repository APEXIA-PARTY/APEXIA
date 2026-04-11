import { NextRequest } from 'next/server'
import { createMasterItemHandlers } from '../../_crud'
import { eventSubcategorySchema } from '@/lib/validations/master'

const { PUT, DELETE } = createMasterItemHandlers({ tableName: 'event_subcategory_master', schema: eventSubcategorySchema })
export { PUT, DELETE }
