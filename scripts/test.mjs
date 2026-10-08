import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const project = new URL('../', import.meta.url);
const temporary = await mkdtemp(join(tmpdir(), 'color-generator-tests-'));
const sourceFiles = (await readdir(new URL('src/', project))).filter(file => file.endsWith('.ts'));
const testFiles = (await readdir(new URL('tests/', project))).filter(file => file.endsWith('.test.ts'));
const files = [...sourceFiles.map(file => `src/${file}`), ...testFiles.map(file => `tests/${file}`)];

try {
  await writeFile(join(temporary, 'package.json'), JSON.stringify({ type: 'module' }));
  for (const file of files) {
    const source = await readFile(new URL(file, project), 'utf8');
    const result = ts.transpileModule(source, {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    const errors = result.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error) ?? [];
    if (errors.length) {
      throw new Error(errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'));
    }
    // The app uses bundler resolution; Node requires extensions for relative ESM imports.
    const javascript = result.outputText.replace(
      /((?:from\s+|import\s*)['"])(\.\.?\/[^'"]+)(['"])/g,
      (_, before, specifier, after) => `${before}${extname(specifier) ? specifier : `${specifier}.js`}${after}`,
    );
    const destination = join(temporary, file.replace(/\.ts$/, '.js'));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, javascript);
  }
  const testPaths = testFiles.map(file => join(temporary, 'tests', file.replace(/\.ts$/, '.js')));
  const result = spawnSync(process.execPath, ['--test', ...testPaths], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  // Only remove the unique directory created by this invocation.
  await rm(temporary, { recursive: true, force: true });
}
