import {
  Controller,
  Get,
  Header,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiProduces,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { RequireScope } from '../auth/scopes';
import { DateRangeDto } from '../banks/bank.dto';
import { toCsv } from '../common/csv';
import { GROUP_BY, type GroupBy, LedgerService } from './ledger.service';

class BurnQueryDto {
  @ApiPropertyOptional({ default: 6, minimum: 1, maximum: 36 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  months?: number;
}

class SpendQueryDto extends DateRangeDto {
  @ApiPropertyOptional({ enum: GROUP_BY, default: 'category' })
  @IsOptional()
  @IsIn(GROUP_BY)
  groupBy?: GroupBy;
}

const CSV_COLUMNS = [
  'createdAt',
  'postedAt',
  'bank',
  'accountId',
  'externalId',
  'amount',
  'currency',
  'counterparty',
  'description',
  'category',
  'cardId',
  'status',
  'kind',
] as const;

@ApiSecurity('api-key')
@Controller()
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Post('ledger/sync')
  @ApiTags('Ledger')
  @RequireScope('admin')
  @ApiOperation({
    summary:
      'Pull expenses from every bank into the DB now (use start to backfill)',
  })
  sync(@Query() range: DateRangeDto) {
    return this.ledger.sync(range);
  }

  @Get('reports/burn')
  @ApiTags('Reports')
  @RequireScope('reports')
  @ApiOperation({
    summary: 'Monthly gross burn per currency (from synced data)',
  })
  burn(@Query() q: BurnQueryDto) {
    return this.ledger.burn(q.months ?? 6);
  }

  @Get('reports/runway')
  @ApiTags('Reports')
  @RequireScope('reports')
  @ApiOperation({
    summary: 'Live balance / avg burn of the last 3 complete months',
  })
  runway() {
    return this.ledger.runway();
  }

  @Get('reports/spend')
  @ApiTags('Reports')
  @RequireScope('reports')
  @ApiOperation({
    summary:
      'Spend totals grouped by category, counterparty, bank, kind or account',
  })
  spend(@Query() q: SpendQueryDto) {
    const { groupBy, ...range } = q;
    return this.ledger.spend(groupBy ?? 'category', range);
  }

  @Get('reports/expenses.csv')
  @ApiTags('Reports')
  @RequireScope('reports')
  @ApiProduces('text/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="expenses.csv"')
  @ApiOperation({ summary: 'Synced expenses as CSV for accounting' })
  async csv(@Query() range: DateRangeDto) {
    const rows = (await this.ledger.export(range)).map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      postedAt: r.postedAt?.toISOString() ?? null,
    }));
    return new StreamableFile(Buffer.from(toCsv(rows, [...CSV_COLUMNS])));
  }
}
