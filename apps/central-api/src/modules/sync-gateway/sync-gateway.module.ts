import { Module } from '@nestjs/common';
import { HeartbeatGauges } from './heartbeat-gauges';
import { SyncGatewayController } from './sync-gateway.controller';
import { SyncGatewayService } from './sync-gateway.service';

@Module({
  controllers: [SyncGatewayController],
  providers: [SyncGatewayService, HeartbeatGauges],
  exports: [SyncGatewayService],
})
export class SyncGatewayModule {}
