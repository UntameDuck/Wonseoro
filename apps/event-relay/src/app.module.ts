import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@wonseoro/server-kit';
import { HeartbeatService } from './heartbeat.service';
import { RelayController } from './relay.controller';
import { RelayService } from './relay.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // 대학 DB 를 읽는다. 접수 API 의 커넥션 몫을 뺏지 않도록 예산이 작다.
    DbModule.forRoot('event-relay', 'kadmission'),
  ],
  controllers: [RelayController],
  // 대학 상태 심장박동 — 조용한 대학과 죽은 대학을 중앙이 구별하게 한다 (D-60)
  providers: [RelayService, HeartbeatService],
})
export class AppModule {}
