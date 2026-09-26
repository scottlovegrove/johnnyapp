import { Controller, Get } from '@nestjs/common'

/** Liveness check; the only route served without the auth token. */
@Controller('api/ping')
export class PingController {
    @Get()
    ping() {
        return { ok: true }
    }
}
