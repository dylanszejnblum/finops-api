import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BanksModule } from '../banks/banks.module';
import { ExpenseEntity } from './expense.entity';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

@Module({
  imports: [TypeOrmModule.forFeature([ExpenseEntity]), BanksModule],
  controllers: [LedgerController],
  providers: [LedgerService],
})
export class LedgerModule {}
