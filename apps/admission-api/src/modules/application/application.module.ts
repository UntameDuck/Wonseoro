import { Module } from '@nestjs/common';
import { ApplicationStateService } from './application-state.service';

@Module({
  providers: [ApplicationStateService],
  exports: [ApplicationStateService],
})
export class ApplicationModule {}
