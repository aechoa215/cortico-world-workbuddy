// dry-mount 的执行体：由 scripts/selfcheck.mjs 用 tsx loader + cortico runtime 拉起。
// 参数：<packageDir> <scratchDir> <reportFile>
import { writeFileSync } from 'node:fs';

const [, , packageDir, scratchDir, reportFile] = process.argv;
const base = packageDir.replaceAll('\\', '/');

const { WORKBUDDY } = await import(`file:///${base}/src/definition.js`);
const { dryMountWorld } = await import('cortico/extensions/dry-mount.ts');

const report = await dryMountWorld(WORKBUDDY, {
  scratchDir,
  packageDir,
  language: 'zh',
  hasWebUiClient: true,
});
const payload = { packageDir, ...report };
if (reportFile) writeFileSync(reportFile, JSON.stringify(payload, null, 2), 'utf8');
console.log(JSON.stringify(payload, null, 2));
