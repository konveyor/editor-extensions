import fs from 'fs';
import { ORIGINAL_ANALYSIS_FILENAME, TEST_OUTPUT_FOLDER } from './consts';
import { AnalysisResult, Violation } from '../../kai-evaluator/model/analysis-result.model';
import { getOSInfo } from './utils';
import { execSync } from 'child_process';
import path from 'path';

function convertFileUriToPath(fileUri: string): string {
  return fileUri.replace(getOSInfo() === 'windows' ? 'file:///' : 'file://', '');
}

export async function prepareEvaluationData(model: string) {
  console.log('Saving coolstore directory to output...');
  fs.cpSync('coolstore', `${TEST_OUTPUT_FOLDER}/coolstore-${model.replace(/[.:]/g, '-')}`, {
    recursive: true,
  });

  const analysisData = JSON.parse(
    await fs.promises.readFile(path.join(TEST_OUTPUT_FOLDER, ORIGINAL_ANALYSIS_FILENAME), 'utf-8')
  );
  const incidentsMap: Record<string, any> = {};

  for (const analysis of analysisData as AnalysisResult[]) {
    for (const violation of Object.values(analysis.violations) as Violation[]) {
      for (const incident of violation.incidents) {
        if (!incidentsMap[incident.uri]) {
          incidentsMap[incident.uri] = { incidents: [] };
        }
        incidentsMap[incident.uri].incidents.push(incident);
      }
    }
  }

  for (const fileUri of Object.keys(incidentsMap)) {
    incidentsMap[fileUri].updatedContent = fs.readFileSync(convertFileUriToPath(fileUri), 'utf-8');
  }

  console.log('Resetting coolstore repo...');
  execSync(`cd coolstore && git checkout . && cd ..`);

  for (const fileUri of Object.keys(incidentsMap)) {
    incidentsMap[fileUri].originalContent = fs.readFileSync(convertFileUriToPath(fileUri), 'utf-8');
  }

  fs.writeFileSync(
    path.join(TEST_OUTPUT_FOLDER, 'incidents-map.json'),
    JSON.stringify(incidentsMap, null, 2),
    'utf-8'
  );

  console.log('Incidents mapping finished.');
}

export async function saveOriginalAnalysisFile() {
  fs.cpSync(
    await getFirstAnalysisFile(),
    path.join(TEST_OUTPUT_FOLDER, ORIGINAL_ANALYSIS_FILENAME),
    { force: true }
  );
}

async function getFirstAnalysisFile() {
  const konveyorFolder = 'coolstore/.vscode/konveyor-core';
  const files = await fs.promises.readdir(konveyorFolder);

  const analysisFiles = files.filter((file) => file.startsWith('analysis'));

  if (!analysisFiles.length) {
    throw new Error('Could not find analysis file');
  }

  const filesWithStats = await Promise.all(
    analysisFiles.map(async (file) => {
      const fullPath = path.join(konveyorFolder, file);
      const stats = await fs.promises.stat(fullPath);
      return { file, mtime: stats.mtime };
    })
  );

  filesWithStats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
  return path.join(konveyorFolder, filesWithStats[0].file);
}
