import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(path.join(tmpdir(), 'game1-save-'));

afterAll(() => rmSync(workDir, { recursive: true, force: true }));

function run(script: string, ...args: string[]): Record<string, unknown> {
  const out = execFileSync(
    'node',
    ['--import', 'tsx', path.join(here, 'scripts', script), ...args],
    { encoding: 'utf8', cwd: path.resolve(here, '../..') },
  );
  return JSON.parse(out) as Record<string, unknown>;
}

/**
 * The one path every player takes on every launch, and the one this suite was
 * blind to for three milestones.
 *
 * Loading a career in a *fresh process* is not the same as loading one in a
 * process that has already built a world: module-level state -- the player id
 * counter, most obviously -- starts at its initial value rather than wherever
 * the previous world left it. Every other persistence test runs in-process and
 * therefore cannot see a whole class of bug. This one spawns real processes.
 */
describe('save and load across processes', () => {
  const savePath = path.join(workDir, 'career.json');
  let written: Record<string, unknown>;
  let read: Record<string, unknown>;

  // In beforeAll, not the describe body: spawning two processes at collection
  // time makes them un-skippable and reports a failure as a collection error.
  beforeAll(() => {
    written = run('writeSave.script.ts', savePath, 'cross-process');
    read = run('readSave.script.ts', savePath);
  }, 60_000);

  it('restores the world exactly as it was written', () => {
    expect(read.players).toBe(written.players);
    expect(read.rngState).toBe(written.rngState);
    expect(read.resultsHash).toBe(written.resultsHash);
    // Every player, name and ability, to three decimals.
    expect(read.squadHash).toBe(written.squadHash);
  });

  it('does not mint colliding player ids in the new process', () => {
    // The bug this exists for: the id counter is a module global that only
    // createWorld resets, so a freshly launched app used to re-mint p1 and
    // silently overwrite a real player in the lookup table.
    expect(read.duplicates).toEqual([]);
    expect(read.mismatched).toBe(0);
  });

  it('plays on into the next season', () => {
    expect(read.season).toBe(2);
  });
});
