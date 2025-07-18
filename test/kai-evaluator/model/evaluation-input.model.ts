import { Incident } from './analysis-result.model';

export interface FileEvaluationInput {
  originalContent: string;
  incidents: Incident[];
  updatedContent: string;
}
