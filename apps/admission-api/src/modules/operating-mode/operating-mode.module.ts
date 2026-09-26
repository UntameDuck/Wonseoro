import { Module } from '@nestjs/common';
import { CentralHealthGate } from './central-health.gate';
import { OperatingModeController } from './operating-mode.controller';

/** Autonomous Mode 판단과 안내. (v1.1 §01 A1·C3, T-M3-06) */
@Module({
  controllers: [OperatingModeController],
  providers: [CentralHealthGate],
  exports: [CentralHealthGate],
})
export class OperatingModeModule {}
