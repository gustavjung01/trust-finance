import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

function readGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return process.env.VERCEL_GIT_COMMIT_SHA || process.env.SOURCE_VERSION || 'unknown';
  }
}

const git = readGitSha();
const data = {
  version: `${git}-${Date.now()}`,
  git,
  builtAt: new Date().toISOString()
};

writeFileSync('public/app-version.json', JSON.stringify(data, null, 2));
console.log('Generated public/app-version.json', data.version);
