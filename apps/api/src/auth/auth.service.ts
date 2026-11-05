import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { isUniqueViolation } from '../database/prisma-errors.js';
import { AppException } from '../common/errors/app.exception.js';
import { PasswordService } from './password.service.js';
import type { AuthContext, JwtPayload } from './auth.types.js';
import type { LoginDto, RegisterDto } from './dto/auth.dto.js';

export interface AuthResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: { id: string; email: string; displayName: string };
  organization: { id: string; name: string; slug: string };
  role: string;
}

const MIN_SLUG_LENGTH = 3;

/**
 * Turns a display name into a URL-safe slug. Vietnamese diacritics are folded
 * first so "Công ty Acme" becomes "cong-ty-acme" rather than a string of
 * dashes; the random suffix guarantees uniqueness without a retry loop.
 */
function slugify(value: string): string {
  const base = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  const suffix = randomBytes(4).toString('hex');

  return `${base.length >= MIN_SLUG_LENGTH ? base : 'org'}-${suffix}`;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    if (!this.config.get<boolean>('AUTH_ALLOW_REGISTRATION')) {
      throw new ForbiddenException('Self-service registration is disabled on this deployment');
    }

    const email = dto.email.trim().toLowerCase();
    const passwordHash = await this.passwords.hash(dto.password);

    try {
      const { user, organization, role } = await this.prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: { email, displayName: dto.displayName.trim(), passwordHash },
        });

        const createdOrganization = await tx.organization.create({
          data: {
            name: dto.organizationName.trim(),
            slug: slugify(dto.organizationName),
            countryCode: dto.organizationCountry.toUpperCase(),
          },
        });

        const membership = await tx.organizationMembership.create({
          data: {
            organizationId: createdOrganization.id,
            userId: createdUser.id,
            role: 'OWNER',
          },
        });

        return { user: createdUser, organization: createdOrganization, role: membership.role };
      });

      return this.issueToken(
        { id: user.id, email: user.email, displayName: user.displayName },
        organization,
        role,
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        passwordHash: true,
      },
    });

    // Same work whether or not the account exists: a fast rejection for an
    // unknown email would let an attacker enumerate registered addresses.
    if (user?.passwordHash == null) {
      await this.passwords.simulateVerification(dto.password);
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await this.passwords.verify(dto.password, user.passwordHash);

    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('This account is suspended');
    }

    const membership = await this.prisma.organizationMembership.findFirst({
      where: {
        userId: user.id,
        ...(dto.organizationSlug === undefined
          ? {}
          : { organization: { slug: dto.organizationSlug } }),
      },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });

    if (membership === null) {
      throw new AppException(
        403,
        'NO_ORGANIZATION_MEMBERSHIP',
        'This account does not belong to an organization',
      );
    }

    return this.issueToken(
      { id: user.id, email: user.email, displayName: user.displayName },
      membership.organization,
      membership.role,
    );
  }

  /**
   * Rebuilds the request context from the database on every request.
   *
   * Returns null when the membership has been revoked, the user is suspended,
   * or the organisation is no longer active — the guard turns that into a 401
   * so a stale token cannot outlive the permission it was issued for.
   */
  async resolveContext(userId: string, organizationId: string): Promise<AuthContext | null> {
    const membership = await this.prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: {
        user: { select: { id: true, email: true, displayName: true, status: true } },
        organization: { select: { id: true, name: true, slug: true, status: true } },
      },
    });

    if (membership === null) {
      return null;
    }

    if (membership.user.status !== 'ACTIVE' || membership.organization.status !== 'ACTIVE') {
      return null;
    }

    return {
      userId: membership.user.id,
      email: membership.user.email,
      displayName: membership.user.displayName,
      organizationId: membership.organization.id,
      organizationSlug: membership.organization.slug,
      role: membership.role,
    };
  }

  private async issueToken(
    user: { id: string; email: string; displayName: string },
    organization: { id: string; name: string; slug: string },
    role: string,
  ): Promise<AuthResult> {
    const expiresIn = this.config.get<number>('JWT_EXPIRES_IN_SECONDS') ?? 3600;

    const payload: JwtPayload = {
      sub: user.id,
      org: organization.id,
      role: role as JwtPayload['role'],
    };

    const accessToken = await this.jwt.signAsync(payload, { expiresIn });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      user,
      organization,
      role,
    };
  }
}
