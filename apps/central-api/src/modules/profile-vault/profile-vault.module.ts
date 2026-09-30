import { Module } from '@nestjs/common';
import { ApplicantProfileController, ProfileVaultController } from './profile-vault.controller';
import { ProfileVaultService } from './profile-vault.service';

@Module({
  controllers: [ProfileVaultController, ApplicantProfileController],
  providers: [ProfileVaultService],
  exports: [ProfileVaultService],
})
export class ProfileVaultModule {}
