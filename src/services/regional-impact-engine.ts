import 'server-only';

import { getCumulativeEvidence, type CumulativeRiskResult } from './cumulative-risk-engine';
import { getHydrologyNetworkContext } from './hydrology-graph';

export type RegionalImpactLevel =
  | 'NO_ELEVATED_EVIDENCE'
  | 'WATCH'
  | 'POTENTIAL_IMPACT'
  | 'HIGH_POTENTIAL_IMPACT'
  | 'INSUFFICIENT_EVIDENCE';

export interface RegionalStationEvidence {
  station_id: string;
  station_name: string | null;
  latitude: number | null;
  longitude: number | null;
  river_system: string;
  predicted_class: 'LOW' | 'MODERATE' | 'HIGH' | null;
  probability_low: number | null;
  probability_moderate: number | null;
  probability_high: number | null;
  confidence: number | null;
  prediction_status: string;
  supporting: boolean;
  contradiction: boolean;
}

export interface DistrictImpactEvidence {
  district: string;
  state: string;
  station_count: number;
  predicted_station_count: number;
  coverage: number;
  low_station_count: number;
  moderate_station_count: number;
  high_station_count: number;
  highest_predicted_class: 'LOW' | 'MODERATE' | 'HIGH' | null;
  river_systems: string[];
  supporting_river_systems: string[];
  supporting_stations: string[];
  contradicting_stations: string[];
  impact_level: RegionalImpactLevel;
  evidence_strength: 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG';
  uncertainty: 'LOW' | 'MODERATE' | 'HIGH';
  uncertainty_reasons: string[];
  station_evidence: RegionalStationEvidence[];
  catchment_overlap_notice:
    'Catchment values describe station observations and are not summed as affected district area.';
}

export interface StateImpactEvidence {
  state: string;
  configured_station_count: number;
  predicted_station_count: number;
  coverage: number;
  affected_district_count: number;
  elevated_river_system_count: number;
  low_station_count: number;
  moderate_station_count: number;
  high_station_count: number;
  supporting_stations: string[];
  supporting_river_systems: string[];
  contradicting_stations: string[];
  impact_level: RegionalImpactLevel;
  uncertainty: 'LOW' | 'MODERATE' | 'HIGH';
  uncertainty_reasons: string[];
  districts: DistrictImpactEvidence[];
}

export interface RegionalPredictionInput {
  station_id: string;
  predicted_class: 'LOW' | 'MODERATE' | 'HIGH' | null;
  probability_low: number | null;
  probability_moderate: number | null;
  probability_high: number | null;
  confidence: number | null;
  prediction_status: 'PREDICTED' | 'INSUFFICIENT_HISTORY' | 'INVALID_INPUT' | 'UNSUPPORTED_STATION';
  status_reason: string | null;
}

export interface RegionalStationMetadataInput {
  station_id: string;
  canonical_station_name: string | null;
  state: string | null;
  district: string | null;
  river: string | null;
  tributary: string | null;
  sub_basin: string | null;
  latitude: number | null;
  longitude: number | null;
  catchment_area_km2: number | null;
  metadata_confidence: string;
}

export interface RegionalImpactOptions {
  feature_date: string;
  target_date: string | null;
  station_predictions: RegionalPredictionInput[];
  station_metadata: RegionalStationMetadataInput[];
  cumulative_risk?: CumulativeRiskResult | null;
  missing_station_ids?: string[];
}

export interface RegionalImpactResult {
  feature_date: string;
  target_date: string | null;
  regional_impact_level: RegionalImpactLevel;
  basin_geographic_coverage: {
    represented_states: string[];
    represented_state_count: number;
    unrepresented_basin_states: string[];
    geographic_coverage_status: 'PARTIAL';
  };
  potentially_affected_states: string[];
  potentially_affected_districts: string[];
  state_impact_evidence: StateImpactEvidence[];
  district_impact_evidence: DistrictImpactEvidence[];
  supporting_stations: string[];
  supporting_river_systems: string[];
  uncertain_regions: string[];
  data_quality: {
    missing_stations: string[];
    missing_district_metadata: string[];
    missing_state_metadata: string[];
    coverage: number;
  };
  methodology: string[];
  limitations: string[];
  authoritative_hydrological_context:
    'CWC metadata is administrative/hydrological context only and does not itself predict impact.';
}

export const REGIONAL_IMPACT_CONFIG = {
  coverage_watch_threshold: 0.75,
  two_station_corroboration: 2,
  multiple_district_state_threshold: 2,
  high_potential_high_station_threshold: 2,
  unrepresented_basin_states: [
    'Chhattisgarh',
    'Madhya Pradesh',
    'Karnataka',
  ],
} as const;

function riverSystemName(metadata: RegionalStationMetadataInput): string {
  if (metadata.tributary) {
    return `${metadata.river ?? 'Unknown river'} / ${metadata.tributary}`;
  }
  return metadata.river ?? 'Unknown river system';
}

function highestClass(classes: Array<'LOW' | 'MODERATE' | 'HIGH'>):
  'LOW' | 'MODERATE' | 'HIGH' | null {
  if (classes.includes('HIGH')) return 'HIGH';
  if (classes.includes('MODERATE')) return 'MODERATE';
  if (classes.includes('LOW')) return 'LOW';
  return null;
}

export function evaluateRegionalImpact(
  input: RegionalImpactOptions,
): RegionalImpactResult {
  const predictionByStation = new Map(
    input.station_predictions.map((prediction) => [prediction.station_id, prediction]),
  );
  const configuredIds = input.station_metadata.map((metadata) => metadata.station_id);
  const availableIds = new Set(
    input.station_predictions
      .filter((prediction) => prediction.prediction_status === 'PREDICTED')
      .map((prediction) => prediction.station_id),
  );
  const missingStations = [...new Set([
    ...(input.missing_station_ids ?? []),
    ...configuredIds.filter((stationId) => !availableIds.has(stationId)),
  ])].sort();
  const coverage = configuredIds.length === 0
    ? 0
    : availableIds.size / configuredIds.length;

  const missingDistrictMetadata = input.station_metadata
    .filter((metadata) => !metadata.district)
    .map((metadata) => metadata.station_id)
    .sort();
  const missingStateMetadata = input.station_metadata
    .filter((metadata) => !metadata.state)
    .map((metadata) => metadata.station_id)
    .sort();

  const districtMap = new Map<string, RegionalStationMetadataInput[]>();
  for (const metadata of input.station_metadata) {
    if (!metadata.state || !metadata.district) continue;
    const key = `${metadata.state}|${metadata.district}`;
    districtMap.set(key, [...(districtMap.get(key) ?? []), metadata]);
  }

  const districtEvidence: DistrictImpactEvidence[] = [...districtMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, stations]) => {
      const separator = key.indexOf('|');
      const state = key.slice(0, separator);
      const district = key.slice(separator + 1);
      const stationEvidence: RegionalStationEvidence[] = stations
        .map((metadata) => {
          const prediction = predictionByStation.get(metadata.station_id);
          const predictedClass = prediction?.predicted_class ?? null;
          return {
            station_id: metadata.station_id,
            station_name: metadata.canonical_station_name,
            latitude: metadata.latitude,
            longitude: metadata.longitude,
            river_system: riverSystemName(metadata),
            predicted_class: predictedClass,
            probability_low: prediction?.probability_low ?? null,
            probability_moderate: prediction?.probability_moderate ?? null,
            probability_high: prediction?.probability_high ?? null,
            confidence: prediction?.confidence ?? null,
            prediction_status: prediction?.prediction_status ?? 'INSUFFICIENT_HISTORY',
            supporting: predictedClass === 'HIGH' || predictedClass === 'MODERATE',
            contradiction: false,
          };
        });

      const availableEvidence = stationEvidence.filter((item) =>
        item.prediction_status === 'PREDICTED',
      );
      const highCount = availableEvidence.filter((item) => item.predicted_class === 'HIGH').length;
      const moderateCount = availableEvidence
        .filter((item) => item.predicted_class === 'MODERATE').length;
      const lowCount = availableEvidence.filter((item) => item.predicted_class === 'LOW').length;
      const elevatedCount = highCount + moderateCount;
      const contradiction = highCount > 0 && lowCount > 0;
      for (const item of stationEvidence) {
        item.supporting = item.predicted_class === 'HIGH' || item.predicted_class === 'MODERATE';
        item.contradiction =
          contradiction
          && (item.predicted_class === 'HIGH' || item.predicted_class === 'LOW');
      }
      const supportingStations = stationEvidence
        .filter((item) => item.supporting)
        .map((item) => item.station_id);
      const contradictingStations = stationEvidence
        .filter((item) => item.contradiction)
        .map((item) => item.station_id);
      const riverSystems = [...new Set(stations.map(riverSystemName))].sort();
      const uncertaintyReasons: string[] = [];
      if (coverage < REGIONAL_IMPACT_CONFIG.coverage_watch_threshold) {
        uncertaintyReasons.push('Regional station coverage is incomplete.');
      }
      if (contradiction) {
        uncertaintyReasons.push('Elevated and LOW station predictions contradict each other.');
      }
      const districtMissing = stations
        .filter((metadata) =>
          !availableIds.has(metadata.station_id)
          || !metadata.district
          || !metadata.state,
        )
        .length;
      if (districtMissing > 0) {
        uncertaintyReasons.push('One or more district stations are missing or lack complete metadata.');
      }

      let impactLevel: RegionalImpactLevel;
      if (
        availableEvidence.length === 0
        || districtMissing === stations.length
      ) {
        impactLevel = 'INSUFFICIENT_EVIDENCE';
      } else if (elevatedCount === 0) {
        impactLevel = 'NO_ELEVATED_EVIDENCE';
      } else if (highCount >= REGIONAL_IMPACT_CONFIG.high_potential_high_station_threshold) {
        impactLevel = 'HIGH_POTENTIAL_IMPACT';
      } else if (
        elevatedCount >= REGIONAL_IMPACT_CONFIG.two_station_corroboration
        && !contradiction
      ) {
        impactLevel = 'POTENTIAL_IMPACT';
      } else {
        impactLevel = 'WATCH';
      }

      const uncertainty: 'LOW' | 'MODERATE' | 'HIGH' =
        impactLevel === 'INSUFFICIENT_EVIDENCE' || uncertaintyReasons.length >= 2
          ? 'HIGH'
          : uncertaintyReasons.length === 1
            ? 'MODERATE'
            : 'LOW';
      const evidenceStrength =
        elevatedCount === 0
          ? 'NONE'
          : elevatedCount >= 2 && !contradiction
            ? 'STRONG'
            : contradiction
              ? 'MODERATE'
              : 'WEAK';

      return {
        district,
        state,
        station_count: stations.length,
        predicted_station_count: availableEvidence.length,
        coverage: stations.length === 0 ? 0 : availableEvidence.length / stations.length,
        low_station_count: lowCount,
        moderate_station_count: moderateCount,
        high_station_count: highCount,
        highest_predicted_class: highestClass(
          availableEvidence
            .map((item) => item.predicted_class)
            .filter((value): value is 'LOW' | 'MODERATE' | 'HIGH' => Boolean(value)),
        ),
        river_systems: riverSystems,
        supporting_river_systems: [...new Set(
          stationEvidence
            .filter((item) => item.supporting)
            .map((item) => item.river_system),
        )].sort(),
        supporting_stations: supportingStations,
        contradicting_stations: contradictingStations,
        impact_level: impactLevel,
        evidence_strength: evidenceStrength,
        uncertainty,
        uncertainty_reasons: uncertaintyReasons,
        station_evidence: stationEvidence,
        catchment_overlap_notice:
          'Catchment values describe station observations and are not summed as affected district area.',
      };
    });

  const stateMap = new Map<string, DistrictImpactEvidence[]>();
  for (const district of districtEvidence) {
    stateMap.set(district.state, [...(stateMap.get(district.state) ?? []), district]);
  }

  const stateEvidence: StateImpactEvidence[] = [...stateMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([state, districts]) => {
      const stationIds = districts.flatMap((district) =>
        district.station_evidence.map((station) => station.station_id),
      );
      const uniqueStationIds = [...new Set(stationIds)];
      const availableIdsForState = uniqueStationIds
        .filter((stationId) => availableIds.has(stationId));
      const lowCount = districts.reduce((sum, district) => sum + district.low_station_count, 0);
      const moderateCount = districts
        .reduce((sum, district) => sum + district.moderate_station_count, 0);
      const highCount = districts.reduce((sum, district) => sum + district.high_station_count, 0);
      const supportingStations = [...new Set(
        districts.flatMap((district) => district.supporting_stations),
      )].sort();
      const contradictingStations = [...new Set(
        districts.flatMap((district) => district.contradicting_stations),
      )].sort();
      const supportingSystems = [...new Set(
        districts
          .flatMap((district) => district.supporting_river_systems),
      )].sort();
      const affectedDistricts = districts.filter((district) =>
        district.impact_level !== 'NO_ELEVATED_EVIDENCE'
        && district.impact_level !== 'INSUFFICIENT_EVIDENCE',
      );
      const elevatedSystems = [...new Set(
        affectedDistricts.flatMap((district) =>
          district.supporting_stations.length > 0
            ? district.river_systems
            : [],
        ),
      )];
      const uncertaintyReasons: string[] = [];
      if (availableIdsForState.length / uniqueStationIds.length
        < REGIONAL_IMPACT_CONFIG.coverage_watch_threshold) {
        uncertaintyReasons.push('State station coverage is incomplete.');
      }
      if (contradictingStations.length > 0) {
        uncertaintyReasons.push('At least one represented district has contradictory evidence.');
      }

      let stateLevel: RegionalImpactLevel;
      if (
        availableIdsForState.length === 0
        || uniqueStationIds.some((stationId) => missingDistrictMetadata.includes(stationId))
      ) {
        stateLevel = 'INSUFFICIENT_EVIDENCE';
      } else if (affectedDistricts.length === 0) {
        stateLevel = 'NO_ELEVATED_EVIDENCE';
      } else if (
        highCount >= REGIONAL_IMPACT_CONFIG.high_potential_high_station_threshold
        || affectedDistricts.length >= REGIONAL_IMPACT_CONFIG.multiple_district_state_threshold
      ) {
        stateLevel =
          highCount >= REGIONAL_IMPACT_CONFIG.high_potential_high_station_threshold
            ? 'HIGH_POTENTIAL_IMPACT'
            : 'POTENTIAL_IMPACT';
      } else {
        stateLevel = affectedDistricts.length > 0 ? 'WATCH' : 'NO_ELEVATED_EVIDENCE';
      }

      const stateUncertainty =
        stateLevel === 'INSUFFICIENT_EVIDENCE' || uncertaintyReasons.length >= 2
          ? 'HIGH'
          : uncertaintyReasons.length === 1
            ? 'MODERATE'
            : 'LOW';

      return {
        state,
        configured_station_count: uniqueStationIds.length,
        predicted_station_count: availableIdsForState.length,
        coverage: uniqueStationIds.length === 0
          ? 0
          : availableIdsForState.length / uniqueStationIds.length,
        affected_district_count: affectedDistricts.length,
        elevated_river_system_count: elevatedSystems.length,
        low_station_count: lowCount,
        moderate_station_count: moderateCount,
        high_station_count: highCount,
        supporting_stations: supportingStations,
        supporting_river_systems: supportingSystems,
        contradicting_stations: contradictingStations,
        impact_level: stateLevel,
        uncertainty: stateUncertainty,
        uncertainty_reasons: uncertaintyReasons,
        districts,
      };
    });

  const representedStates = stateEvidence.map((state) => state.state).sort();
  const affectedStates = stateEvidence
    .filter((state) =>
      state.impact_level !== 'NO_ELEVATED_EVIDENCE'
      && state.impact_level !== 'INSUFFICIENT_EVIDENCE',
    )
    .map((state) => state.state);
  const affectedDistricts = districtEvidence
    .filter((district) =>
      district.impact_level !== 'NO_ELEVATED_EVIDENCE'
      && district.impact_level !== 'INSUFFICIENT_EVIDENCE',
    )
    .map((district) => district.district);
  const supportingStations = [...new Set(
    stateEvidence.flatMap((state) => state.supporting_stations),
  )].sort();
  const supportingSystems = [...new Set(
    stateEvidence.flatMap((state) => state.supporting_river_systems),
  )].sort();
  const uncertainRegions = [
    ...stateEvidence
      .filter((state) => state.uncertainty !== 'LOW')
      .map((state) => state.state),
    ...districtEvidence
      .filter((district) => district.uncertainty !== 'LOW')
      .map((district) => district.district),
  ].filter((value, index, values) => values.indexOf(value) === index).sort();

  const noElevated = affectedStates.length === 0;
  const highPotentialState = stateEvidence.some(
    (state) => state.impact_level === 'HIGH_POTENTIAL_IMPACT',
  );
  const potentialState = stateEvidence.some(
    (state) => state.impact_level === 'POTENTIAL_IMPACT',
  );
  const regionalLevel: RegionalImpactLevel =
    noElevated
      ? 'NO_ELEVATED_EVIDENCE'
      : highPotentialState
        ? 'HIGH_POTENTIAL_IMPACT'
        : potentialState || affectedStates.length >= 2
          ? 'POTENTIAL_IMPACT'
          : 'WATCH';

  return {
    feature_date: input.feature_date,
    target_date: input.target_date,
    regional_impact_level: regionalLevel,
    basin_geographic_coverage: {
      represented_states: representedStates,
      represented_state_count: representedStates.length,
      unrepresented_basin_states: [...REGIONAL_IMPACT_CONFIG.unrepresented_basin_states],
      geographic_coverage_status: 'PARTIAL',
    },
    potentially_affected_states: affectedStates.sort(),
    potentially_affected_districts: affectedDistricts.sort(),
    state_impact_evidence: stateEvidence,
    district_impact_evidence: districtEvidence,
    supporting_stations: supportingStations,
    supporting_river_systems: supportingSystems,
    uncertain_regions: uncertainRegions,
    data_quality: {
      missing_stations: missingStations,
      missing_district_metadata: missingDistrictMetadata,
      missing_state_metadata: missingStateMetadata,
      coverage,
    },
    methodology: [
      'Regional impact is derived from station-level ML predictions associated with verified state/district metadata.',
      'District evidence is aggregated across stations and river systems without arbitrary station weights.',
      'State evidence is derived from its represented districts and is not a direct ML basin prediction.',
      'The regional vocabulary is project-specific and not an official government warning category.',
    ],
    limitations: [
      'No defensive or directional station propagation was inferred.',
      'Catchment areas overlap and are not summed as affected geographic area.',
      'The dataset covers only four represented states and not the complete Godavari basin.',
      'No alerts, GIS map, administrative warning, or operational dispatch is generated.',
    ],
    authoritative_hydrological_context:
      'CWC metadata is administrative/hydrological context only and does not itself predict impact.',
  };
}

export async function getRegionalImpact(featureDate?: string):
  Promise<RegionalImpactResult> {
  const network = await getHydrologyNetworkContext(featureDate);
  const cumulative = await getCumulativeEvidence(featureDate);
  const stationMetadata: RegionalStationMetadataInput[] =
    network.nodes.map((node) => ({
      station_id: node.station_id,
      canonical_station_name: node.canonical_station_name,
      state: node.state,
      district: node.district,
      river: node.river,
      tributary: node.tributary,
      sub_basin: node.sub_basin,
      latitude: node.latitude,
      longitude: node.longitude,
      catchment_area_km2: node.catchment_area_km2,
      metadata_confidence: node.metadata_confidence,
    }));
  const stationPredictions: RegionalPredictionInput[] =
    network.station_context.map((context) => ({
      station_id: context.node.station_id,
      predicted_class: context.own_prediction?.predicted_class ?? null,
      probability_low: context.own_prediction?.probability_low ?? null,
      probability_moderate: context.own_prediction?.probability_moderate ?? null,
      probability_high: context.own_prediction?.probability_high ?? null,
      confidence: context.own_prediction?.confidence ?? null,
      prediction_status:
        context.own_prediction?.prediction_status as RegionalPredictionInput['prediction_status']
        ?? 'INSUFFICIENT_HISTORY',
      status_reason: context.own_prediction?.status_reason ?? null,
    }));
  return evaluateRegionalImpact({
    feature_date: network.feature_date,
    target_date: network.target_date,
    station_predictions: stationPredictions,
    station_metadata: stationMetadata,
    cumulative_risk: cumulative as CumulativeRiskResult,
  });
}
