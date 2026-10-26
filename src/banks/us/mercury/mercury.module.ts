import { Module } from '@nestjs/common';
import { MercuryController } from './mercury.controller';
import { MercuryService } from './mercury.service';

@Module({
  controllers: [MercuryController],
  providers: [MercuryService],
  exports: [MercuryService],
})
export class MercuryModule {}
