export interface EvaluationResult {
  evaluationTime: number;
  fileEvaluationResults: FileEvaluationResult[];
  date: Date;
  averageSpecificity: number;
  averageCompetency: number;
  averageEffectiveness: number;
  averageScore: number;
  totalFiles: number;
  model: string;
  evaluationModel: string;
  errors: string[];
  buildable?: boolean;
}

export interface FileEvaluationResult {
  file: string;
  specificity: number;
  competency: number;
  effectiveness: number;
  validCode: boolean;
  unnecessaryChanges: boolean;
  detailedNotes: string;
  averageScore: number;
}
