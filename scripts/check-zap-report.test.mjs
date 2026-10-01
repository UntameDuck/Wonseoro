import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { summarizeZapReport } from './check-zap-report.mjs';

const report = (alerts) => ({
  '@version': '2.17.0',
  site: [{ '@name': 'http://127.0.0.1:3001', alerts }],
});

describe('ZAP DAST 판정기', () => {
  it('High가 없으면 스캔 대상과 경고 수를 센다', () => {
    const result = summarizeZapReport(
      report([{ pluginid: '10020', name: 'X-Frame-Options', riskcode: '1', riskdesc: 'Low' }]),
    );
    assert.equal(result.sites, 1);
    assert.equal(result.alerts, 1);
    assert.deepEqual(result.high, []);
  });

  it('riskcode 3 또는 High 표기를 High로 판정한다', () => {
    const result = summarizeZapReport(
      report([
        { pluginid: '40018', name: 'SQL Injection', riskcode: '3', riskdesc: 'High (Medium)' },
        { pluginid: '90020', name: 'Command Injection', riskcode: '', riskdesc: 'High' },
      ]),
    );
    assert.equal(result.high.length, 2);
    assert.equal(result.high[0].pluginId, '40018');
  });

  it('site가 없는 빈 보고서는 성공으로 보지 않는다', () => {
    assert.throws(() => summarizeZapReport({ site: [] }), /스캔 대상 site가 없습니다/);
  });

  it('형식이 다른 site도 성공으로 보지 않는다', () => {
    assert.throws(() => summarizeZapReport({ site: [{ '@name': 'local' }] }), /alerts 배열이 없습니다/);
  });
});
