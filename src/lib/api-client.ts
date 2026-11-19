export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
}

export interface DashboardStats {
  total_records: number;
  station_count: number;
  latest_date: string | null;
  latest_waterlevel: number | null;
  latest_discharge: number | null;
  latest_rainfall: number | null;
  latest_risk_level: 'LOW' | 'MODERATE' | 'HIGH' | null;
  latest_station_id: string | null;
  latest_station_name: string | null;
}

export interface Station {
  station_id: string;
  station_name: string | null;
  canonical_station_name?: string | null;
  state?: string | null;
  district?: string | null;
  river?: string | null;
  tributary?: string | null;
  sub_basin?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface FloodRecord {
  id: number;
  date: string;
  station_id: string;
  station_name: string | null;
  waterlevel: number | null;
  discharge: number | null;
  rain: number | null;
  risk_level: 'LOW' | 'MODERATE' | 'HIGH';
}

export interface FloodAlert {
  id: number;
  title: string;
  message: string;
  risk_level: 'LOW' | 'MODERATE' | 'HIGH';
  station_name: string | null;
  created_at: string;
}

export interface NextDayPrediction {
  station_id: string;
  station_name: string | null;
  feature_date: string | null;
  predicted_target_date: string | null;
  predicted_risk: 'LOW' | 'MODERATE' | 'HIGH' | null;
  probability_low: number | null;
  probability_moderate: number | null;
  probability_high: number | null;
  prediction_confidence: number | null;
  prediction_status:
    | 'PREDICTED'
    | 'INSUFFICIENT_HISTORY'
    | 'INVALID_INPUT'
    | 'UNSUPPORTED_STATION';
  status_reason: string;
}

export interface PersistedPrediction {
  prediction_id: number;
  station_id: string;
  canonical_station_name: string | null;
  dataset_station_name: string | null;
  feature_date: string;
  target_date: string | null;
  predicted_class: 'LOW' | 'MODERATE' | 'HIGH' | null;
  probability_low: number | null;
  probability_moderate: number | null;
  probability_high: number | null;
  confidence: number | null;
  prediction_status: 'PREDICTED' | 'INSUFFICIENT_HISTORY' | 'INVALID_INPUT' | 'UNSUPPORTED_STATION';
  model_version: string;
  generated_at: string;
  input_latest_observation_date: string | null;
  data_coverage: string;
  status_reason: string | null;
}

export interface FloodPage {
  data: FloodRecord[];
  pagination: {
    total: number;
    limit: number;
    page: number;
    total_pages: number;
  };
}

export interface CumulativeRiskResult {
  feature_date: string;
  target_date: string | null;
  station_count: number;
  predicted_station_count: number;
  coverage: number;
  risk_level: 'LOW' | 'MODERATE' | 'HIGH' | 'INSUFFICIENT_EVIDENCE';
  risk_score: number;
  uncertainty: {
    level: 'LOW' | 'MODERATE' | 'HIGH';
    reasons: string[];
  };
  decision_reason: string;
  supporting_stations: string[];
  contradicting_stations: string[];
}

export interface RegionalDistrictImpact {
  district: string;
  state: string;
  impact_level: string;
  station_count: number;
  predicted_station_count: number;
  coverage: number;
  high_station_count: number;
  moderate_station_count: number;
  low_station_count: number;
  uncertainty: 'LOW' | 'MODERATE' | 'HIGH';
  supporting_stations: string[];
  supporting_river_systems: string[];
}

export interface RegionalStateImpact {
  state: string;
  impact_level: string;
  configured_station_count: number;
  predicted_station_count: number;
  coverage: number;
  high_station_count: number;
  moderate_station_count: number;
  low_station_count: number;
  uncertainty: 'LOW' | 'MODERATE' | 'HIGH';
  supporting_stations: string[];
  supporting_river_systems: string[];
}

export interface RegionalImpactResult {
  feature_date: string;
  target_date: string | null;
  regional_impact_level: string;
  basin_geographic_coverage: {
    represented_states: string[];
    represented_state_count: number;
    unrepresented_basin_states: string[];
    geographic_coverage_status: 'PARTIAL';
  };
  potentially_affected_states: string[];
  potentially_affected_districts: string[];
  supporting_stations: string[];
  supporting_river_systems: string[];
  uncertain_regions: string[];
  state_impact_evidence: RegionalStateImpact[];
  district_impact_evidence: RegionalDistrictImpact[];
  data_quality: {
    missing_stations: string[];
    missing_district_metadata: string[];
    missing_state_metadata: string[];
    coverage: number;
  };
}

export interface ActiveProjectAlert {
  alert_id: number;
  severity: 'WATCH' | 'ADVISORY' | 'WARNING' | 'CRITICAL';
  lifecycle_state: string;
  feature_date: string;
  target_date: string;
  confidence: number | null;
  coverage: number | null;
  uncertainty: 'LOW' | 'MODERATE' | 'HIGH';
  affected_states: string[];
  affected_districts: string[];
  supporting_systems: string[];
  supporting_stations: string[];
  headline: string;
  message: string;
  recommended_action: string | null;
  disclaimer: string;
  created_at: string;
}

export interface LatestPredictionRun {
  run_id: number;
  feature_date: string;
  target_date: string;
  started_at: string;
  completed_at: string | null;
  status: 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  model_version: string;
  configured_station_count: number;
  successful_prediction_count: number;
  insufficient_history_count: number;
  failure_count: number;
}

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || '/api').replace(/\/+$/, '');

export class ApiError extends Error {}

async function request<T>(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Could not reach the backend. Check that the server is running.');
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError('The API returned an invalid response.');
  }
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null
      && 'message' in data && typeof data.message === 'string'
      ? data.message
      : 'The request could not be completed.';
    throw new ApiError(message);
  }
  return data as T;
}

export const api = {
  login(email: string, password: string) {
    return request<{ token: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
  },
  dashboard() {
    return request<DashboardStats>('/dashboard/stats');
  },
  stations() {
    return request<{ data: Station[] }>('/stations');
  },
  floodData(filters: {
    station_id?: string;
    start_date?: string;
    end_date?: string;
    page: number;
    limit: number;
  }) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    return request<FloodPage>(`/flood-data?${query.toString()}`);
  },
  predictNextDay(input: { station_id: string; feature_date?: string }) {
    return request<NextDayPrediction>('/predictions/next-day', {
      method: 'POST',
      body: input,
    });
  },
  persistedPredictions(stationId?: string) {
    const query = stationId
      ? `?station_id=${encodeURIComponent(stationId)}`
      : '';
    return request<{ data: PersistedPrediction[] }>(`/predictions/latest${query}`);
  },
  cumulativeRisk() {
    return request<CumulativeRiskResult>('/predictions/cumulative-evidence');
  },
  regionalImpact() {
    return request<RegionalImpactResult>('/predictions/regional-impact');
  },
  activeAlerts() {
    return request<{ data: ActiveProjectAlert[] }>('/alerts/active');
  },
  latestPredictionRun() {
    return request<{ data: LatestPredictionRun | null }>('/predictions/runs/latest');
  },
  alerts() {
    return request<{ data: FloodAlert[] }>('/alerts');
  },
  createAlert(
    token: string,
    alert: { title: string; message: string; risk_level: string; station_name: string | null },
  ) {
    return request<FloodAlert>('/alerts', { method: 'POST', token, body: alert });
  },
  deleteAlert(token: string, id: number) {
    return request<{ message: string }>(`/alerts/${id}`, { method: 'DELETE', token });
  },
};
