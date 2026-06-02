import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
// @ts-ignore - js-yaml lacks type definitions
import { load } from 'js-yaml';

describe('storageSizeMonitor workflow', () => {
  const workflowPath = '.github/workflows/storage-size-monitor.yml';
  const workflow = load(readFileSync(workflowPath, 'utf-8')) as Record<string, unknown>;

  it('triggers on daily schedule at 06:00 UTC', () => {
    const on = workflow.on as Record<string, unknown>;
    const schedule = on?.schedule as Array<Record<string, unknown>> | undefined;
    assert(schedule && schedule.length > 0, 'schedule trigger not found');
    assert.strictEqual((schedule[0] as Record<string, unknown>)?.cron, '0 6 * * *', 'cron should be daily at 06:00 UTC');
  });

  it('allows manual trigger via workflow_dispatch', () => {
    const on = workflow.on as Record<string, unknown>;
    const dispatch = on?.workflow_dispatch;
    assert(dispatch !== undefined, 'workflow_dispatch not found');
  });

  it('has correct permissions', () => {
    const perms = workflow.permissions as Record<string, unknown>;
    assert.strictEqual(perms?.contents, 'read', 'contents must be read-only');
    assert.strictEqual(perms?.issues, 'write', 'issues must be writable');
    const keys = Object.keys(perms || {});
    assert.strictEqual(keys.length, 2, `only 2 permissions allowed, got: ${keys.join(', ')}`);
  });

  it('has correct concurrency config', () => {
    const concurrency = workflow.concurrency as Record<string, unknown>;
    assert.strictEqual(concurrency?.group, 'storage-size-monitor', 'concurrency group mismatch');
    assert.strictEqual(
      (concurrency as Record<string, unknown>)?.['cancel-in-progress'],
      false,
      'cancel-in-progress must be false'
    );
  });

  it('monitors threshold of 100 MB', () => {
    const jobs = workflow.jobs as Record<string, unknown>;
    const monitor = jobs?.monitor as Record<string, unknown>;
    const steps = monitor?.steps as Array<Record<string, unknown>> | undefined;
    const checkStep = steps?.find((s) => (s?.id as string) === 'check');
    assert(checkStep, 'check step not found');
    const run = checkStep?.run as string | undefined;
    assert(run && run.includes('THRESHOLD=100'), 'threshold should be 100 MB');
  });

  it('watches folder: data/discord/game-state', () => {
    const jobs = workflow.jobs as Record<string, unknown>;
    const monitor = jobs?.monitor as Record<string, unknown>;
    const steps = monitor?.steps as Array<Record<string, unknown>> | undefined;
    const sizeStep = steps?.find((s) => (s?.id as string) === 'size');
    assert(sizeStep, 'size step not found');
    const run = sizeStep?.run as string | undefined;
    assert(run && run.includes('data/discord/game-state'), 'must monitor data/discord/game-state');
  });

  it('deduplicates alert issues by title search', () => {
    const jobs = workflow.jobs as Record<string, unknown>;
    const monitor = jobs?.monitor as Record<string, unknown>;
    const steps = monitor?.steps as Array<Record<string, unknown>> | undefined;
    const issueStep = steps?.find((s) => (s?.id as string) === 'issue');
    assert(issueStep, 'issue step not found');
    const run = issueStep?.run as string | undefined;
    assert(
      run && run.includes('gh issue list'),
      'must use gh issue list for deduplication'
    );
    assert(
      run && run.includes('[storage] data/discord/game-state exceeds threshold'),
      'must search by expected alert title'
    );
  });

  it('checks out with pinned SHA', () => {
    const jobs = workflow.jobs as Record<string, unknown>;
    const monitor = jobs?.monitor as Record<string, unknown>;
    const steps = monitor?.steps as Array<Record<string, unknown>> | undefined;
    const checkout = steps?.[0];
    assert(checkout, 'first step should be checkout');
    const checkoutUses = checkout?.uses as string | undefined;
    assert(
      checkoutUses && checkoutUses.startsWith('actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5'),
      'checkout must use pinned SHA 34e114876b0b11c390a56381ad16ebd13914f8d5'
    );
  });
});
