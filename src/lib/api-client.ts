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

export interface FloodPage {
  data: FloodRecord[];
  pagination: {
    total: number;
    limit: number;
    page: number;
    total_pages: number;
  };
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
