import { Module } from '@nestjs/common';
import { SyncGatewayController } from './sync-gateway.controller';
import { SyncGatewayService } from './sync-gateway.service';

@Module({
  controllers: [SyncGatewayController],
  providers: [SyncGatewayService],
  exports: [SyncGatewayService],
})
export class SyncGatewayModule {}
