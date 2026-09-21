import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.argv[2] || 'F:/AILIS/MAIN');
const target = path.join(root, 'vendor/ailis');
fs.mkdirSync(target, { recursive: true });
const names = ['electron/ailis-memory-store.cjs', 'electron/ailis-memory-lexical-retriever.cjs', 'LICENSE'];
const files = names.map(name => {
  const content = fs.readFileSync(path.join(source, name));
  fs.writeFileSync(path.join(target, path.basename(name)), content);
  return { source: name, target: path.basename(name), sha256: createHash('sha256').update(content).digest('hex') };
});
const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
const manifest = {
  source, repository: git(['remote', 'get-url', 'origin']), commit: git(['rev-parse', 'HEAD']),
  branch: git(['branch', '--show-current']), snapshotTime: new Date().toISOString(),
  selectedFilesDirty: git(['status', '--short', '--', ...names]), files,
  note: 'Exact working-tree copies. Only the two memory modules are executed; desktop state, secrets and other modules are not imported.'
};
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
