import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

// Normalized shapes every bank integration returns, so consumers stay bank-agnostic.

export class BalanceDto {
  @ApiProperty({ example: 'mercury' }) bank: string;
  @ApiProperty({ example: 'US' }) country: string;
  @ApiProperty() accountId: string;
  @ApiProperty() name: string;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ description: 'Available balance in major units' })
  available: number;
  @ApiProperty({ description: 'Current (ledger) balance in major units' })
  current: number;
  @ApiProperty() status: string;
}

export class ExpenseDto {
  @ApiProperty() bank: string;
  @ApiProperty() id: string;
  @ApiProperty() accountId: string;
  @ApiProperty({ description: 'Money out, positive, in major units' })
  amount: number;
  @ApiProperty() currency: string;
  @ApiProperty() counterparty: string;
  @ApiPropertyOptional({ nullable: true, type: String }) description:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) category:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) cardId: string | null;
  @ApiProperty() status: string;
  @ApiProperty() kind: string;
  @ApiProperty() createdAt: string;
  @ApiPropertyOptional({ nullable: true, type: String }) postedAt:
    string | null;
}

export const TX_STATUSES = [
  'pending',
  'sent',
  'cancelled',
  'failed',
  'reversed',
  'blocked',
] as const;

export class DateRangeDto {
  @ApiPropertyOptional({
    description: 'YYYY-MM-DD or ISO 8601. Default: 30 days ago',
  })
  @IsOptional()
  @IsDateString()
  start?: string;

  @ApiPropertyOptional({
    description: 'YYYY-MM-DD or ISO 8601. Default: today',
  })
  @IsOptional()
  @IsDateString()
  end?: string;
}

export class ExpensesQueryDto extends DateRangeDto {
  @ApiPropertyOptional({ enum: TX_STATUSES })
  @IsOptional()
  @IsIn(TX_STATUSES)
  status?: string;

  @ApiPropertyOptional({ default: 500, minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class BankErrorDto {
  @ApiProperty() bank: string;
  @ApiProperty() message: string;
}

export class BalanceTotalDto {
  @ApiProperty() currency: string;
  @ApiProperty() available: number;
  @ApiProperty() current: number;
}

export class AggregateBalancesDto {
  @ApiProperty({ type: [BalanceDto] }) items: BalanceDto[];
  @ApiProperty({ type: [BalanceTotalDto] }) totals: BalanceTotalDto[];
  @ApiProperty({
    type: [BankErrorDto],
    description: 'Banks that failed; items holds the rest',
  })
  errors: BankErrorDto[];
}

export class ExpenseTotalDto {
  @ApiProperty() currency: string;
  @ApiProperty() amount: number;
}

export class AggregateExpensesDto {
  @ApiProperty({ type: [ExpenseDto] }) items: ExpenseDto[];
  @ApiProperty({ type: [ExpenseTotalDto] }) totals: ExpenseTotalDto[];
  @ApiProperty({ type: [BankErrorDto] }) errors: BankErrorDto[];
}
