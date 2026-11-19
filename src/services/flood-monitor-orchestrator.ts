import 'server-only';

import { pool } from '@/lib/db';
import { MODEL_VERSION, runStationPredictionOrchestration } from './prediction-orchestrator';
import { getCumulativeEvidence } from './cumulative-risk-engine';
import { getRegionalImpact } from './regional-impact-engine';
import { evaluateAlertState, type ExistingAlertState, type AlertSeverity } from './alert-engine';

export interface AutomaticRunResult {
  run_id: number | null;
  feature_date: string;
  target_date: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  prediction_summary: unknown;
  cumulative_risk: unknown;
  regional_impact: unknown;
  alert_decision: unknown;
  alert_transition: unknown;
  error_summary: string | null;
}

const STALE_RUN_TIMEOUT_MINUTES = 60;

function isoDate(value: unknown): string {
  return String(value).slice(0, 10);
}

function nextDate(featureDate: string): string {
  const date = new Date(`${featureDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function discoverLatestFeatureDate(): Promise<string> {
  const [rows] = await pool.execute(
    'SELECT MAX(`date`) AS latest_date FROM flood_data',
  );
  const latest = (rows as Array<{ latest_date: string | null }>)[0]?.latest_date;
  if (!latest) throw new Error('No observation data exists.');
  return isoDate(latest);
}

async function claimRun(featureDate: string, targetDate: string):
  Promise<{ runId: number | null; existingCompleted: boolean }> {
  const [existingRows] = await pool.execute(
    `SELECT run_id, status,
      TIMESTAMPDIFF(MINUTE, started_at, CURRENT_TIMESTAMP) >= ? AS is_stale
     FROM prediction_runs
     WHERE feature_date = ? AND model_version = ?
     ORDER BY run_id DESC
     LIMIT 1`,
    [STALE_RUN_TIMEOUT_MINUTES, featureDate, MODEL_VERSION],
  );
  const existing = (existingRows as Array<{
    run_id: number;
    status: string;
    is_stale: number | string;
  }>)[0];
  if (existing?.status === 'COMPLETED') {
    return { runId: existing.run_id, existingCompleted: true };
  }
  if (existing?.status === 'RUNNING') {
    if (Number(existing.is_stale) === 1) {
      const [recoveryResult] = await pool.execute(
        `UPDATE prediction_runs
         SET started_at = CURRENT_TIMESTAMP,
           completed_at = NULL,
           status = 'RUNNING',
           successful_prediction_count = 0,
           insufficient_history_count = 0,
           failure_count = 0,
           error_summary = 'Recovered an interrupted stale run before retrying.'
         WHERE run_id = ?
           AND status = 'RUNNING'
           AND TIMESTAMPDIFF(MINUTE, started_at, CURRENT_TIMESTAMP) >= ?`,
        [existing.run_id, STALE_RUN_TIMEOUT_MINUTES],
      );
      if ((recoveryResult as { affectedRows: number }).affectedRows === 1) {
        return { runId: existing.run_id, existingCompleted: false };
      }
    }
    return { runId: null, existingCompleted: false };
  }

  try {
    const [insertResult] = await pool.execute(
      `INSERT INTO prediction_runs (
        feature_date, target_date, status, model_version,
        configured_station_count
      ) VALUES (?, ?, 'RUNNING', ?, 15)`,
      [featureDate, targetDate, MODEL_VERSION],
    );
    return {
      runId: (insertResult as { insertId: number }).insertId,
      existingCompleted: false,
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ER_DUP_ENTRY') {
      return { runId: null, existingCompleted: false };
    }
    throw error;
  }
}

async function loadExistingAlert(
  alertIdentity: string,
): Promise<ExistingAlertState | null> {
  const [rows] = await pool.execute(
    `SELECT alert_identity, lifecycle_state, severity, feature_date, target_date,
      affected_states, affected_districts, supporting_systems, resolved_at
     FROM project_alert_events
     WHERE alert_identity = ?
     LIMIT 1`,
    [alertIdentity],
  );
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) return null;
  const jsonArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((item) => String(item)) : [];
  return {
    alert_identity: String(row.alert_identity),
    lifecycle_state: String(row.lifecycle_state) as ExistingAlertState['lifecycle_state'],
    severity: String(row.severity) as AlertSeverity,
    feature_date: isoDate(row.feature_date),
    target_date: isoDate(row.target_date),
    states: jsonArray(row.affected_states),
    districts: jsonArray(row.affected_districts),
    systems: jsonArray(row.supporting_systems),
    resolved_at: row.resolved_at ? String(row.resolved_at) : null,
  };
}

async function expireStaleAlerts(featureDate: string, runId: number): Promise<void> {
  await pool.execute(
    `UPDATE project_alert_events
     SET lifecycle_state = 'RESOLVED',
       resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
       updated_at = CURRENT_TIMESTAMP
     WHERE lifecycle_state NOT IN ('RESOLVED', 'SUPPRESSED')
       AND target_date < ?`,
    [featureDate],
  );

  await pool.execute(
    `INSERT INTO project_alert_transitions (
      alert_id, run_id, previous_state, new_state,
      previous_severity, new_severity, feature_date, target_date, reason
    )
    SELECT alert_id, ?, lifecycle_state, 'RESOLVED',
      severity, severity, ?, target_date,
      'Target date passed and no newer alert evidence remains.'
    FROM project_alert_events
    WHERE lifecycle_state = 'RESOLVED'
      AND target_date < ?
      AND updated_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 SECOND)`,
    [runId, featureDate, featureDate],
  );
}

export async function runFloodMonitorAutomatically(): Promise<AutomaticRunResult> {
  const featureDate = await discoverLatestFeatureDate();
  const targetDate = nextDate(featureDate);
  const claim = await claimRun(featureDate, targetDate);

  if (claim.existingCompleted) {
    const [runRows] = await pool.execute(
      `SELECT run_id, cumulative_risk_result, regional_impact_result,
        alert_decision_result, status, error_summary
       FROM prediction_runs
       WHERE run_id = ?`,
      [claim.runId],
    );
    const row = (runRows as Array<Record<string, unknown>>)[0];
    return {
      run_id: claim.runId,
      feature_date: featureDate,
      target_date: targetDate,
      status: 'COMPLETED',
      prediction_summary: { already_processed: true },
      cumulative_risk: row?.cumulative_risk_result ?? null,
      regional_impact: row?.regional_impact_result ?? null,
      alert_decision: row?.alert_decision_result ?? null,
      alert_transition: { state: 'NO_CHANGE' },
      error_summary: typeof row?.error_summary === 'string' ? row.error_summary : null,
    };
  }
  if (claim.runId === null) {
    return {
      run_id: null,
      feature_date: featureDate,
      target_date: targetDate,
      status: 'FAILED',
      prediction_summary: null,
      cumulative_risk: null,
      regional_impact: null,
      alert_decision: null,
      alert_transition: null,
      error_summary: 'Another process is already processing this feature date.',
    };
  }

  const runId = claim.runId;
  let predictionSummary: unknown = null;
  let cumulativeRisk: unknown = null;
  let regionalImpact: unknown = null;
  let alertDecision: unknown = null;
  let alertTransition: unknown = null;
  let runStatus: 'COMPLETED' | 'PARTIAL' | 'FAILED' = 'COMPLETED';
  let errorSummary: string | null = null;

  try {
    predictionSummary = await runStationPredictionOrchestration();
    const predictionRecord = predictionSummary as {
      successfully_predicted_stations: number;
      insufficient_history_stations: number;
      unsupported_error_stations: number;
    };

    const cumulative = await getCumulativeEvidence(featureDate);
    cumulativeRisk = cumulative;
    const regional = await getRegionalImpact(featureDate);
    regionalImpact = regional;

    const [latestAlertRows] = await pool.execute(
      `SELECT alert_identity
       FROM project_alert_events
       WHERE target_date = ? AND lifecycle_state NOT IN ('RESOLVED', 'SUPPRESSED')
       LIMIT 1`,
      [targetDate],
    );
    const alertIdentityRow = (latestAlertRows as Array<{ alert_identity: string }>)[0];
    const existingAlert = alertIdentityRow
      ? await loadExistingAlert(alertIdentityRow.alert_identity)
      : null;

    const decision = evaluateAlertState({
      feature_date: featureDate,
      target_date: targetDate,
      model_version: MODEL_VERSION,
      cumulative_risk: cumulative as NonNullable<typeof cumulative>,
      regional_impact: regional,
      existing_alert: existingAlert,
      consecutive_same_severity: existingAlert ? 1 : 0,
      no_new_support_after_target: false,
    });
    alertDecision = decision;

    if (decision.persist) {
      const supportingStations = JSON.stringify(decision.supporting_stations);
      const supportingSystems = JSON.stringify(decision.supporting_systems);
      const affectedStates = JSON.stringify(decision.affected_states);
      const affectedDistricts = JSON.stringify(decision.affected_districts);
      const supportingEvidence = JSON.stringify({
        cumulative_risk: cumulative,
        regional_impact: regional,
      });
      await pool.execute(
        `INSERT INTO project_alert_events (
          alert_identity, alert_type, lifecycle_state, severity,
          feature_date, target_date, confidence, coverage, uncertainty,
          supporting_stations, supporting_systems, affected_states, affected_districts,
          supporting_evidence, run_id, model_version, headline, message,
          recommended_action, disclaimer
        ) VALUES (?, 'PROJECT_EARLY_WARNING', ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          lifecycle_state = VALUES(lifecycle_state),
          severity = VALUES(severity),
          confidence = VALUES(confidence),
          coverage = VALUES(coverage),
          uncertainty = VALUES(uncertainty),
          supporting_stations = VALUES(supporting_stations),
          supporting_systems = VALUES(supporting_systems),
          affected_states = VALUES(affected_states),
          affected_districts = VALUES(affected_districts),
          supporting_evidence = VALUES(supporting_evidence),
          run_id = VALUES(run_id),
          headline = VALUES(headline),
          message = VALUES(message),
          recommended_action = VALUES(recommended_action),
          disclaimer = VALUES(disclaimer),
          resolved_at = CASE WHEN VALUES(lifecycle_state) = 'RESOLVED'
            THEN COALESCE(resolved_at, CURRENT_TIMESTAMP)
            ELSE NULL END,
          updated_at = CURRENT_TIMESTAMP`,
        [
          decision.alert_identity,
          decision.lifecycle_state,
          decision.severity,
          decision.feature_date,
          decision.target_date,
          decision.model_confidence,
          decision.coverage,
          decision.uncertainty,
          supportingStations,
          supportingSystems,
          affectedStates,
          affectedDistricts,
          supportingEvidence,
          runId,
          MODEL_VERSION,
          decision.headline,
          decision.reason,
          decision.recommended_action,
          decision.disclaimer,
        ],
      );

      const [alertRows] = await pool.execute(
        'SELECT alert_id FROM project_alert_events WHERE alert_identity = ?',
        [decision.alert_identity],
      );
      const alertId = (alertRows as Array<{ alert_id: number }>)[0]?.alert_id;
      if (alertId && decision.lifecycle_state !== 'MAINTAINED') {
        await pool.execute(
          `INSERT INTO project_alert_transitions (
            alert_id, run_id, previous_state, new_state,
            previous_severity, new_severity, feature_date, target_date, reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            alertId,
            runId,
            existingAlert?.lifecycle_state ?? null,
            decision.lifecycle_state,
            existingAlert?.severity ?? null,
            decision.severity,
            decision.feature_date,
            decision.target_date,
            decision.transition_reason,
          ],
        );
        alertTransition = { alert_id: alertId, state: decision.lifecycle_state };
      }
    } else {
      alertTransition = { state: decision.lifecycle_state };
    }

    await expireStaleAlerts(featureDate, runId);
    if (
      predictionRecord.insufficient_history_stations > 0
      || predictionRecord.unsupported_error_stations > 0
    ) {
      runStatus = 'PARTIAL';
    }

    await pool.execute(
      `UPDATE prediction_runs
       SET completed_at = CURRENT_TIMESTAMP,
         status = ?,
         configured_station_count = ?,
         successful_prediction_count = ?,
         insufficient_history_count = ?,
         failure_count = ?,
         cumulative_risk_result = ?,
         regional_impact_result = ?,
         alert_decision_result = ?,
         error_summary = ?
       WHERE run_id = ?`,
      [
        runStatus,
        predictionRecord.successfully_predicted_stations
          + predictionRecord.insufficient_history_stations
          + predictionRecord.unsupported_error_stations,
        predictionRecord.successfully_predicted_stations,
        predictionRecord.insufficient_history_stations,
        predictionRecord.unsupported_error_stations,
        JSON.stringify(cumulativeRisk),
        JSON.stringify(regionalImpact),
        JSON.stringify(alertDecision),
        errorSummary,
        runId,
      ],
    );
  } catch (error) {
    runStatus = 'FAILED';
    errorSummary = error instanceof Error ? error.message : 'Unexpected orchestration failure.';
    await pool.execute(
      `UPDATE prediction_runs
       SET completed_at = CURRENT_TIMESTAMP,
         status = 'FAILED',
         error_summary = ?
       WHERE run_id = ?`,
      [errorSummary, runId],
    );
  }

  return {
    run_id: runId,
    feature_date: featureDate,
    target_date: targetDate,
    status: runStatus,
    prediction_summary: predictionSummary,
    cumulative_risk: cumulativeRisk,
    regional_impact: regionalImpact,
    alert_decision: alertDecision,
    alert_transition: alertTransition,
    error_summary: errorSummary,
  };
}
