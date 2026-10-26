import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireScope } from '../auth/scopes';
import {
  AggregateBalancesDto,
  AggregateExpensesDto,
  DateRangeDto,
} from './bank.dto';
import { BanksService } from './banks.service';

@ApiTags('Aggregate (all banks)')
@ApiSecurity('api-key')
@Controller()
export class BanksController {
  constructor(private readonly banks: BanksService) {}

  @Get('balances')
  @RequireScope('balances')
  @ApiOperation({
    summary: 'Balances across every configured bank, with per-currency totals',
  })
  @ApiOkResponse({ type: AggregateBalancesDto })
  balances() {
    return this.banks.balances();
  }

  @Get('expenses')
  @RequireScope('expenses')
  @ApiOperation({
    summary:
      'All expenses across every configured bank (live, fully paginated)',
  })
  @ApiOkResponse({ type: AggregateExpensesDto })
  expenses(@Query() range: DateRangeDto) {
    return this.banks.expenses(range);
  }
}
