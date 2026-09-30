import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ConfigRegistryModule } from '../config/config-registry.module';
import { DocumentController } from './document.controller';
import { DocumentScanController } from './document-scan.controller';
import { DocumentService } from './document.service';
import { FileInspector } from './file-inspector';
import { ObjectStorage } from './object-storage';

@Module({
  // 전형이 받는 서류 종류는 전형 설정에서 읽는다 (§A5)
  imports: [AuditModule, ConfigRegistryModule],
  controllers: [DocumentController, DocumentScanController],
  providers: [DocumentService, ObjectStorage, FileInspector],
  exports: [DocumentService],
})
export class DocumentModule {}
