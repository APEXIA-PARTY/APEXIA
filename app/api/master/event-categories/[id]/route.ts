import { NextRequest } from 'next/server'
import { createMasterItemHandlers } from '../../_crud'
import { eventCategorySchema } from '@/lib/validations/master'

const { PUT, DELETE } = createMasterItemHandlers({ tableName: 'event_category_master', schema: eventCategorySchema })
export { PUT, DELETE }
