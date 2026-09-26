import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export const CreateProjectSchema = z.object({
    path: z.string().min(1),
    name: z.string().optional(),
})

export class CreateProjectDto extends createZodDto(CreateProjectSchema) {}
