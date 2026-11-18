export type FloodRiskClass = 'LOW' | 'MODERATE' | 'HIGH';

export interface FloodRiskInput {
  waterlevel: number | null;
  discharge: number | null;
  rainfall: number | null;
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
}

export interface FloodRiskPrediction {
  riskClass: FloodRiskClass;
  probabilities: {
    low: number;
    moderate: number;
    high: number;
  };
}

export interface FloodRiskPredictor {
  predict(input: FloodRiskInput): Promise<FloodRiskPrediction>;
}

export type PredictionStatus =
  | 'PREDICTED'
  | 'INSUFFICIENT_HISTORY'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_STATION';

export interface NextDayPredictionRequest {
  station_id: string;
  feature_date?: string;
}

export interface NextDayPredictionResult {
  station_id: string;
  station_name: string | null;
  feature_date: string | null;
  predicted_target_date: string | null;
  predicted_risk: FloodRiskClass | null;
  probability_low: number | null;
  probability_moderate: number | null;
  probability_high: number | null;
  prediction_confidence: number | null;
  prediction_status: PredictionStatus;
  status_reason: string;
}

export interface NextDayPredictionProvider {
  predictNextDay(request: NextDayPredictionRequest): Promise<NextDayPredictionResult>;
}
