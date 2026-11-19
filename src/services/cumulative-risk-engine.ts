import 'server-only';

import { getHydrologyNetworkContext, type PredictionSummary, type StationNode } from './hydrology-graph';

export interface CatchmentEvidence {
  station_count: number;
  documented_catchment_count: number;
  total_documented_catchment_km2: number | null;
  minimum_km2: number | null;
  maximum_km2: number | null;
  mean_km2: number | null;
  median_km2: number | null;
  interpretation: 'Documented station catchment observations; overlapping values, not a physical basin area.';
}

export interface EvidencePrediction {
  station_id: string;
  station_name: string | null;
  predicted_class: 'LOW' | 'MODERATE' | 'HIGH' | null;
  probability_low: number | null;
  probability_moderate: number | null;
  probability_high: number | null;
  confidence: number | null;
  prediction_status: string;
  available: boolean;
  data_coverage: string;
  status_reason: string | null;
}

export interface EvidenceStatus {
  missing_stations: string[];
  insufficient_history_stations: string[];
  prediction_failure_stations: string[];
  unknown_metadata_stations: string[];
  incomplete_river_system_stations: string[];
  missing_predictions: boolean;
  metadata_complete: boolean;
  system_membership_complete: boolean;
}

export interface StationEvidence {
  station: StationNode;
  prediction: EvidencePrediction | null;
}

export interface SystemEvidence {
  system_name: string;
  station_count: number;
  predicted_station_count: number;
  prediction_coverage: number;
  catchment: CatchmentEvidence;
  stations: StationEvidence[];
}

export interface StateEvidence {
  state: string;
  station_count: number;
  predicted_station_count: number;
  prediction_coverage: number;
  station_names: string[];
  river_systems: string[];
  catchment: CatchmentEvidence;
  stations: StationEvidence[];
}

export interface CumulativeEvidenceResult {
  status: 'EVIDENCE_READY';
  feature_date: string;
  target_date: string | null;
  station_count: number;
  predicted_station_count: number;
  coverage: number;
  river_systems: SystemEvidence[];
  state_evidence: StateEvidence[];
  station_evidence: StationEvidence[];
  uncertainty: EvidenceStatus;
  final_risk_label: null;
}

export interface CumulativePredictionInput {
  station_id: string;
  predicted_class: 'LOW' | 'MODERATE' | 'HIGH' | null;
  probability_low: number | null;
  probability_moderate: number | null;
  probability_high: number | null;
  confidence: number | null;
  prediction_status: 'PREDICTED' | 'INSUFFICIENT_HISTORY' | 'INVALID_INPUT' | 'UNSUPPORTED_STATION';
  status_reason: string | null;
}

export interface CumulativeStationMetadataInput {
  station_id: string;
  canonical_station_name: string | null;
  state: string | null;
  district: string | null;
  river: string | null;
  tributary: string | null;
  sub_basin: string | null;
  catchment_area_km2: number | null;
  metadata_confidence: 'verified' | 'approximate' | 'unknown' | string;
}

export interface CumulativeRiskOptions {
  feature_date: string;
  target_date: string | null;
  configured_station_ids: string[];
  station_predictions: CumulativePredictionInput[];
  station_metadata: CumulativeStationMetadataInput[];
  missing_stations?: string[];
  insufficient_history_stations?: string[];
  failed_stations?: string[];
  unknown_metadata_stations?: string[];
}

export interface RiverSystemRiskEvidence {
  system_name: string;
  station_ids: string[];
  station_count: number;
  predicted_count: number;
  prediction_coverage: number;
  elevated_station_count: number;
  high_station_count: number;
  moderate_station_count: number;
  low_station_count: number;
  corroboration_level: 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG';
  contradiction: boolean;
  confidence_summary: 'STRONG' | 'MODERATE' | 'WEAK' | 'UNKNOWN';
  evidence_status: 'NO_ELEVATED_EVIDENCE' | 'ISOLATED' | 'CORROBORATED' | 'CONTRADICTORY';
  severity_evidence: number;
  supporting_stations: string[];
  contradicting_stations: string[];
}

export interface CumulativeRiskResult {
  feature_date: string;
  target_date: string | null;
  station_coverage: {
    configured: number;
    available: number;
    missing: number;
    coverage: number;
  };
  coverage: number;
  risk_level: 'LOW' | 'MODERATE' | 'HIGH' | 'INSUFFICIENT_EVIDENCE';
  risk_score: number;
  decision_reason: string;
  system_evidence: RiverSystemRiskEvidence[];
  river_system_evidence: RiverSystemRiskEvidence[];
  cross_station_evidence: {
    pattern: 'NO_ELEVATED_EVIDENCE' | 'ISOLATED' | 'CORROBORATED' | 'BROAD' | 'CONTRADICTORY';
    elevated_station_count: number;
    elevated_system_count: number;
    high_station_count: number;
    moderate_station_count: number;
    low_station_count: number;
    supporting_stations: string[];
    contradicting_stations: string[];
  };
  uncertainty: {
    level: 'LOW' | 'MODERATE' | 'HIGH';
    reasons: string[];
  };
  data_quality: {
    missing_stations: string[];
    insufficient_history_stations: string[];
    failed_stations: string[];
    unknown_metadata_stations: string[];
  };
  supporting_stations: string[];
  contradicting_stations: string[];
  score_components: {
    severity: number;
    corroboration: number;
    cross_system: number;
    coverage: number;
    contradiction_penalty: number;
    low_confidence_penalty: number;
    metadata_penalty: number;
  };
  score_method: 'decision-support index, not a calibrated probability';
  threshold_policy: 'Project decision thresholds require historical backtesting/calibration';
  directional_propagation_used: false;
}

export const CUMULATIVE_RISK_CONFIG = {
  score_scale: { minimum: 0, maximum: 100 },
  moderate_severity_probability: 0.65,
  high_threshold: 0.70,
  moderate_threshold: 0.50,
  low_threshold: 25,
  moderate_risk_threshold: 50,
  high_risk_threshold: 70,
  full_corroboration_station_count: 2,
  cross_system_count_cap: 3,
  severe_coverage_threshold: 0.50,
  partial_coverage_threshold: 0.75,
  low_confidence_threshold: 0.70,
  score_components: {
    severity_maximum: 35,
    corroboration_maximum: 25,
    cross_system_maximum: 15,
    coverage_maximum: 15,
    contradiction_penalty_maximum: 12,
    low_confidence_penalty_maximum: 10,
    metadata_penalty_maximum: 10,
  },
} as const;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function catchmentEvidence(stations: StationNode[]): CatchmentEvidence {
  const catchments = stations
    .map((station) => station.catchment_area_km2)
    .filter((value): value is number => typeof value === 'number' && value >= 0);
  const total = catchments.length
    ? catchments.reduce((sum, value) => sum + value, 0)
    : null;
  return {
    station_count: stations.length,
    documented_catchment_count: catchments.length,
    total_documented_catchment_km2: total,
    minimum_km2: catchments.length ? Math.min(...catchments) : null,
    maximum_km2: catchments.length ? Math.max(...catchments) : null,
    mean_km2: catchments.length ? total! / catchments.length : null,
    median_km2: median(catchments),
    interpretation:
      'Documented station catchment observations; overlapping values, not a physical basin area.',
  };
}

function toEvidencePrediction(
  prediction: PredictionSummary | null,
  node: StationNode,
): EvidencePrediction | null {
  if (!prediction) return null;
  return {
    station_id: prediction.station_id,
    station_name: prediction.canonical_station_name ?? node.canonical_station_name,
    predicted_class: prediction.predicted_class,
    probability_low: prediction.probability_low,
    probability_moderate: prediction.probability_moderate,
    probability_high: prediction.probability_high,
    confidence: prediction.confidence,
    prediction_status: prediction.prediction_status,
    available: prediction.available,
    data_coverage: prediction.data_coverage,
    status_reason: prediction.status_reason,
  };
}

export function evaluateCumulativeRisk(
  input: CumulativeRiskOptions,
): CumulativeRiskResult {
  const configured = input.configured_station_ids.length;
  const availablePredictions = input.station_predictions.filter(
    (prediction) => prediction.prediction_status === 'PREDICTED',
  );
  const availableIds = new Set(availablePredictions.map((prediction) => prediction.station_id));
  const missing = [...new Set([
    ...input.configured_station_ids.filter((stationId) => !availableIds.has(stationId)),
    ...(input.missing_stations ?? []),
  ])];
  const insufficient = [...new Set(input.insufficient_history_stations ?? [])];
  const failed = [...new Set(input.failed_stations ?? [])];
  const unknownMetadata = [...new Set(input.unknown_metadata_stations ?? [])];
  const coverage = configured === 0 ? 0 : availablePredictions.length / configured;

  const metadataByStation = new Map(
    input.station_metadata.map((metadata) => [metadata.station_id, metadata]),
  );
  const systemMap = new Map<string, CumulativeStationMetadataInput[]>();
  for (const stationId of input.configured_station_ids) {
    const metadata = metadataByStation.get(stationId);
    if (!metadata) {
      unknownMetadata.push(stationId);
      continue;
    }
    const systemName = metadata.tributary
      ? `${metadata.river ?? 'Unknown river'} / ${metadata.tributary}`
      : metadata.river ?? 'Unknown river system';
    systemMap.set(systemName, [...(systemMap.get(systemName) ?? []), metadata]);
  }

  const predictionByStation = new Map(
    input.station_predictions.map((prediction) => [prediction.station_id, prediction]),
  );
  const systemEvidence: RiverSystemRiskEvidence[] = [...systemMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([systemName, stations]) => {
      const stationIds = stations.map((station) => station.station_id);
      const predictions = stationIds
        .map((stationId) => predictionByStation.get(stationId))
        .filter((prediction): prediction is CumulativePredictionInput =>
          Boolean(prediction && prediction.prediction_status === 'PREDICTED'),
        );
      const high = predictions.filter((prediction) => prediction.predicted_class === 'HIGH');
      const moderate = predictions.filter((prediction) =>
        prediction.predicted_class === 'MODERATE',
      );
      const low = predictions.filter((prediction) => prediction.predicted_class === 'LOW');
      const elevated = [...high, ...moderate];
      const contradiction = high.length > 0 && low.length > 0;
      const elevatedCount = elevated.length;
      const corroborationLevel =
        elevatedCount === 0
          ? 'NONE'
          : elevatedCount === 1
            ? 'WEAK'
            : elevatedCount === 2
              ? contradiction
                ? 'WEAK'
                : 'MODERATE'
              : contradiction
                ? 'MODERATE'
                : 'STRONG';

      const confidences = predictions
        .map((prediction) => prediction.confidence)
        .filter((value): value is number => typeof value === 'number');
      const averageConfidence = confidences.length
        ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
        : null;
      const confidenceSummary =
        averageConfidence === null
          ? 'UNKNOWN'
          : averageConfidence >= 0.85
            ? 'STRONG'
            : averageConfidence >= CUMULATIVE_RISK_CONFIG.low_confidence_threshold
              ? 'MODERATE'
              : 'WEAK';

      const maxHighProbability = predictions.length
        ? Math.max(
            ...predictions.map((prediction) =>
              typeof prediction.probability_high === 'number'
                ? prediction.probability_high
                : prediction.predicted_class === 'HIGH'
                  ? 1
                  : 0,
            ),
          )
        : 0;
      const maxModerateProbability = predictions.length
        ? Math.max(
            ...predictions.map((prediction) =>
              typeof prediction.probability_moderate === 'number'
                ? prediction.probability_moderate
                : prediction.predicted_class === 'MODERATE'
                  ? CUMULATIVE_RISK_CONFIG.moderate_severity_probability
                  : 0,
            ),
          )
        : 0;
      const severityEvidence = Math.max(
        maxHighProbability,
        maxModerateProbability * CUMULATIVE_RISK_CONFIG.moderate_severity_probability,
      );

      return {
        system_name: systemName,
        station_ids: stationIds,
        station_count: stationIds.length,
        predicted_count: predictions.length,
        prediction_coverage: stationIds.length === 0 ? 0 : predictions.length / stationIds.length,
        elevated_station_count: elevatedCount,
        high_station_count: high.length,
        moderate_station_count: moderate.length,
        low_station_count: low.length,
        corroboration_level: corroborationLevel,
        contradiction,
        confidence_summary: confidenceSummary,
        evidence_status:
          elevatedCount === 0
            ? 'NO_ELEVATED_EVIDENCE'
            : contradiction
              ? 'CONTRADICTORY'
              : elevatedCount >= 2
                ? 'CORROBORATED'
                : 'ISOLATED',
        severity_evidence: severityEvidence,
        supporting_stations: elevated.map((prediction) => prediction.station_id),
        contradicting_stations: contradiction
          ? low.map((prediction) => prediction.station_id)
          : [],
      };
    });

  const elevatedSystems = systemEvidence.filter(
    (system) => system.elevated_station_count > 0,
  );
  const contradictionCount = systemEvidence.filter((system) => system.contradiction).length;
  const supportingStations = [
    ...new Set(systemEvidence.flatMap((system) => system.supporting_stations)),
  ].sort();
  const contradictingStations = [
    ...new Set(systemEvidence.flatMap((system) => system.contradicting_stations)),
  ].sort();
  const highCount = availablePredictions
    .filter((prediction) => prediction.predicted_class === 'HIGH').length;
  const moderateCount = availablePredictions
    .filter((prediction) => prediction.predicted_class === 'MODERATE').length;
  const lowCount = availablePredictions
    .filter((prediction) => prediction.predicted_class === 'LOW').length;

  const maxSeverity = systemEvidence.length
    ? Math.max(...systemEvidence.map((system) => system.severity_evidence))
    : 0;
  const maxCorroboration = systemEvidence.length
    ? Math.max(...systemEvidence.map((system) =>
        system.elevated_station_count === 0
          ? 0
          : system.elevated_station_count === 1
            ? 0.15
            : 1,
      ))
    : 0;
  const crossSystemRatio = elevatedSystems.length === 0
    ? 0
    : elevatedSystems.length === 1
      ? 0.35
      : Math.min(
          elevatedSystems.length,
          CUMULATIVE_RISK_CONFIG.cross_system_count_cap,
        ) / CUMULATIVE_RISK_CONFIG.cross_system_count_cap;

  const confidenceValues = availablePredictions
    .map((prediction) => prediction.confidence)
    .filter((value): value is number => typeof value === 'number');
  const averageConfidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : null;
  const lowConfidencePenalty = averageConfidence === null
    ? CUMULATIVE_RISK_CONFIG.score_components.low_confidence_penalty_maximum
    : averageConfidence < CUMULATIVE_RISK_CONFIG.low_confidence_threshold
      ? CUMULATIVE_RISK_CONFIG.score_components.low_confidence_penalty_maximum
        * (CUMULATIVE_RISK_CONFIG.low_confidence_threshold - averageConfidence)
        / CUMULATIVE_RISK_CONFIG.low_confidence_threshold
      : 0;
  const contradictionPenalty = contradictionCount === 0
    ? 0
    : CUMULATIVE_RISK_CONFIG.score_components.contradiction_penalty_maximum
      * Math.min(contradictionCount, 2) / 2;
  const unknownMetadataSet = new Set(unknownMetadata);
  const metadataPenalty = configured === 0
    ? CUMULATIVE_RISK_CONFIG.score_components.metadata_penalty_maximum
    : CUMULATIVE_RISK_CONFIG.score_components.metadata_penalty_maximum
      * unknownMetadataSet.size / configured;

  const severity = CUMULATIVE_RISK_CONFIG.score_components.severity_maximum * maxSeverity;
  const corroboration =
    CUMULATIVE_RISK_CONFIG.score_components.corroboration_maximum * maxCorroboration;
  const crossSystem =
    CUMULATIVE_RISK_CONFIG.score_components.cross_system_maximum * crossSystemRatio;
  const coveragePoints =
    CUMULATIVE_RISK_CONFIG.score_components.coverage_maximum * coverage;

  const rawScore = severity + corroboration + crossSystem + coveragePoints
    - contradictionPenalty - lowConfidencePenalty - metadataPenalty;
  const riskScore = Math.max(0, Math.min(100, Math.round(rawScore * 10) / 10));

  const uncertaintyReasons: string[] = [];
  if (coverage < CUMULATIVE_RISK_CONFIG.severe_coverage_threshold) {
    uncertaintyReasons.push('Severe station coverage loss.');
  } else if (coverage < CUMULATIVE_RISK_CONFIG.partial_coverage_threshold) {
    uncertaintyReasons.push('Partial station coverage.');
  }
  if (contradictionCount > 0) uncertaintyReasons.push('Contradictory station evidence exists.');
  if (lowConfidencePenalty > 0) uncertaintyReasons.push('Average model confidence is low.');
  if (unknownMetadataSet.size > 0) uncertaintyReasons.push('Some station metadata is incomplete.');
  if (elevatedSystems.length === 1) {
    uncertaintyReasons.push('Elevated evidence is isolated to one hydrological system.');
  }
  if (insufficient.length > 0) uncertaintyReasons.push('Some observations lack sufficient history.');
  if (failed.length > 0) uncertaintyReasons.push('One or more prediction failures remain unresolved.');

  let riskLevel: CumulativeRiskResult['risk_level'];
  if (
    coverage === 0
    || coverage < CUMULATIVE_RISK_CONFIG.severe_coverage_threshold
    || unknownMetadataSet.size > 0
  ) {
    riskLevel = 'INSUFFICIENT_EVIDENCE';
  } else if (riskScore >= CUMULATIVE_RISK_CONFIG.high_risk_threshold) {
    riskLevel = 'HIGH';
  } else if (riskScore >= CUMULATIVE_RISK_CONFIG.moderate_risk_threshold) {
    riskLevel = 'MODERATE';
  } else {
    riskLevel = 'LOW';
  }

  const pattern: CumulativeRiskResult['cross_station_evidence']['pattern'] =
    elevatedSystems.length === 0
      ? 'NO_ELEVATED_EVIDENCE'
      : elevatedSystems.length >= 2
        ? 'BROAD'
        : elevatedSystems[0].elevated_station_count >= 2
          ? 'CORROBORATED'
          : 'ISOLATED';

  const uncertaintyLevel: CumulativeRiskResult['uncertainty']['level'] =
    uncertaintyReasons.length >= 3 || riskLevel === 'INSUFFICIENT_EVIDENCE'
      ? 'HIGH'
      : uncertaintyReasons.length > 0
        ? 'MODERATE'
        : 'LOW';

  const decisionReason =
    riskLevel === 'INSUFFICIENT_EVIDENCE'
      ? `Cumulative assessment withheld: coverage is ${availablePredictions.length}/${configured}, with ${unknownMetadataSet.size} metadata gaps.`
      : `${availablePredictions.length}/${configured} stations available; ${highCount} HIGH, ${moderateCount} MODERATE, and ${lowCount} LOW; ${elevatedSystems.length} systems contain elevated evidence.`;

  return {
    feature_date: input.feature_date,
    target_date: input.target_date,
    station_coverage: {
      configured,
      available: availablePredictions.length,
      missing: missing.length,
      coverage,
    },
    coverage,
    risk_level: riskLevel,
    risk_score: riskScore,
    decision_reason: decisionReason,
    system_evidence: systemEvidence,
    river_system_evidence: systemEvidence,
    cross_station_evidence: {
      pattern,
      elevated_station_count: supportingStations.length,
      elevated_system_count: elevatedSystems.length,
      high_station_count: highCount,
      moderate_station_count: moderateCount,
      low_station_count: lowCount,
      supporting_stations: supportingStations,
      contradicting_stations: contradictingStations,
    },
    uncertainty: {
      level: uncertaintyLevel,
      reasons: uncertaintyReasons,
    },
    data_quality: {
      missing_stations: missing,
      insufficient_history_stations: insufficient,
      failed_stations: failed,
      unknown_metadata_stations: [...unknownMetadataSet].sort(),
    },
    supporting_stations: supportingStations,
    contradicting_stations: contradictingStations,
    score_components: {
      severity,
      corroboration,
      cross_system: crossSystem,
      coverage: coveragePoints,
      contradiction_penalty: contradictionPenalty,
      low_confidence_penalty: lowConfidencePenalty,
      metadata_penalty: metadataPenalty,
    },
    score_method: 'decision-support index, not a calibrated probability',
    threshold_policy: 'Project decision thresholds require historical backtesting/calibration',
    directional_propagation_used: false,
  };
}

export async function getCumulativeEvidence(
  featureDate?: string,
): Promise<CumulativeEvidenceResult & CumulativeRiskResult> {
  const network = await getHydrologyNetworkContext(featureDate);
  const nodes = network.nodes;
  const predictionByStation = new Map(
    network.station_context
      .map((context) => [context.node.station_id, context.own_prediction]),
  );

  const stationEvidence: StationEvidence[] = nodes.map((node) => ({
    station: node,
    prediction: toEvidencePrediction(predictionByStation.get(node.station_id) ?? null, node),
  }));

  const riverSystemMap = new Map<string, StationNode[]>();
  for (const node of nodes) {
    const systemName = node.tributary
      ? `${node.river ?? 'Unknown river'} / ${node.tributary}`
      : node.river ?? 'Unknown river system';
    riverSystemMap.set(systemName, [...(riverSystemMap.get(systemName) ?? []), node]);
  }
  const riverSystems: SystemEvidence[] = [...riverSystemMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([systemName, stations]) => {
      const stationEvidenceForSystem = stations.map((node) => ({
        station: node,
        prediction: toEvidencePrediction(predictionByStation.get(node.station_id) ?? null, node),
      }));
      const predictedCount = stationEvidenceForSystem
        .filter((item) => item.prediction?.available).length;
      return {
        system_name: systemName,
        station_count: stations.length,
        predicted_station_count: predictedCount,
        prediction_coverage: stations.length === 0 ? 0 : predictedCount / stations.length,
        catchment: catchmentEvidence(stations),
        stations: stationEvidenceForSystem,
      };
    });

  const stateMap = new Map<string, StationNode[]>();
  for (const node of nodes) {
    const stateName = node.state ?? 'Unknown';
    stateMap.set(stateName, [...(stateMap.get(stateName) ?? []), node]);
  }
  const stateEvidence: StateEvidence[] = [...stateMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([stateName, stations]) => {
      const stationEvidenceForState = stations.map((node) => ({
        station: node,
        prediction: toEvidencePrediction(predictionByStation.get(node.station_id) ?? null, node),
      }));
      const predictedCount = stationEvidenceForState
        .filter((item) => item.prediction?.available).length;
      return {
        state: stateName,
        station_count: stations.length,
        predicted_station_count: predictedCount,
        prediction_coverage: stations.length === 0 ? 0 : predictedCount / stations.length,
        station_names: stations.map((node) => node.canonical_station_name ?? node.station_id),
        river_systems: [...new Set(stations.map((node) =>
          node.tributary
            ? `${node.river ?? 'Unknown river'} / ${node.tributary}`
            : node.river ?? 'Unknown river system',
        ))].sort(),
        catchment: catchmentEvidence(stations),
        stations: stationEvidenceForState,
      };
    });

  const missing = stationEvidence
    .filter((item) => item.prediction === null)
    .map((item) => item.station.station_id);
  const insufficient = stationEvidence
    .filter((item) => item.prediction?.prediction_status === 'INSUFFICIENT_HISTORY')
    .map((item) => item.station.station_id);
  const failures = stationEvidence
    .filter((item) => item.prediction
      && ['INVALID_INPUT', 'UNSUPPORTED_STATION'].includes(item.prediction.prediction_status))
    .map((item) => item.station.station_id);
  const unknownMetadata = nodes
    .filter((node) => node.metadata_confidence === 'unknown'
      || node.state === null
      || node.river === null
      || node.tributary === null
      || node.catchment_area_km2 === null)
    .map((node) => node.station_id);
  const incompleteRiverMembership = nodes
    .filter((node) => node.river === null || node.tributary === null)
    .map((node) => node.station_id);
  const predictedCount = stationEvidence
    .filter((item) => item.prediction?.available).length;

  const cumulativePredictions: CumulativePredictionInput[] =
    network.station_context.map((context) => {
      const prediction = context.own_prediction;
      return {
        station_id: context.node.station_id,
        predicted_class: prediction?.predicted_class ?? null,
        probability_low: prediction?.probability_low ?? null,
        probability_moderate: prediction?.probability_moderate ?? null,
        probability_high: prediction?.probability_high ?? null,
        confidence: prediction?.confidence ?? null,
        prediction_status: prediction?.prediction_status as CumulativePredictionInput['prediction_status']
          ?? 'INSUFFICIENT_HISTORY',
        status_reason: prediction?.status_reason ?? null,
      };
    });
  const cumulativeMetadata: CumulativeStationMetadataInput[] = nodes.map((node) => ({
    station_id: node.station_id,
    canonical_station_name: node.canonical_station_name,
    state: node.state,
    district: node.district,
    river: node.river,
    tributary: node.tributary,
    sub_basin: node.sub_basin,
    catchment_area_km2: node.catchment_area_km2,
    metadata_confidence: node.metadata_confidence,
  }));
  const cumulativeRisk = evaluateCumulativeRisk({
    feature_date: network.feature_date,
    target_date: network.target_date,
    configured_station_ids: nodes.map((node) => node.station_id),
    station_predictions: cumulativePredictions,
    station_metadata: cumulativeMetadata,
    missing_stations: missing,
    insufficient_history_stations: insufficient,
    failed_stations: failures,
    unknown_metadata_stations: unknownMetadata,
  });

  return {
    ...cumulativeRisk,
    status: 'EVIDENCE_READY',
    feature_date: network.feature_date,
    target_date: network.target_date,
    station_count: nodes.length,
    predicted_station_count: predictedCount,
    coverage: nodes.length === 0 ? 0 : predictedCount / nodes.length,
    river_systems: riverSystems,
    state_evidence: stateEvidence,
    station_evidence: stationEvidence,
    uncertainty: {
      ...cumulativeRisk.uncertainty,
      missing_stations: missing,
      insufficient_history_stations: insufficient,
      prediction_failure_stations: failures,
      unknown_metadata_stations: unknownMetadata,
      incomplete_river_system_stations: incompleteRiverMembership,
      missing_predictions: missing.length > 0,
      metadata_complete: unknownMetadata.length === 0,
      system_membership_complete: incompleteRiverMembership.length === 0,
    },
    final_risk_label: null,
  };
}
