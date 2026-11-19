import 'server-only';

import type { CumulativeRiskResult } from './cumulative-risk-engine';
import type { RegionalImpactResult } from './regional-impact-engine';

export type AlertSeverity = 'WATCH' | 'ADVISORY' | 'WARNING' | 'CRITICAL';
export type AlertLifecycleState =
  | 'CREATED'
  | 'UPGRADED'
  | 'MAINTAINED'
  | 'DOWNGRADED'
  | 'RESOLVED'
  | 'SUPPRESSED'
  | 'NO_CHANGE';

export interface ExistingAlertState {
  alert_identity: string;
  lifecycle_state: AlertLifecycleState;
  severity: AlertSeverity;
  feature_date: string;
  target_date: string;
  states: string[];
  districts: string[];
  systems: string[];
  resolved_at: string | null;
}

export interface AlertDecision {
  alert_identity: string;
  lifecycle_state: AlertLifecycleState;
  severity: AlertSeverity | null;
  headline: string;
  reason: string;
  target_date: string;
  feature_date: string;
  supporting_stations: string[];
  supporting_systems: string[];
  affected_states: string[];
  affected_districts: string[];
  uncertainty: 'LOW' | 'MODERATE' | 'HIGH';
  coverage: number;
  model_confidence: number | null;
  recommended_action: string;
  disclaimer: string;
  persist: boolean;
  transition_reason: string;
}

export interface AlertEngineInput {
  feature_date: string;
  target_date: string;
  model_version: string;
  cumulative_risk: CumulativeRiskResult;
  regional_impact: RegionalImpactResult;
  existing_alert: ExistingAlertState | null;
  consecutive_same_severity: number;
  no_new_support_after_target: boolean;
}

export const ALERT_CONFIG = {
  watch_coverage_minimum: 0.75,
  advisory_coverage_minimum: 0.85,
  warning_coverage_minimum: 0.90,
  corroborating_station_count: 2,
  corroborating_system_count: 2,
  high_cumulative_score: 70,
  moderate_cumulative_score: 50,
  isolated_watch_only: true,
  debounce_maintained_runs: 2,
} as const;

const severityRank: Record<AlertSeverity, number> = {
  WATCH: 1,
  ADVISORY: 2,
  WARNING: 3,
  CRITICAL: 4,
};

function averageConfidence(input: AlertEngineInput): number | null {
  const confidences: number[] = [];
  for (const stationId of input.cumulative_risk.cross_station_evidence.supporting_stations) {
    const system = input.cumulative_risk.river_system_evidence.find((item) =>
      item.supporting_stations.includes(stationId),
    );
    if (!system) continue;
    if (system.confidence_summary === 'STRONG') confidences.push(0.90);
    else if (system.confidence_summary === 'MODERATE') confidences.push(0.75);
    else if (system.confidence_summary === 'WEAK') confidences.push(0.50);
  }
  if (confidences.length === 0) return null;
  return confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
}

export function evaluateAlertState(input: AlertEngineInput): AlertDecision {
  const coverage = input.regional_impact.data_quality.coverage;
  const supportingStations = input.regional_impact.supporting_stations;
  const supportingSystems = input.regional_impact.supporting_river_systems;
  const affectedStates = input.regional_impact.potentially_affected_states;
  const affectedDistricts = input.regional_impact.potentially_affected_districts;
  const contradiction =
    input.cumulative_risk.cross_station_evidence.contradicting_stations.length > 0;
  const elevatedSystems = input.cumulative_risk.cross_station_evidence.elevated_system_count;
  const elevatedStations = input.cumulative_risk.cross_station_evidence.elevated_station_count;
  const averageModelConfidence = averageConfidence(input);
  const noDangerousEvidence =
    elevatedStations === 0
    || coverage < ALERT_CONFIG.watch_coverage_minimum
    || input.cumulative_risk.risk_level === 'INSUFFICIENT_EVIDENCE';

  let severity: AlertSeverity | null = null;
  if (noDangerousEvidence) {
    severity = null;
  } else if (
    elevatedStations === 1
    && elevatedSystems === 1
  ) {
    severity = 'WATCH';
  } else if (
    supportingStations.length >= ALERT_CONFIG.corroborating_station_count
    && supportingSystems.length >= ALERT_CONFIG.corroborating_system_count
    && input.cumulative_risk.risk_score >= ALERT_CONFIG.high_cumulative_score
    && coverage >= ALERT_CONFIG.warning_coverage_minimum
    && !contradiction
  ) {
    severity = 'WARNING';
  } else if (
    supportingStations.length >= ALERT_CONFIG.corroborating_station_count
    && elevatedSystems >= ALERT_CONFIG.corroborating_system_count
    && coverage >= ALERT_CONFIG.advisory_coverage_minimum
  ) {
    severity = 'ADVISORY';
  } else if (elevatedStations > 0) {
    severity = 'WATCH';
  }

  if (
    contradiction
    && severity
    && severityRank[severity] > severityRank.WATCH
  ) {
    severity = 'WATCH';
  }

  if (
    input.cumulative_risk.uncertainty.level === 'HIGH'
    && severity
    && severityRank[severity] > severityRank.WATCH
  ) {
    severity = 'WATCH';
  }

  const geographicIdentity = [...affectedStates, ...affectedDistricts, ...supportingSystems]
    .sort()
    .join('|');
  const alertIdentity = `${input.feature_date}|${input.target_date}|${geographicIdentity}`;

  if (input.no_new_support_after_target) {
    if (input.existing_alert) {
      return {
        alert_identity: alertIdentity,
        lifecycle_state: 'RESOLVED',
        severity: null,
        headline: 'Project early-warning alert resolved',
        reason: 'Target date passed and no newer supporting prediction remains.',
        target_date: input.target_date,
        feature_date: input.feature_date,
        supporting_stations: supportingStations,
        supporting_systems: supportingSystems,
        affected_states: affectedStates,
        affected_districts: affectedDistricts,
        uncertainty: input.cumulative_risk.uncertainty.level,
        coverage,
        model_confidence: averageModelConfidence,
        recommended_action:
          'Monitor official CWC/NDMA/state disaster-management advisories.',
        disclaimer:
          'This is a project early-warning signal, not an official government flood warning.',
        persist: true,
        transition_reason: 'Target date expired without newer supporting evidence.',
      };
    }
    return {
      alert_identity: alertIdentity,
      lifecycle_state: 'NO_CHANGE',
      severity: null,
      headline: 'No project alert',
      reason: 'Target date expired and no active alert exists.',
      target_date: input.target_date,
      feature_date: input.feature_date,
      supporting_stations: [],
      supporting_systems: [],
      affected_states: affectedStates,
      affected_districts: affectedDistricts,
      uncertainty: input.cumulative_risk.uncertainty.level,
      coverage,
      model_confidence: averageModelConfidence,
      recommended_action:
        'Monitor official CWC/NDMA/state disaster-management advisories.',
      disclaimer:
        'This is a project early-warning signal, not an official government flood warning.',
      persist: false,
      transition_reason: 'Expired target has no active alert.',
    };
  }

  if (!severity) {
    if (input.existing_alert) {
      return {
        alert_identity: alertIdentity,
        lifecycle_state: 'RESOLVED',
        severity: null,
        headline: 'Project early-warning alert resolved',
        reason: 'Current evidence no longer supports an active project alert.',
        target_date: input.target_date,
        feature_date: input.feature_date,
        supporting_stations: supportingStations,
        supporting_systems: supportingSystems,
        affected_states: affectedStates,
        affected_districts: affectedDistricts,
        uncertainty: input.cumulative_risk.uncertainty.level,
        coverage,
        model_confidence: averageModelConfidence,
        recommended_action:
          'Monitor official CWC/NDMA/state disaster-management advisories.',
        disclaimer:
          'This is a project early-warning signal, not an official government flood warning.',
        persist: true,
        transition_reason: 'The latest evidence no longer supports the active alert.',
      };
    }
    return {
      alert_identity: alertIdentity,
      lifecycle_state: 'NO_CHANGE',
      severity: null,
      headline: 'No project alert',
      reason: 'The evidence does not support an active project alert.',
      target_date: input.target_date,
      feature_date: input.feature_date,
      supporting_stations: [],
      supporting_systems: [],
      affected_states: affectedStates,
      affected_districts: affectedDistricts,
      uncertainty: input.cumulative_risk.uncertainty.level,
      coverage,
      model_confidence: averageModelConfidence,
      recommended_action:
        'Monitor official CWC/NDMA/state disaster-management advisories.',
      disclaimer:
        'This is a project early-warning signal, not an official government flood warning.',
      persist: false,
      transition_reason: 'No active alert and no new supporting evidence.',
    };
  }

  if (!input.existing_alert) {
    return {
      alert_identity: alertIdentity,
      lifecycle_state: 'CREATED',
      severity,
      headline: `Project early-warning alert: ${severity}`,
      reason:
        `${elevatedStations} elevated station(s) across ${elevatedSystems} hydrological system(s); `
        + `coverage is ${Math.round(coverage * 1000) / 10}%.`,
      target_date: input.target_date,
      feature_date: input.feature_date,
      supporting_stations: supportingStations,
      supporting_systems: supportingSystems,
      affected_states: affectedStates,
      affected_districts: affectedDistricts,
      uncertainty: input.cumulative_risk.uncertainty.level,
      coverage,
      model_confidence: averageModelConfidence,
      recommended_action:
        'Monitor official CWC/NDMA/state disaster-management advisories.',
      disclaimer:
        'This is a project early-warning signal, not an official government flood warning.',
      persist: true,
      transition_reason:
        'No active matching alert exists for this feature/target/evidence scope.',
    };
  }

  const oldRank = severityRank[input.existing_alert.severity];
  const newRank = severityRank[severity];
  if (newRank > oldRank) {
    return {
      alert_identity: alertIdentity,
      lifecycle_state: 'UPGRADED',
      severity,
      headline: `Project early-warning alert upgraded: ${severity}`,
      reason: 'Supporting evidence increased to a higher project severity.',
      target_date: input.target_date,
      feature_date: input.feature_date,
      supporting_stations: supportingStations,
      supporting_systems: supportingSystems,
      affected_states: affectedStates,
      affected_districts: affectedDistricts,
      uncertainty: input.cumulative_risk.uncertainty.level,
      coverage,
      model_confidence: averageModelConfidence,
      recommended_action:
        'Monitor official CWC/NDMA/state disaster-management advisories.',
      disclaimer:
        'This is a project early-warning signal, not an official government flood warning.',
      persist: true,
      transition_reason: 'The project severity increased.',
    };
  }
  if (newRank < oldRank) {
    return {
      alert_identity: alertIdentity,
      lifecycle_state: 'DOWNGRADED',
      severity,
      headline: `Project early-warning alert downgraded: ${severity}`,
      reason: 'Supporting evidence decreased; the project severity was reduced conservatively.',
      target_date: input.target_date,
      feature_date: input.feature_date,
      supporting_stations: supportingStations,
      supporting_systems: supportingSystems,
      affected_states: affectedStates,
      affected_districts: affectedDistricts,
      uncertainty: input.cumulative_risk.uncertainty.level,
      coverage,
      model_confidence: averageModelConfidence,
      recommended_action:
        'Monitor official CWC/NDMA/state disaster-management advisories.',
      disclaimer:
        'This is a project early-warning signal, not an official government flood warning.',
      persist: true,
      transition_reason: 'The project severity decreased.',
    };
  }
  return {
    alert_identity: alertIdentity,
    lifecycle_state: 'MAINTAINED',
    severity,
    headline: `Project early-warning alert maintained: ${severity}`,
    reason:
      input.consecutive_same_severity >= ALERT_CONFIG.debounce_maintained_runs
        ? 'The same project severity is sustained in repeated runs.'
        : 'The project severity remains unchanged.',
    target_date: input.target_date,
    feature_date: input.feature_date,
    supporting_stations: supportingStations,
    supporting_systems: supportingSystems,
    affected_states: affectedStates,
    affected_districts: affectedDistricts,
    uncertainty: input.cumulative_risk.uncertainty.level,
    coverage,
    model_confidence: averageModelConfidence,
    recommended_action:
      'Monitor official CWC/NDMA/state disaster-management advisories.',
    disclaimer:
      'This is a project early-warning signal, not an official government flood warning.',
    persist: true,
    transition_reason: 'The same severity and evidence scope remain active.',
  };
}
