import { homedir } from 'node:os';

const approvedHosts = new Set([
  'registry.npmjs.org', 'nodejs.org', 'www.typescriptlang.org', 'www.apache.org',
  // Synthetic HTTP fixtures bind locally; no real network address is published.
  'localhost',
]);

export const projectIdentity = 'Agent Loom contributors <contributors@example.invalid>';

export function inspectText(content, privateTerms = []) {
  const findings = new Set();
  const rules = [
    ['absolute local path', /\b[a-z]:[\\/]|(?:^|[\s"'`(])\/(?:Users|home|mnt|media|Volumes)\//im],
    ['network or file reference', /\\\\[a-z0-9_.-]+\\|file:\/\/|git@[a-z0-9_.-]+:/i],
    ['credential pattern', /\b(?:gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|sk-[a-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/i],
    ['private key', /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
    ['network address', /\b(?:\d{1,3}\.){3}\d{1,3}\b/],
    ['binary content', /\x00/],
  ];
  for (const [name, pattern] of rules) if (pattern.test(content)) findings.add(name);
  for (const match of content.matchAll(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    if (!/^(?:example\.(?:com|org|net|invalid|test)|[a-z0-9.-]+\.(?:invalid|test))$/i.test(match[1])) {
      findings.add('non-example email address');
    }
  }
  for (const match of content.matchAll(/https?:\/\/[^\s<>"'`\\)]+/gi)) {
    try {
      const url = new URL(match[0]);
      if (!approvedHosts.has(url.hostname) || url.username || url.password
        || (url.protocol !== 'https:' && !['www.apache.org', 'localhost'].includes(url.hostname))) {
        findings.add('unreviewed external URL');
      }
    } catch {
      findings.add('malformed external URL');
    }
  }
  const terms = [homedir(), process.env.USERNAME, process.env.USER, process.env.COMPUTERNAME,
    process.env.USERDOMAIN, ...privateTerms].filter((term) => term && term.length >= 4
      && !['root', 'runner', 'workgroup', 'users', projectIdentity].includes(term.toLowerCase()));
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![a-z0-9_])${escaped}(?![a-z0-9_])`, 'i').test(content)) {
      findings.add('local identity or environment value');
    }
  }
  return [...findings];
}

export function inspectPath(path) {
  const normalized = path.replaceAll('\\', '/');
  if (/(?:^|\/)(?:node_modules|dist|coverage|local|private|vendor|tmp|\.git|\.agents|\.codex|\.codex-tmp|\.test-tmp|\.agent-container|\.agent-loom|\.c2forge|\.c2decoder|\.agent-postmortem)(?:\/|$)/i.test(normalized)
    || /(?:^|\/)\.env(?:\.|$)/i.test(normalized)
    || /(?:\.local\.[^/]+|\.(?:log|pem|key|p12|pfx))$/i.test(normalized)) {
    return ['private or generated file'];
  }
  return [];
}
