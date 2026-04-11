import { NextRequest } from 'next/server'
import { createMasterItemHandlers } from '../../_crud'
import { cancelReasonSchema } from '@/lib/validations/master'

const { PUT, DELETE } = createMasterItemHandlers({ tableName: 'cancel_reason_master', schema: cancelReasonSchema })
export { PUT, DELETE }
