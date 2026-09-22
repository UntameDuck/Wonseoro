import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@wonseoro/server-kit';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ProfileVaultModule } from './modules/profile-vault/profile-vault.module';
import { SyncGatewayModule } from './modules/sync-gateway/sync-gateway.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule.forRoot('central-api', 'kadmission_central'),
    SyncGatewayModule,
    ProfileVaultModule,
    DashboardModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
