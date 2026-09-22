import { Module } from '@nestjs/common';
import { ProfileVaultController } from './profile-vault.controller';
import { ProfileVaultService } from './profile-vault.service';

@Module({
  controllers: [ProfileVaultController],
  providers: [ProfileVaultService],
  exports: [ProfileVaultService],
})
export class ProfileVaultModule {}
