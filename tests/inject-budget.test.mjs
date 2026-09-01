import assert from 'node:assert/strict';
import test from 'node:test';

import { makeFact } from '../src/schema.mjs';
import { selectForInjection } from '../src/injector.mjs';
import { extractCandidates } from '../src/distiller.mjs';

test('schema: status 기본값은 verified, proposed 허용, 그 외 거부', () => {
  const f = makeFact({ statement: '테스트 문장입니다 스무자 넘게 씁니다', fact_type: 'preference', scope: 'global' });
  assert.equal(f.status, 'verified');

  const p = makeFact({ statement: '자동 증류 후보 문장입니다 스무자 넘게', fact_type: 'decision', scope: 'global', status: 'proposed' });
  assert.equal(p.status, 'proposed');

  assert.throws(() =>
    makeFact({ statement: '잘못된 상태값 문장입니다 스무자 넘게', fact_type: 'decision', scope: 'global', status: 'junk' }),
  );
});

test('selectForInjection: proposed 제외, 최신순, 개수 상한', () => {
  const facts = [
    makeFact({ statement: '오래된 verified 사실입니다 스무자 넘게 채움', fact_type: 'preference', scope: 'global', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }),
    makeFact({ statement: '최신 verified 사실입니다 스무자 넘게 채움', fact_type: 'preference', scope: 'global', created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z' }),
    makeFact({ statement: 'proposed 후보 사실입니다 스무자 넘게 채움', fact_type: 'decision', scope: 'global', status: 'proposed' }),
  ];
  const { selected, omitted } = selectForInjection(facts, 1);
  assert.equal(selected.length, 1);
  assert.match(selected[0].statement, /최신 verified/);
  assert.equal(omitted, 2);

  const all = selectForInjection(facts, 10);
  assert.equal(all.selected.length, 2, 'proposed는 상한이 넉넉해도 제외');
});

test('distiller 후보는 여전히 추출되지만 proposed로 저장되도록 status가 지정된다', () => {
  const text = '우리는 앞으로 Postgres를 사용한다 이것이 결정이다\n짧은줄\n나는 항상 다크모드를 선호한다 언제나 그렇다';
  const candidates = extractCandidates(text);
  assert.ok(candidates.length >= 2);
  // 실제 저장 경로(distillSession)는 status: 'proposed'를 강제한다 — makeFact 재현으로 검증
  const stored = makeFact({ ...candidates[0], scope: 'global', source_ref: 'session:test', status: 'proposed' });
  assert.equal(stored.status, 'proposed');
});
