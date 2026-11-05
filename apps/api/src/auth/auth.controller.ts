import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService, type AuthResult } from './auth.service.js';
import { LoginDto, RegisterDto } from './dto/auth.dto.js';

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a user and their first organization',
    description:
      'Open only when AUTH_ALLOW_REGISTRATION is true (the default outside production). ' +
      'Creates the user, the organization and an OWNER membership in one transaction.',
  })
  @ApiResponse({ status: 201, description: 'Account created and an access token issued' })
  @ApiResponse({ status: 403, description: 'Registration is disabled on this deployment' })
  @ApiResponse({ status: 409, description: 'An account with this email already exists' })
  register(@Body() dto: RegisterDto): Promise<AuthResult> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange credentials for an access token' })
  @ApiResponse({ status: 200, description: 'Access token issued' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  login(@Body() dto: LoginDto): Promise<AuthResult> {
    return this.authService.login(dto);
  }
}
