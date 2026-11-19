'use client';

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  api,
  ApiError,
  type AuthUser,
  type CumulativeRiskResult,
  type DashboardStats,
  type FloodAlert,
  type FloodRecord,
  type ActiveProjectAlert,
  type RegionalImpactResult,
  type PersistedPrediction,
  type Station,
} from '@/lib/api-client';

import dynamic from 'next/dynamic';

const GodavariRiskMap = dynamic(
  () => import('@/components/godavari-risk-map'),
  {
    ssr: false,
    loading: () => <div className="gis-loading">Loading station map…</div>,
  },
);

type Screen = 'dashboard' | 'monitoring' | 'alerts';
type Risk = 'LOW' | 'MODERATE' | 'HIGH';

const devBypassEnabled =
  process.env.NODE_ENV === 'development'
  && process.env.NEXT_PUBLIC_DEV_BYPASS_LOGIN === 'true';

export default function FloodMonitorApp() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginPending, setLoginPending] = useState(false);
  const [previewDismissed, setPreviewDismissed] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError('');
    setLoginPending(true);
    try {
      const result = await api.login(email.trim(), password);
      setToken(result.token);
      setUser(result.user);
    } catch (error) {
      setLoginError(error instanceof ApiError ? error.message : 'Unable to sign in.');
    } finally {
      setLoginPending(false);
    }
  }

  function signOut() {
    setToken(null);
    setUser(null);
    setPassword('');
    setScreen('dashboard');
  }

  if (!user && (!devBypassEnabled || previewDismissed)) {
    return (
      <LoginScreen
        email={email}
        password={password}
        error={loginError}
        pending={loginPending}
        onEmail={setEmail}
        onPassword={setPassword}
        onSubmit={signIn}
      />
    );
  }

  return (
    <ApplicationShell
      screen={screen}
      user={user}
      token={token}
      isDevelopmentSession={!user && devBypassEnabled}
      onScreen={setScreen}
      onSignOut={user ? signOut : () => setPreviewDismissed(true)}
    />
  );
}

function LoginScreen(props: {
  email: string;
  password: string;
  error: string;
  pending: boolean;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <main className="login-page">
      <form className="login-card" onSubmit={props.onSubmit}>
        <div className="brand-mark">G</div>
        <p className="eyebrow">GODAVARI BASIN MONITORING</p>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to view river conditions and alerts.</p>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            value={props.email}
            onChange={(event) => props.onEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={props.password}
            onChange={(event) => props.onPassword(event.target.value)}
          />
        </label>
        {props.error && <p className="error-message" role="alert">{props.error}</p>}
        <button className="primary-button full-width" type="submit" disabled={props.pending}>
          {props.pending ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="login-footnote">Godavari basin · Flood monitoring system</p>
      </form>
    </main>
  );
}

function ApplicationShell(props: {
  screen: Screen;
  user: AuthUser | null;
  token: string | null;
  isDevelopmentSession: boolean;
  onScreen: (screen: Screen) => void;
  onSignOut: () => void;
}) {
  const title = props.screen === 'dashboard'
    ? 'Dashboard'
    : props.screen === 'monitoring'
      ? 'Flood monitoring'
      : 'Alerts';

  return (
    <div className="app-frame">
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); props.onScreen('dashboard'); }}>
          <span className="brand-mark small">G</span>
          <span>Godavari <b>Flood Monitor</b></span>
        </a>
        <div className="account">
          <span>{props.user?.name ?? 'Development session'}</span>
          <button className="quiet-button" onClick={props.onSignOut}>
            {props.user ? 'Sign out' : 'Exit preview'}
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <p className="eyebrow">WORKSPACE</p>
          <nav aria-label="Main navigation">
            <NavButton active={props.screen === 'dashboard'} onClick={() => props.onScreen('dashboard')}>
              <GridIcon /> Dashboard
            </NavButton>
            <NavButton active={props.screen === 'monitoring'} onClick={() => props.onScreen('monitoring')}>
              <WaterIcon /> Flood monitoring
            </NavButton>
            <NavButton active={props.screen === 'alerts'} onClick={() => props.onScreen('alerts')}>
              <BellIcon /> Alerts
            </NavButton>
          </nav>
          <div className="sidebar-note">
            <span className="live-dot" /> Live backend data
          </div>
        </aside>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">GODAVARI FLOOD MANAGEMENT</p>
              <h1>{title}</h1>
            </div>
            {props.user && <span className="role-pill">{props.user.role}</span>}
          </div>
          {props.isDevelopmentSession && (
            <div className="development-banner" role="status">
              Preview mode is enabled. Alert write actions need a real signed-in account.
            </div>
          )}
          {props.screen === 'dashboard' && <Dashboard />}
          {props.screen === 'monitoring' && <Monitoring />}
          {props.screen === 'alerts' && (
            <Alerts token={props.token} isAdmin={props.user?.role.toLowerCase() === 'admin'} />
          )}
        </main>
      </div>
    </div>
  );
}

function NavButton(props: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`nav-button${props.active ? ' active' : ''}`} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [cumulativeRisk, setCumulativeRisk] = useState<CumulativeRiskResult | null>(null);
  const [regionalImpact, setRegionalImpact] = useState<RegionalImpactResult | null>(null);
  const [activeProjectAlerts, setActiveProjectAlerts] = useState<ActiveProjectAlert[]>([]);
  const [persistedPredictions, setPersistedPredictions] = useState<PersistedPrediction[]>([]);
  const [error, setError] = useState('');
  const [intelligenceError, setIntelligenceError] = useState('');
  const [pending, setPending] = useState(true);

  const load = useCallback(async () => {
    setPending(true);
    setError('');
    setIntelligenceError('');
    const results = await Promise.allSettled([
      api.dashboard(),
      api.stations(),
      api.cumulativeRisk(),
      api.regionalImpact(),
      api.activeAlerts(),
      api.persistedPredictions(),
    ]);
    const [dashboard, stationResult, risk, regional, alerts, predictions] = results;
    if (dashboard.status === 'fulfilled') setStats(dashboard.value);
    else setError(dashboard.reason instanceof ApiError ? dashboard.reason.message : 'Could not load dashboard data.');
    if (stationResult.status === 'fulfilled') setStations(stationResult.value.data);
    if (risk.status === 'fulfilled') setCumulativeRisk(risk.value);
    if (regional.status === 'fulfilled') setRegionalImpact(regional.value);
    if (alerts.status === 'fulfilled') setActiveProjectAlerts(alerts.value.data);
    if (predictions.status === 'fulfilled') setPersistedPredictions(predictions.value.data);
    if (results.slice(1).some((result) => result.status === 'rejected')) {
      setIntelligenceError('Unable to load some current monitoring data. Displayed evidence may be incomplete.');
    }
    setPending(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <section>
      <div className="intro-card">
        <div className="intro-symbol"><WaterIcon /></div>
        <div>
          <h2>Godavari basin monitoring</h2>
          <p>Current overview from the flood monitoring dataset.</p>
        </div>
        <button className="icon-button" aria-label="Refresh dashboard" onClick={() => void load()} disabled={pending}>
          ↻
        </button>
      </div>
      {error && <ErrorNotice message={error} onRetry={() => void load()} />}
      {pending && !stats ? (
        <Loading />
      ) : stats ? (
        <>
          <div className="stats-grid">
            <StatCard label="Flood records" value={formatInteger(stats.total_records)} icon="▤" accent="teal" />
            <StatCard label="Monitoring stations" value={formatInteger(stats.station_count)} icon="⌖" accent="blue" />
            <StatCard label="Latest date" value={formatDate(stats.latest_date)} icon="▦" accent="amber" />
            <StatCard label="Latest water level" value={formatValue(stats.latest_waterlevel)} icon="↓" accent="teal" />
            <StatCard label="Latest discharge" value={formatValue(stats.latest_discharge)} icon="≈" accent="blue" />
            <StatCard label="Latest rainfall" value={formatValue(stats.latest_rainfall)} icon="☂" accent="amber" />
            <StatCard
              label="Current risk level"
              value={stats.latest_risk_level ?? '—'}
              icon="◇"
              accent={riskAccent(stats.latest_risk_level)}
              caption="Academic rule-based estimate"
            />
          </div>
          <p className="disclaimer">
            Risk levels are academic estimates and are not official government warnings.
          </p>
        </>
      ) : !error ? <EmptyState message="No dashboard data is available." /> : null}
      {intelligenceError && <ErrorNotice message={intelligenceError} onRetry={() => void load()} />}
      {pending ? null : (
        <MonitoringIntelligence
          stations={stations}
          persistedPredictions={persistedPredictions}
          cumulativeRisk={cumulativeRisk}
          regionalImpact={regionalImpact}
          activeAlerts={activeProjectAlerts}
        />
      )}
    </section>
  );
}

function StatCard(props: { label: string; value: string; icon: string; accent: string; caption?: string }) {
  return (
    <article className="stat-card">
      <div className={`stat-icon ${props.accent}`}>{props.icon}</div>
      <p className="stat-label">{props.label}</p>
      <p className="stat-value">{props.value}</p>
      {props.caption && <p className="stat-caption">{props.caption}</p>}
    </article>
  );
}

function Monitoring() {
  const requestId = useRef(0);
  const [stations, setStations] = useState<Station[]>([]);
  const [records, setRecords] = useState<FloodRecord[]>([]);
  const [stationId, setStationId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(true);
  const [morePending, setMorePending] = useState(false);
  const [predictionState, setPredictionState] = useState<{
    key: string;
    result: PersistedPrediction | null;
    error: string;
  } | null>(null);
  const [cumulativeRisk, setCumulativeRisk] = useState<CumulativeRiskResult | null>(null);
  const [regionalImpact, setRegionalImpact] = useState<RegionalImpactResult | null>(null);
  const [activeProjectAlerts, setActiveProjectAlerts] = useState<ActiveProjectAlert[]>([]);
  const [intelligenceError, setIntelligenceError] = useState('');
  const [intelligencePending, setIntelligencePending] = useState(true);
  const [persistedPredictions, setPersistedPredictions] = useState<PersistedPrediction[]>([]);

  const loadIntelligence = useCallback(async () => {
    setIntelligencePending(true);
    setIntelligenceError('');
    try {
      const [risk, regional, alerts, predictions] = await Promise.all([
        api.cumulativeRisk(),
        api.regionalImpact(),
        api.activeAlerts(),
        api.persistedPredictions(),
      ]);
      setCumulativeRisk(risk);
      setRegionalImpact(regional);
      setActiveProjectAlerts(alerts.data);
      setPersistedPredictions(predictions.data);
      setIntelligencePending(false);
    } catch (cause) {
      setIntelligenceError(
        cause instanceof ApiError ? cause.message : 'Unable to load current monitoring data.',
      );
      setIntelligencePending(false);
    }
  }, []);

  useEffect(() => {
    api.stations()
      .then((result) => setStations(result.data))
      .catch((cause) => setError(cause instanceof ApiError ? cause.message : 'Could not load stations.'));
    Promise.all([
      api.cumulativeRisk(),
      api.regionalImpact(),
      api.activeAlerts(),
      api.persistedPredictions(),
    ])
      .then(([risk, regional, alerts, predictions]) => {
        setCumulativeRisk(risk);
        setRegionalImpact(regional);
        setActiveProjectAlerts(alerts.data);
        setPersistedPredictions(predictions.data);
        setIntelligencePending(false);
        setIntelligenceError('');
      })
      .catch((cause) => {
        setIntelligenceError(
          cause instanceof ApiError ? cause.message : 'Unable to load current monitoring data.',
        );
        setIntelligencePending(false);
      });
  }, []);

  const loadRecords = useCallback(async (
    nextPage: number,
    append: boolean,
  ) => {
    const thisRequestId = ++requestId.current;
    if (append) setMorePending(true);
    else setPending(true);
    setError('');
    try {
      const result = await api.floodData({
        station_id: stationId || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        page: nextPage,
        limit: 20,
      });
      if (thisRequestId !== requestId.current) return;
      setRecords((current) => append ? [...current, ...result.data] : result.data);
      setPage(result.pagination.page);
      setTotal(result.pagination.total);
      setTotalPages(result.pagination.total_pages);
      setError('');
    } catch (cause) {
      if (thisRequestId !== requestId.current) return;
      setError(cause instanceof ApiError ? cause.message : 'Could not load flood records.');
    } finally {
      if (thisRequestId === requestId.current) {
        setPending(false);
        setMorePending(false);
      }
    }
  }, [stationId, startDate, endDate]);

  useEffect(() => {
    const thisRequestId = ++requestId.current;
    let active = true;
    api.floodData({
      station_id: stationId || undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      page: 1,
      limit: 20,
    })
      .then((result) => {
        if (!active || thisRequestId !== requestId.current) return;
        setRecords(result.data);
        setPage(result.pagination.page);
        setTotal(result.pagination.total);
        setTotalPages(result.pagination.total_pages);
        setError('');
      })
      .catch((cause) => {
        if (active && thisRequestId === requestId.current) {
          setError(cause instanceof ApiError ? cause.message : 'Could not load flood records.');
        }
      })
      .finally(() => {
        if (active && thisRequestId === requestId.current) setPending(false);
      });
    return () => { active = false; };
  }, [stationId, startDate, endDate]);

  useEffect(() => {
    let active = true;
    if (!stationId) return () => { active = false; };
    const key = JSON.stringify([stationId, endDate]);
    api.persistedPredictions(stationId)
      .then((result) => {
        const selected = result.data.find((row) =>
          endDate ? row.feature_date === endDate : true,
        ) ?? null;
        if (active) setPredictionState({ key, result: selected, error: '' });
      })
      .catch((cause) => {
        if (active) {
          setPredictionState({
            key,
            result: null,
            error: cause instanceof ApiError
              ? cause.message
              : 'Could not load the ML prediction.',
          });
        }
      });
    return () => { active = false; };
  }, [stationId, endDate]);

  const predictionKey = JSON.stringify([stationId, endDate]);
  const activePrediction = predictionState?.key === predictionKey ? predictionState : null;

  const stationOptions = useMemo(() => stations.map((station) => (
    <option value={station.station_id} key={`${station.station_id}-${station.station_name}`}>
      {station.station_name || station.station_id} · {station.station_id}
    </option>
  )), [stations]);

  return (
    <section>
      <div className="section-lead">
        <div>
          <h2>Flood records</h2>
          <p>Browse readings with station and date filters.</p>
        </div>
        <button
          className="quiet-button"
          onClick={() => {
            void loadRecords(1, false);
            void loadIntelligence();
          }}
          disabled={pending || intelligencePending}
        >
          Refresh persisted data
        </button>
      </div>
      {intelligencePending ? (
        <div className="intelligence-loading">Loading persisted cumulative monitoring data…</div>
      ) : intelligenceError ? (
        <div className="error-notice" role="alert">
          <span>Unable to load current monitoring data.</span>
          <button onClick={() => void loadIntelligence()}>Try again</button>
        </div>
      ) : (
        <MonitoringIntelligence
          stations={stations}
          persistedPredictions={persistedPredictions}
          cumulativeRisk={cumulativeRisk}
          regionalImpact={regionalImpact}
          activeAlerts={activeProjectAlerts}
        />
      )}
      <div className="filter-bar">
        <label>
          Station
          <select
            value={stationId}
            onChange={(event) => {
              setPending(true);
              setError('');
              setStationId(event.target.value);
            }}
          >
            <option value="">All stations</option>
            {stationOptions}
          </select>
        </label>
        <label>
          Start date
          <input
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(event) => {
              setPending(true);
              setError('');
              setStartDate(event.target.value);
            }}
          />
        </label>
        <label>
          End date
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(event) => {
              setPending(true);
              setError('');
              setEndDate(event.target.value);
            }}
          />
        </label>
        <button
          className="quiet-button clear-button"
          onClick={() => {
            setPending(true);
            setError('');
            setStationId('');
            setStartDate('');
            setEndDate('');
          }}
        >
          Clear filters
        </button>
      </div>
      <NextDayPredictionPanel
        stationId={stationId}
        prediction={activePrediction?.result ?? null}
        error={activePrediction?.error ?? ''}
        pending={Boolean(stationId) && activePrediction === null}
        usesEndDate={Boolean(endDate)}
      />
      {error && <ErrorNotice message={error} onRetry={() => void loadRecords(1, false)} />}
      {pending ? <Loading /> : records.length === 0 ? (
        <EmptyState message={error ? 'Flood records could not be loaded.' : 'No records match these filters.'} />
      ) : (
        <>
          <div className="record-table-wrap">
            <table className="record-table">
              <thead>
                <tr>
                  <th>Date</th><th>Station</th><th>Water level</th>
                  <th>Discharge</th><th>Rainfall</th><th>Existing rule-based risk</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>{formatDate(record.date)}</td>
                    <td>
                      <strong>{record.station_name || 'Station'}</strong>
                      <span className="table-subtitle">{record.station_id}</span>
                    </td>
                    <td>{formatValue(record.waterlevel)}</td>
                    <td>{formatValue(record.discharge)}</td>
                    <td>{formatValue(record.rain)}</td>
                    <td><RiskBadge level={record.risk_level} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span>Showing {records.length} of {formatInteger(total)} records</span>
            {page < totalPages && (
              <button
                className="primary-button"
                disabled={morePending}
                onClick={() => void loadRecords(page + 1, true)}
              >
                {morePending ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function MonitoringIntelligence(props: {
  stations: Station[];
  persistedPredictions: PersistedPrediction[];
  cumulativeRisk: CumulativeRiskResult | null;
  regionalImpact: RegionalImpactResult | null;
  activeAlerts: ActiveProjectAlert[];
}) {
  const [selectedStation, setSelectedStation] = useState<import('@/components/godavari-risk-map').MapStation | null>(null);
  const risk = props.cumulativeRisk;
  const regional = props.regionalImpact;
  const alert = props.activeAlerts[0] ?? null;
  const predictionByStation = new Map(
    props.persistedPredictions.map((prediction) => [prediction.station_id, prediction]),
  );
  const mapStations = props.stations
    .map((station) => {
      const prediction = predictionByStation.get(station.station_id);
      return {
        station_id: station.station_id,
        station_name: station.station_name,
        canonical_station_name: station.canonical_station_name,
        state: station.state ?? null,
        district: station.district ?? null,
        river: station.river ?? null,
        tributary: station.tributary ?? null,
        sub_basin: station.sub_basin ?? null,
        latitude: station.latitude ?? null,
        longitude: station.longitude ?? null,
        predicted_class: prediction?.predicted_class ?? null,
        probability_low: prediction?.probability_low ?? null,
        probability_moderate: prediction?.probability_moderate ?? null,
        probability_high: prediction?.probability_high ?? null,
        confidence: prediction?.confidence ?? null,
        feature_date: prediction?.feature_date ?? null,
        target_date: prediction?.target_date ?? null,
        prediction_status: prediction?.prediction_status ?? 'INSUFFICIENT_HISTORY',
      } as import('@/components/godavari-risk-map').MapStation;
    });

  return (
    <section className="intelligence-grid">
      <div className="intelligence-summary">
        <div>
          <p className="eyebrow">CUMULATIVE PROJECT RISK</p>
          <h3>{risk?.risk_level ?? 'INSUFFICIENT_EVIDENCE'}</h3>
        </div>
        <div className="risk-index">
          <strong>{risk ? risk.risk_score.toFixed(1) : '—'}</strong>
          <span>/ 100 project risk index</span>
        </div>
        <dl>
          <div><dt>Feature date</dt><dd>{formatDate(risk?.feature_date ?? null)}</dd></div>
          <div><dt>Target date</dt><dd>{formatDate(risk?.target_date ?? null)}</dd></div>
          <div><dt>Uncertainty</dt><dd>{risk?.uncertainty.level ?? 'UNKNOWN'}</dd></div>
          <div>
            <dt>Station coverage</dt>
            <dd>{risk ? `${risk.predicted_station_count} / ${risk.station_count}` : '—'}</dd>
          </div>
        </dl>
      </div>
      <div className="alert-summary">
        {alert ? (
          <>
            <p className="eyebrow">PROJECT EARLY WARNING</p>
            <h3>{alert.severity}</h3>
            <p>{alert.headline}</p>
            <span>Lifecycle: {alert.lifecycle_state}</span>
            <span>Target: {formatDate(alert.target_date)}</span>
          </>
        ) : (
          <>
            <p className="eyebrow">PROJECT EARLY WARNING</p>
            <h3>NO ACTIVE ALERT</h3>
            <p>No active project early-warning alert.</p>
          </>
        )}
      </div>

      <div className="gis-panel">
        <GodavariRiskMap
          stations={mapStations}
          affectedStates={regional?.potentially_affected_states ?? []}
          affectedDistricts={regional?.potentially_affected_districts ?? []}
          alertSeverity={alert?.severity ?? null}
          alertTitle={alert?.headline ?? null}
          onSelectStation={setSelectedStation}
        />
      </div>

      {selectedStation && (
        <aside className="selected-station-card" aria-label="Selected station details">
          <button
            type="button"
            aria-label="Close selected station details"
            onClick={() => setSelectedStation(null)}
          >
            ×
          </button>
          <p className="eyebrow">SELECTED STATION</p>
          <h3>{selectedStation.canonical_station_name || selectedStation.station_name}</h3>
          <p>Station ID: {selectedStation.station_id}</p>
          <p>{selectedStation.state ?? 'State unavailable'} · {selectedStation.district ?? 'District unavailable'}</p>
          <p>{selectedStation.tributary ? `Godavari / ${selectedStation.tributary}` : 'River system unavailable'}</p>
          {selectedStation.prediction_status === 'PREDICTED' ? (
            <>
              <RiskBadge level={selectedStation.predicted_class ?? 'UNKNOWN'} />
              <div className="probability-grid">
                <span>LOW <strong>{formatProbability(selectedStation.probability_low)}</strong></span>
                <span>MODERATE <strong>{formatProbability(selectedStation.probability_moderate)}</strong></span>
                <span>HIGH <strong>{formatProbability(selectedStation.probability_high)}</strong></span>
              </div>
              <p>Model confidence: {formatProbability(selectedStation.confidence)}</p>
            </>
          ) : (
            <p>Prediction status: {selectedStation.prediction_status.replace(/_/g, ' ')}</p>
          )}
          <p>Feature: {formatDate(selectedStation.feature_date)} · Target: {formatDate(selectedStation.target_date)}</p>
        </aside>
      )}

      <section className="station-evidence" aria-label="Station prediction evidence">
        <div>
          <h3>Station predictions</h3>
          <p>Select a station for persisted prediction details.</p>
        </div>
        <div className="station-evidence-list">
          {mapStations.map((station) => (
            <button
              type="button"
              key={station.station_id}
              className="station-evidence-button"
              aria-pressed={selectedStation?.station_id === station.station_id}
              onClick={() => setSelectedStation(station)}
            >
              <span>{station.canonical_station_name || station.station_name || station.station_id}</span>
              <RiskBadge level={station.prediction_status === 'PREDICTED'
                ? station.predicted_class ?? 'UNKNOWN'
                : 'INSUFFICIENT / UNKNOWN'} />
            </button>
          ))}
        </div>
      </section>

      <div className="regional-evidence">
        <h3>Affected regions</h3>
        {!regional?.state_impact_evidence.length && (
          <p>No elevated regional evidence currently detected.</p>
        )}
        {regional?.state_impact_evidence.map((state) => (
          <article key={state.state}>
            <strong>{state.state}</strong>
            <RiskBadge level={state.impact_level} />
            <span>{state.coverage * 100}% station coverage · {state.uncertainty} uncertainty</span>
            <span>Stations: {state.supporting_stations.join(', ') || 'No elevated supporting stations'}</span>
            <span>Systems: {state.supporting_river_systems.join(', ') || 'No elevated supporting systems'}</span>
          </article>
        ))}
        {regional?.district_impact_evidence
          .filter((district) => district.impact_level !== 'NO_ELEVATED_EVIDENCE')
          .map((district) => (
            <article key={`${district.state}-${district.district}`}>
              <strong>{district.district}</strong>
              <span>{district.state}</span>
              <RiskBadge level={district.impact_level} />
              <span>{district.coverage * 100}% coverage · {district.uncertainty} uncertainty</span>
              <span>Stations: {district.supporting_stations.join(', ') || 'No supporting stations'}</span>
              <span>Systems: {district.supporting_river_systems.join(', ') || 'No supporting systems'}</span>
            </article>
          ))}
      </div>

      <div className="hydrology-context">
        <h3>Hydrological context</h3>
        <p>
          Stations are grouped using verified river-system metadata. The current verified graph has no directional
          station relationships, so this dashboard does not infer flow paths or draw river connections.
        </p>
      </div>

      {alert && (
        <div className="active-alert-detail">
          <h3>Active project early-warning evidence</h3>
          <p>{alert.message}</p>
          <dl>
            <div><dt>Feature date</dt><dd>{formatDate(alert.feature_date)}</dd></div>
            <div><dt>Target date</dt><dd>{formatDate(alert.target_date)}</dd></div>
            <div><dt>Coverage</dt><dd>{alert.coverage === null ? '—' : `${(alert.coverage * 100).toFixed(0)}%`}</dd></div>
            <div><dt>Uncertainty</dt><dd>{alert.uncertainty}</dd></div>
            <div><dt>Affected states</dt><dd>{alert.affected_states.join(', ') || 'None specified'}</dd></div>
            <div><dt>Affected districts</dt><dd>{alert.affected_districts.join(', ') || 'None specified'}</dd></div>
            <div><dt>Supporting stations</dt><dd>{alert.supporting_stations.join(', ') || 'None specified'}</dd></div>
            <div><dt>River systems</dt><dd>{alert.supporting_systems.join(', ') || 'None specified'}</dd></div>
            <div><dt>Generated</dt><dd>{formatTimestamp(alert.created_at)}</dd></div>
          </dl>
          {alert.recommended_action && <p><strong>Recommended action:</strong> {alert.recommended_action}</p>}
          <p>{alert.disclaimer}</p>
        </div>
      )}

      <div className="coverage-panel">
        <h3>Geographic coverage</h3>
        <strong>{regional?.basin_geographic_coverage.geographic_coverage_status ?? 'PARTIAL'}</strong>
        <p>
          {regional?.basin_geographic_coverage.represented_state_count ?? 0} represented states
        </p>
        <p>
          No station-level model evidence currently available in:{' '}
          {regional?.basin_geographic_coverage.unrepresented_basin_states.join(', ') ?? '—'}
        </p>
      </div>

      <div className="official-disclaimer">
        <strong>PROJECT EARLY WARNING</strong>
        <p>
          This is an experimental academic/project early-warning system. It is not an official
          flood warning. Follow official CWC, NDMA/SACHET and state disaster-management advisories.
        </p>
      </div>
    </section>
  );
}

function NextDayPredictionPanel(props: {
  stationId: string;
  prediction: PersistedPrediction | null;
  error: string;
  pending: boolean;
  usesEndDate: boolean;
}) {
  const result = props.prediction;
  return (
    <section className="prediction-card" aria-live="polite">
      <div className="prediction-heading">
        <div>
          <p className="eyebrow">ADDITIONAL MODEL OUTPUT</p>
          <h3>Next-Day ML Prediction</h3>
          <p className="muted">
            Separate from existing rule-based risk; predicts T+1 using history through the feature date.
          </p>
        </div>
        {result?.prediction_status === 'PREDICTED' && result.predicted_class && (
          <RiskBadge level={result.predicted_class} />
        )}
      </div>
      {!props.stationId ? (
        <p className="prediction-message">Select a station to request a prediction.</p>
      ) : props.pending ? (
        <p className="prediction-message">Loading prediction…</p>
      ) : props.error ? (
        <p className="prediction-message error-message" role="alert">{props.error}</p>
      ) : result ? (
        <>
          <div className="prediction-facts">
            <div>
              <span>Station</span>
              <strong>{result.canonical_station_name || result.dataset_station_name || result.station_id}</strong>
            </div>
            <div><span>Feature date</span><strong>{formatDate(result.feature_date)}</strong></div>
            <div><span>Target date (T+1)</span><strong>{formatDate(result.target_date)}</strong></div>
            <div>
              <span>Status</span>
              <strong>{result.prediction_status.replace(/_/g, ' ')}</strong>
            </div>
            <div>
              <span>Model confidence (max softmax probability)</span>
              <strong>
                {result.confidence === null
                  ? '—'
                  : `${(result.confidence * 100).toFixed(1)}%`}
              </strong>
            </div>
          </div>
          {result.prediction_status === 'PREDICTED' && (
            <div className="prediction-probabilities">
              <span>LOW <strong>{formatProbability(result.probability_low)}</strong></span>
              <span>MODERATE <strong>{formatProbability(result.probability_moderate)}</strong></span>
              <span>HIGH <strong>{formatProbability(result.probability_high)}</strong></span>
            </div>
          )}
          {result.status_reason && <p className="prediction-reason">{result.status_reason}</p>}
          <p className="prediction-disclaimer">
            {props.usesEndDate
              ? 'Uses the selected end date as the feature date.'
              : 'Uses the latest available observation as the feature date.'}
            {' '}Academic model output only; not an official flood warning.
          </p>
        </>
      ) : (
        <p className="prediction-message">No prediction result is available.</p>
      )}
    </section>
  );
}

function Alerts(props: { token: string | null; isAdmin: boolean }) {
  const [alerts, setAlerts] = useState<FloodAlert[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setPending(true);
    setError('');
    try {
      const response = await api.alerts();
      setAlerts(response.data);
      setError('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not load alerts.');
    } finally {
      setPending(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    api.alerts()
      .then((result) => {
        if (active) {
          setAlerts(result.data);
          setError('');
        }
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof ApiError ? cause.message : 'Could not load alerts.');
        }
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => { active = false; };
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!props.token) {
      setError('Sign in with an admin account before creating alerts.');
      return;
    }
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    try {
      const alert = await api.createAlert(props.token, {
        title: String(form.get('title') ?? ''),
        message: String(form.get('message') ?? ''),
        risk_level: String(form.get('risk_level') ?? 'LOW'),
        station_name: String(form.get('station_name') ?? '').trim() || null,
      });
      setAlerts((current) => [alert, ...current]);
      setShowForm(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not create alert.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(alert: FloodAlert) {
    if (!props.token || !window.confirm(`Delete “${alert.title}”?`)) return;
    setSaving(true);
    setError('');
    try {
      await api.deleteAlert(props.token, alert.id);
      setAlerts((current) => current.filter((item) => item.id !== alert.id));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not delete alert.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="section-lead">
        <div>
          <h2>Published alerts</h2>
          <p>Flood notifications from the monitoring team.</p>
        </div>
        {props.isAdmin && props.token && (
          <button className="primary-button" onClick={() => setShowForm((value) => !value)}>
            {showForm ? 'Cancel' : '+ Create alert'}
          </button>
        )}
      </div>
      {!props.isAdmin && (
        <p className="muted permission-note">Alert creation and deletion are available to admin users.</p>
      )}
      {showForm && (
        <form className="alert-form" onSubmit={create}>
          <label>Title<input name="title" required maxLength={150} /></label>
          <label>Message<textarea name="message" rows={3} required /></label>
          <div className="form-row">
            <label>
              Risk level
              <select name="risk_level" defaultValue="MODERATE">
                <option>LOW</option><option>MODERATE</option><option>HIGH</option>
              </select>
            </label>
            <label>Station (optional)<input name="station_name" maxLength={100} /></label>
          </div>
          <button className="primary-button" disabled={saving}>{saving ? 'Publishing…' : 'Publish alert'}</button>
        </form>
      )}
      {error && <ErrorNotice message={error} onRetry={() => void load()} />}
      {pending ? <Loading /> : alerts.length === 0 ? (
        <EmptyState message={error ? 'Alerts could not be loaded.' : 'No alerts have been published.'} />
      ) : (
        <div className="alert-list">
          {alerts.map((alert) => (
            <article className="alert-card" key={alert.id}>
              <div className="alert-card-heading">
                <h3>{alert.title}</h3>
                <RiskBadge level={alert.risk_level} />
                {props.isAdmin && props.token && (
                  <button className="delete-button" disabled={saving} onClick={() => void remove(alert)}>
                    Delete
                  </button>
                )}
              </div>
              {alert.station_name && <p className="alert-station">⌖ {alert.station_name}</p>}
              <p className="alert-message">{alert.message}</p>
              <time className="muted">{formatTimestamp(alert.created_at)}</time>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function RiskBadge(props: { level: Risk | string | null }) {
  const normalized = props.level?.toUpperCase() ?? 'LOW';
  return <span className={`risk-badge ${normalized.toLowerCase()}`}>{normalized}</span>;
}

function Loading() {
  return <div className="loading-state"><span className="spinner" /> Loading live data…</div>;
}

function EmptyState(props: { message: string }) {
  return <div className="empty-state"><span>⌕</span><p>{props.message}</p></div>;
}

function ErrorNotice(props: { message: string; onRetry: () => void }) {
  return (
    <div className="error-notice" role="alert">
      <span>{props.message}</span>
      <button onClick={props.onRetry}>Try again</button>
    </div>
  );
}

function GridIcon() { return <span className="nav-icon">▦</span>; }
function WaterIcon() { return <span className="nav-icon">≈</span>; }
function BellIcon() { return <span className="nav-icon">♧</span>; }

function formatInteger(value: number) {
  return new Intl.NumberFormat('en').format(value);
}
function formatValue(value: number | null) {
  return value === null ? '—' : value.toFixed(2);
}
function formatProbability(value: number | null) {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}
function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: '2-digit' }).format(date);
}
function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function riskAccent(risk: Risk | null) {
  if (risk === 'HIGH') return 'red';
  if (risk === 'MODERATE') return 'amber';
  return 'green';
}
