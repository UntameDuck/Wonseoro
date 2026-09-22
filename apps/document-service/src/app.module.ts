import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScannerController } from './scanner.controller';
import { ScannerService } from './scanner.service';

/**
 * 이 서비스는 DB 에 직접 붙지 않는다.
 * 서류 상태의 원장은 대학 DB 이고, 그 변경은 admission-api 만 한다. (ADR-0004)
 * 워커가 DB 를 직접 고치면 상태 전이 규칙이 두 곳에 생긴다.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [ScannerController],
  providers: [ScannerService],
})
export class AppModule {}
