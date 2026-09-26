import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export const CreateSessionSchema = z.object({
    agentId: z.string().min(1),
    projectId: z.string().min(1),
})

export class CreateSessionDto extends createZodDto(CreateSessionSchema) {}
