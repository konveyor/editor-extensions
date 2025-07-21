import fs from 'fs';
import { EvaluationResult } from './model/evaluation-result.model';
import { evaluateFile } from './agents/evaluation.agent';
import { FileEvaluationInput } from './model/evaluation-input.model';
import path from 'path';
import { downloadObject, uploadObject } from './utils/s3.utils';
import { isBuildable } from './utils/build.utils';

export async function runEvaluation(
  fileInputPath: string,
  fileOutputPath: string,
  model = 'meta.llama3-70b-instruct-v1:0',
  repositoryPath?: string
) {
  if (!fs.existsSync(fileInputPath)) {
    throw new Error(`Input file does not exist: ${fileInputPath}`);
  }

  const data = JSON.parse(fs.readFileSync(fileInputPath, 'utf-8'));
  console.log('Evaluating results...');
  const dataLength = Object.keys(data).length;
  const evaluationResult: EvaluationResult = {
    evaluationTime: 0,
    fileEvaluationResults: [],
    date: new Date(),
    averageSpecificity: 0,
    averageCompetency: 0,
    averageEffectiveness: 0,
    averageScore: 0,
    totalFiles: dataLength,
    model,
    evaluationModel: 'meta.llama3-70b-instruct-v1:0', // TODO take from env
    errors: [],
  };

  if (repositoryPath) {
    evaluationResult.buildable = await isBuildable(path.resolve(repositoryPath));
  }

  const start = new Date();
  for (const file of Object.keys(data))
    try {
      const res = await evaluateFile(file, data[file] as unknown as FileEvaluationInput);
      evaluationResult.fileEvaluationResults.push(res);
      evaluationResult.averageSpecificity += res.specificity;
      evaluationResult.averageCompetency += res.competency;
      evaluationResult.averageEffectiveness += res.effectiveness;
      evaluationResult.averageScore += res.averageScore;
    } catch (e) {
      evaluationResult.errors.push(`Error while evaluating file ${file}\n Reason: ${e}`);
    }

  const end = new Date();
  evaluationResult.evaluationTime = end.getTime() - start.getTime();

  evaluationResult.averageSpecificity /= dataLength;
  evaluationResult.averageCompetency /= dataLength;
  evaluationResult.averageEffectiveness /= dataLength;
  evaluationResult.averageScore /= dataLength;
  console.log('Evaluation Finished, writing results to file...');
  fs.writeFileSync(
    path.join(fileOutputPath, 'evaluation-result.json'),
    JSON.stringify(evaluationResult, null, 2),
    'utf-8'
  );
  console.log('Uploading results to aws...');
  const awsReport = await downloadObject('report.json');
  if (awsReport.Body) {
    const awsReportBody = JSON.parse(await awsReport.Body.transformToString()) as any[];
    awsReportBody.push(evaluationResult);
    fs.writeFileSync(
      path.join(fileOutputPath, 'report.json'),
      JSON.stringify(awsReportBody, null, 2),
      'utf-8'
    );
    if (process.env.CI) {
      await uploadObject(JSON.stringify(awsReportBody), 'report.json');
    }
  }
  console.log('Execution finished...');
}
