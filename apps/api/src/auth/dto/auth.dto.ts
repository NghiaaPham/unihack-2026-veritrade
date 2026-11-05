import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * Creates the first user and their organisation in one step.
 *
 * A minimum of 12 characters and no composition rules: length is the only
 * requirement that reliably improves a password, and composition rules push
 * people towards `Password1!`.
 */
export class RegisterDto {
  @ApiProperty({ example: 'owner@acme.example', maxLength: 320 })
  @IsEmail()
  @Length(3, 320)
  email!: string;

  @ApiProperty({ example: 'Nguyen Van A', maxLength: 120 })
  @IsString()
  @Length(1, 120)
  displayName!: string;

  @ApiProperty({ example: 'a-long-demo-password', minLength: 12, maxLength: 200 })
  @IsString()
  @Length(12, 200)
  password!: string;

  @ApiProperty({ example: 'Acme Logistics', maxLength: 160 })
  @IsString()
  @Length(1, 160)
  organizationName!: string;

  @ApiProperty({ example: 'VN', description: 'ISO 3166-1 alpha-2 country code' })
  @Matches(/^[A-Za-z]{2}$/, { message: 'organizationCountry must be a 2-letter country code' })
  organizationCountry!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'owner@acme.example' })
  @IsEmail()
  @Length(3, 320)
  email!: string;

  @ApiProperty({ example: 'a-long-demo-password' })
  @IsString()
  @Length(1, 200)
  password!: string;

  /**
   * Disambiguates the tenant when one person belongs to several. Optional
   * because the common case is a single membership.
   */
  @ApiProperty({ required: false, example: 'acme-logistics' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  organizationSlug?: string;
}
