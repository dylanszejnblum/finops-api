import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOperation,
  ApiProperty,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  Length,
} from 'class-validator';
import { randomBytes, randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { ApiKeyEntity } from './api-key.entity';
import { DB_KEY_PREFIX, hashKey } from './api-key.guard';
import { RequireScope, Scope, SCOPES } from './scopes';

class CreateApiKeyDto {
  @ApiProperty({ example: 'grafana-dashboard' })
  @IsString()
  @Length(1, 64)
  name: string;

  @ApiProperty({ enum: SCOPES, isArray: true, example: ['balances'] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(SCOPES, { each: true })
  scopes: Scope[];
}

class CreatedApiKeyDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: SCOPES, isArray: true }) scopes: Scope[];
  @ApiProperty({
    description: 'Shown once. Store it now; only its hash is kept.',
  })
  key: string;
}

@ApiTags('Admin / API keys')
@ApiSecurity('api-key')
@RequireScope('admin')
@Controller('admin/api-keys')
export class ApiKeysController {
  constructor(
    @InjectRepository(ApiKeyEntity)
    private readonly keys: Repository<ApiKeyEntity>,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a scoped API key' })
  @ApiCreatedResponse({ type: CreatedApiKeyDto })
  async create(@Body() dto: CreateApiKeyDto): Promise<CreatedApiKeyDto> {
    const key = DB_KEY_PREFIX + randomBytes(24).toString('base64url');
    const row = await this.keys.save(
      this.keys.create({
        id: randomUUID(),
        name: dto.name,
        scopes: dto.scopes,
        hash: hashKey(key),
        revokedAt: null,
      }),
    );
    return { id: row.id, name: row.name, scopes: row.scopes, key };
  }

  @Get()
  @ApiOperation({ summary: 'List active API keys (no secrets)' })
  list() {
    return this.keys.find({
      where: { revokedAt: IsNull() },
      select: { id: true, name: true, scopes: true, createdAt: true },
      order: { createdAt: 'ASC' },
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke an API key' })
  async revoke(@Param('id', ParseUUIDPipe) id: string) {
    const { affected } = await this.keys.update(
      { id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    if (!affected) throw new NotFoundException('API key not found');
  }
}
