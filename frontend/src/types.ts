export type Domain =
  | "security_ops"
  | "access_controls"
  | "risk"
  | "incident_response"
  | "cryptography"
  | "network"
  | "sys_app_security";

export interface Question {
  id: number;
  stem: string;
  options: [string, string, string, string];
  domain: Domain;
}

export interface Batch {
  run_id: number;
  batch_index: number;
  game_key: string;
  questions: Question[];
  is_final: boolean;
}

export interface AnswerResult {
  correct: boolean;
  correct_index: number;
  explanation: string;
}
