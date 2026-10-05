import path from 'node:path';

export function resolveDastOutput(args, repositoryRoot, workingDirectory = process.cwd()) {
  const option = args.find((argument) => argument.startsWith('--out='));
  if (!option) return path.resolve(repositoryRoot, '.cache/dast/reports-auth');
  const value = option.slice('--out='.length).trim();
  if (!value) throw new Error('--out에는 보고서 폴더를 지정해야 합니다.');
  return path.resolve(workingDirectory, value);
}
