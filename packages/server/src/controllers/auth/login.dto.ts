import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export const LoginSchema = z.object({
    token: z.string().min(1),
    next: z.string().optional(),
})

export class LoginDto extends createZodDto(LoginSchema) {}
