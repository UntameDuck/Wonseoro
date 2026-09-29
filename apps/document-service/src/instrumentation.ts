import { startTelemetry } from '@wonseoro/server-kit/dist/telemetry-sdk';

// main 의 첫 import 여야 한다 — pg·Nest 가 로드되기 전에 SDK 가 떠야 DB·핸들러 span 이 잡힌다. (T-M4-20)
export const shutdownTelemetry = startTelemetry('document-service');

// 앱을 만들기 전(설정 검사 등) 찍히는 로그도 구조화·마스킹을 거치게 전역 로거를 바꾼다. (T-M4-24)
// SDK 시작 뒤에 불러야 Nest 계측이 먼저 걸린다 — 그래서 import 가 아니라 require 다.
/* eslint-disable @typescript-eslint/no-require-imports */
const { Logger } = require('@nestjs/common') as typeof import('@nestjs/common');
const { StructuredLogger } =
  require('@wonseoro/server-kit/dist/telemetry/logger') as typeof import('@wonseoro/server-kit/dist/telemetry/logger');
Logger.overrideLogger(new StructuredLogger('document-service'));
