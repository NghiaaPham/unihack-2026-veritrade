import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordService } from './password.service.js';
import { RolesGuard } from './roles.guard.js';

/**
 * Identity for the API.
 *
 * The guards are exported so feature modules can apply them with
 * `@UseGuards(JwtAuthGuard, RolesGuard)` without re-providing them — a second
 * instance would still work, but exporting keeps one definition of "what a
 * valid caller is".
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { issuer: 'veritrade-api' },
        // Tokens are only accepted from this service.
        verifyOptions: { issuer: 'veritrade-api' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, JwtAuthGuard, RolesGuard],
  // `JwtModule` is re-exported, not just the guards: a guard used with
  // `@UseGuards()` is instantiated in the *consuming* module's injector, so
  // `JwtService` has to be resolvable there or the guard fails to construct.
  exports: [AuthService, JwtAuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
