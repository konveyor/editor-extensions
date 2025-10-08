import * as path from 'path';
import { runEvaluation } from './core';

const [, , inputFilePath, outputPath, targetsArg, sourcesArg, model] = process.argv;

if (!inputFilePath || !outputPath || !targetsArg || !sourcesArg || !model) {
  console.error(
    'Usage: evaluate <input_file_path> <output_folder_path> <targets(comma-separated)> <sources(comma-separated)> <model>'
  );
  process.exit(1);
}

const fullInputPath = path.resolve(inputFilePath);
const fullOutputPath = path.resolve(outputPath);

const targets = targetsArg.split(',').map((t) => t.trim());
const sources = sourcesArg.split(',').map((s) => s.trim());

runEvaluation(fullInputPath, fullOutputPath, { targets, sources, model: model.trim() })
  .then(() => console.log('Evaluation finished'))
  .catch((error) => {
    console.error('Evaluation failed:', error);
    process.exit(1);
  });
