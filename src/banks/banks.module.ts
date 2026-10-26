import { Module } from '@nestjs/common';
import { BANK_CONNECTORS } from './bank-connector';
import { BanksController } from './banks.controller';
import { BanksService } from './banks.service';
import { MercuryModule } from './us/mercury/mercury.module';
import { MercuryService } from './us/mercury/mercury.service';

// Register a new bank: import its module and add its service to BANK_CONNECTORS.
@Module({
  imports: [MercuryModule],
  controllers: [BanksController],
  providers: [
    BanksService,
    {
      provide: BANK_CONNECTORS,
      useFactory: (mercury: MercuryService) => [mercury],
      inject: [MercuryService],
    },
  ],
  exports: [BanksService],
})
export class BanksModule {}
