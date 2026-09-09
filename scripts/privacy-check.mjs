import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { inspectPath, inspectText, projectIdentity } from './privacy-rules.mjs';

function git(args, optional = false) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    if (optional) return '';
    throw new Error('Git inspection failed; publication scan cannot proceed.');
  }
  return result.stdout;
}

const privateTerms = ['user.name', 'user.email'].map((key) => git(['config', '--global', '--get', key], true).trim())
  .filter((value) => value && !projectIdentity.includes(value));
let scanned = 0;
let failures = 0;
const seenBlobs = new Set();

function report(kinds) {
  if (kinds.length === 0) return;
  failures += kinds.length;
  // Do not echo offending names, snippets, paths, or secrets into CI output.
  console.error(`Publication entry ${scanned}: ${kinds.join(', ')}`);
}

function scan(content, path) {
  scanned += 1;
  report([...inspectText(content, privateTerms), ...(path === undefined ? [] : [
    ...inspectPath(path), ...inspectText(path, privateTerms),
  ])]);
}

function blob(path, oid, mode) {
  scan(path, path);
  if (mode !== '100644' && mode !== '100755') {
    report(['symlink or submodule requires explicit public review']);
    return;
  }
  if (seenBlobs.has(oid)) return;
  seenBlobs.add(oid);
  scan(git(['cat-file', 'blob', oid]));
}

function metadata(raw, tag = false) {
  scan(raw);
  const header = raw.split('\n\n')[0];
  const names = tag ? ['tagger'] : ['author', 'committer'];
  for (const name of names) {
    const match = header.match(new RegExp(`^${name} (.+) [0-9]+ [+-][0-9]{4}$`, 'm'));
    if (!match || match[1] !== projectIdentity) report(['non-project Git identity']);
  }
  if (/^(?:gpgsig|mergetag) /m.test(header)) report(['unreviewed embedded Git identity']);
}

try {
  if (process.argv.includes('--history')) {
    const refs = git(['for-each-ref', '--format=%(refname) %(objecttype) %(objectname)']);
    scan(refs);
    for (const line of refs.trim().split('\n').filter(Boolean)) {
      const [, type, oid] = line.split(' ');
      if (type === 'tag') metadata(git(['cat-file', 'tag', oid]), true);
    }
    const commits = git(['rev-list', '--all']).trim().split('\n').filter(Boolean);
    const trees = new Set();
    for (const commit of commits) {
      const raw = git(['cat-file', 'commit', commit]);
      metadata(raw);
      const tree = raw.match(/^tree ([a-f0-9]+)$/m)?.[1];
      if (!tree) throw new Error('Commit tree is missing.');
      if (trees.has(tree)) continue;
      trees.add(tree);
      for (const entry of git(['ls-tree', '-r', '-z', tree]).split('\0').filter(Boolean)) {
        const [header, ...parts] = entry.split('\t');
        const [mode, , oid] = header.split(' ');
        blob(parts.join('\t'), oid, mode);
      }
    }
  } else {
    const staged = git(['diff', '--cached', '--name-only', '-z']);
    if (staged) {
      for (const entry of git(['ls-files', '--stage', '-z']).split('\0').filter(Boolean)) {
        const [header, ...parts] = entry.split('\t');
        const [mode, oid, stage] = header.split(' ');
        if (stage !== '0') throw new Error('Resolve index conflicts before publication.');
        blob(parts.join('\t'), oid, mode);
      }
    } else {
      const files = new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean));
      for (const path of files) {
        if (!existsSync(path)) continue;
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          scanned += 1;
          report(['unreviewed file type']);
        } else {
          scan(readFileSync(path, 'utf8'), path);
        }
      }
    }
  }
  if (failures) {
    console.error(`Publication scan failed: ${failures} finding(s). Review locally before publishing.`);
    process.exitCode = 1;
  } else {
    console.log(`Publication scan passed: ${scanned} entries checked. Manual prose review is still required.`);
  }
} catch {
  console.error('Publication scan could not complete. Check local Git and file access before publishing.');
  process.exitCode = 1;
}
