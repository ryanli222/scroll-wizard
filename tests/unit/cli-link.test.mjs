import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression test for isDirect() fail-open under symlinks/junctions
// (scripts/lib/cli.mjs). Node canonicalizes import.meta.url to the
// realpath of the main module, but argv[1] keeps whatever link path was
// invoked (a junction, an npm .bin shim, a manually linked skill install).
// Without realpath-ing argv1 before comparing, isDirect() returns false for
// any CLI invoked through a link, and `if (isDirect(...)) main()` silently
// no-ops -- exit 0, no output, no receipt written by --approve.

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

async function temporaryProject(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

function runNode(args) {
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

describe('CLI invocation through a directory junction/symlink', () => {
  it('runs status.mjs and writes an approval receipt through a linked path', async (ctx) => {
    const linkPath = join(
      tmpdir(),
      'scroll-wizard-link-' + Date.now() + '-' + process.pid,
    );

    try {
      // 'junction' on Windows needs no admin rights; on POSIX the type
      // argument is ignored and a plain directory symlink is created.
      await symlink(repoRoot, linkPath, 'junction');
    } catch (error) {
      ctx.skip();
      return;
    }

    let projectDir;
    try {
      const linkedStatusScript = join(linkPath, 'scripts', 'status.mjs');
      projectDir = await temporaryProject('scroll-wizard-link-project-');
      await writeFile(join(projectDir, 'brief.md'), '# Test brief\n');

      const jsonRun = runNode([linkedStatusScript, projectDir, '--json']);
      expect(jsonRun.status).toBe(0);
      expect(jsonRun.stdout.trim()).not.toBe('');
      const report = JSON.parse(jsonRun.stdout);
      expect(report.resumeStep).toBe(1);

      const approveRun = runNode([linkedStatusScript, projectDir, '--approve', 'brief']);
      expect(approveRun.status).toBe(0);
      expect(approveRun.stdout.trim()).toMatch(/^Approved brief: [a-f0-9]{64}$/);

      const receipts = JSON.parse(
        await readFile(join(projectDir, 'approvals.json'), 'utf8'),
      );
      expect(receipts.brief).toMatchObject({ step: 1 });
      expect(receipts.brief.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      // rmdir (non-recursive) removes only the junction/symlink reparse
      // point itself -- it must never recurse into the linked repo.
      await rmdir(linkPath).catch(() => {});
      if (projectDir) await rm(projectDir, { recursive: true, force: true });
    }
  });
});
