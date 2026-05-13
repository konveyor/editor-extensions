export interface SuccessRateResponse {
  counted_solutions: number;
  accepted_solutions: number;
  rejected_solutions: number;
  modified_solutions: number;
  pending_solutions: number;
  unknown_solutions: number;
}

export interface BestHintResponse {
  hint_id: number;
  hint: string;
}
