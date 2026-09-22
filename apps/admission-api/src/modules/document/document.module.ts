import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { FileInspector } from './file-inspector';
import { ObjectStorage } from './object-storage';

@Module({
  imports: [AuditModule],
  controllers: [DocumentController],
  providers: [DocumentService, ObjectStorage, FileInspector],
  exports: [DocumentService],
})
export class DocumentModule {}
