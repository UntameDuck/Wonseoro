import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@wonseoro/server-kit';
import { RelayController } from './relay.controller';
import { RelayService } from './relay.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // 대학 DB 를 읽는다. 접수 API 의 커넥션 몫을 뺏지 않도록 예산이 작다.
    DbModule.forRoot('event-relay', 'kadmission'),
  ],
  controllers: [RelayController],
  providers: [RelayService],
})
export class AppModule {}
