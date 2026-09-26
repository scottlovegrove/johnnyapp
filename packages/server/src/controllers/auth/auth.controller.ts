import {
    Body,
    Controller,
    Get,
    Header,
    HttpCode,
    HttpStatus,
    Post,
    Query,
    Req,
    Res,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { LoginAttemptsService } from '../../features/auth/login-attempts.service'
import { COOKIE_NAME, TokenService } from '../../infrastructure/token/token.service'
import { safeNextPath } from '../../middleware/auth.middleware'
import { renderLoginPage } from './login-page'
import { LoginDto } from './login.dto'

const FAILURE_DELAY_MS = 500

@Controller()
export class AuthController {
    private readonly tokens: TokenService
    private readonly attempts: LoginAttemptsService

    constructor(tokens: TokenService, attempts: LoginAttemptsService) {
        this.tokens = tokens
        this.attempts = attempts
    }

    @Get('login')
    @Header('Cache-Control', 'no-store')
    page(
        @Query('next') next: unknown,
        @Query('error') error: unknown,
        @Req() req: Request,
    ): string {
        const target = safeNextPath(next)
        if (this.tokens.verifyCookieHeader(req.headers.cookie)) {
            // Already signed in; the form would only get in the way.
            return `<!doctype html><meta http-equiv="refresh" content="0;url=${target}">`
        }
        return renderLoginPage(target, typeof error === 'string' ? error : null)
    }

    @Post('login')
    @HttpCode(HttpStatus.SEE_OTHER)
    async login(@Body() body: LoginDto, @Req() req: Request, @Res() res: Response): Promise<void> {
        const target = safeNextPath(body.next)
        const back = (message: string) =>
            res.redirect(
                HttpStatus.SEE_OTHER,
                `/login?next=${encodeURIComponent(target)}&error=${encodeURIComponent(message)}`,
            )

        if (!this.attempts.allowed(req.ip ?? '')) {
            back('Too many attempts. Try again in a few minutes.')
            return
        }
        if (!this.tokens.verify(body.token.trim())) {
            this.attempts.failed(req.ip ?? '')
            await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS))
            back('That token is not right.')
            return
        }

        this.attempts.reset(req.ip ?? '')
        res.cookie(COOKIE_NAME, this.tokens.token, this.tokens.cookieOptions(req))
        res.redirect(HttpStatus.SEE_OTHER, target)
    }

    @Post('logout')
    @HttpCode(HttpStatus.SEE_OTHER)
    logout(@Req() req: Request, @Res() res: Response): void {
        res.clearCookie(COOKIE_NAME, { ...this.tokens.cookieOptions(req), maxAge: undefined })
        res.redirect(HttpStatus.SEE_OTHER, '/login')
    }
}
