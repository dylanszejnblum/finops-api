import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireScope } from '../../../auth/scopes';
import { BalanceDto, ExpenseDto, ExpensesQueryDto } from '../../bank.dto';
import { MercuryService } from './mercury.service';

@ApiTags('US / Mercury')
@ApiSecurity('api-key')
@Controller('us/mercury')
export class MercuryController {
  constructor(private readonly mercury: MercuryService) {}

  @Get('balances')
  @RequireScope('balances')
  @ApiOperation({ summary: 'Balances for every Mercury account' })
  @ApiOkResponse({ type: [BalanceDto] })
  balances() {
    return this.mercury.balances();
  }

  @Get('accounts/:accountId/balance')
  @RequireScope('balances')
  @ApiOperation({ summary: 'Balance for one Mercury account' })
  @ApiOkResponse({ type: BalanceDto })
  balance(@Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.mercury.balance(accountId);
  }

  @Get('accounts/:accountId/expenses')
  @RequireScope('expenses')
  @ApiOperation({
    summary: 'Outgoing transactions (expenses) for one Mercury account',
  })
  @ApiOkResponse({ type: [ExpenseDto] })
  expenses(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query() query: ExpensesQueryDto,
  ) {
    return this.mercury.expenses(accountId, query);
  }
}
