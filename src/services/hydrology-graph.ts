import 'server-only';

import fs from 'node:fs';
import path from 'node:path';

import { pool } from '@/lib/db';

export type GraphRelationship =
  | 'DIRECT_UPSTREAM'
  | 'DIRECT_DOWNSTREAM'
  | 'SAME_RIVER_SYSTEM'
  | 'SAME_SUB_BASIN'
  | 'TRIBUTARY_ASSOCIATION'
  | 'UNVERIFIED';

export interface StationNode {
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
  station_type: string | null;
  seasonal_flag: boolean;
  metadata_confidence: string;
  source: string | null;
  source_reference: string | null;
  purpose: string | null;
}

export interface GraphEdge {
  edge_id: string;
  upstream_station_id: string | null;
  downstream_station_id: string | null;
  relationship_type: GraphRelationship;
  river_system: string | null;
  station_ids: string[];
  confidence: string;
  source: string;
  source_reference: string;
  notes: string;
}

export interface PredictionSummary {
  station_id: string;
  canonical_station_name: string | null;
  predicted_class: 'LOW' | 'MODERATE' | 'HIGH' | null;
  probability_low: number | null;
  probability_moderate: number | null;
  probability_high: number | null;
  confidence: number | null;
  prediction_status: string;
  feature_date: string;
  target_date: string | null;
  data_coverage: string;
  status_reason: string | null;
  available: boolean;
}

export interface GraphCoverage {
  configured: number;
  predicted: number;
  coverage: number;
}

export interface StationNetworkContext {
  node: StationNode;
  upstream_station_count: number;
  downstream_station_count: number;
  direct_upstream_station_ids: string[];
  direct_downstream_station_ids: string[];
  connected_station_count: number;
  graph_degree: number;
  upstream_connected_prediction_count: number;
  downstream_connected_prediction_count: number;
  upstream_prediction_coverage: GraphCoverage;
  downstream_prediction_coverage: GraphCoverage;
  sub_basin_station_count: number;
  sub_basin_prediction_coverage: GraphCoverage;
  catchment_area_km2: number | null;
  normalized_log_catchment_area: number | null;
  seasonal_flag: boolean;
  metadata_confidence: string;
  own_prediction: PredictionSummary | null;
  upstream_station_predictions: PredictionSummary[];
  downstream_station_predictions: PredictionSummary[];
  sub_basin_predictions: PredictionSummary[];
  prediction_coverage: GraphCoverage;
}

interface RawMetadata {
  station_id: string;
  dataset_station_name: string;
  canonical_station_name: string | null;
  state: string | null;
  district: string | null;
  river: string | null;
  tributary: string | null;
  sub_basin: string | null;
  latitude: number | null;
  longitude: number | null;
  catchment_area_km2: number | null;
  station_type: string | null;
  seasonal_flag: boolean;
  cwc_site_code: string | null;
  source: string | null;
  source_reference: string | null;
  source_confidence: string;
  purpose: string | null;
}

interface GraphArtifact {
  graph_version: string;
  nodes: string[];
  edges: GraphEdge[];
}

const relationshipTypes = new Set<GraphRelationship>([
  'DIRECT_UPSTREAM',
  'DIRECT_DOWNSTREAM',
  'SAME_RIVER_SYSTEM',
  'SAME_SUB_BASIN',
  'TRIBUTARY_ASSOCIATION',
  'UNVERIFIED',
]);

function coverage(configured: number, predicted: number): GraphCoverage {
  return {
    configured,
    predicted,
    coverage: configured === 0 ? 0 : predicted / configured,
  };
}

export function validateHydrologyGraph(
  nodes: StationNode[],
  edges: GraphEdge[],
): { valid: true; graph_version: string } {
  if (nodes.length !== 15) throw new Error(`Hydrology graph must contain exactly 15 nodes; found ${nodes.length}.`);
  const nodeIds = nodes.map((node) => node.station_id);
  if (new Set(nodeIds).size !== nodeIds.length) throw new Error('Hydrology graph contains duplicate nodes.');
  const known = new Set(nodeIds);

  const edgeKeys = new Set<string>();
  for (const edge of edges) {
    if (!edge.edge_id.trim()) throw new Error('Graph edge is missing edge_id.');
    if (!relationshipTypes.has(edge.relationship_type)) {
      throw new Error(`Graph edge '${edge.edge_id}' has invalid relationship_type.`);
    }
    if (!edge.confidence?.trim()) throw new Error(`Graph edge '${edge.edge_id}' is missing confidence.`);
    if (!edge.source?.trim()) throw new Error(`Graph edge '${edge.edge_id}' is missing source.`);
    if (!edge.source_reference?.trim()) {
      throw new Error(`Graph edge '${edge.edge_id}' is missing source_reference.`);
    }

    const edgeStations = edge.station_ids?.length
      ? edge.station_ids
      : [edge.upstream_station_id, edge.downstream_station_id].filter(
          (value): value is string => Boolean(value),
        );
    if (edgeStations.length === 0) throw new Error(`Graph edge '${edge.edge_id}' has no stations.`);
    for (const stationId of edgeStations) {
      if (!known.has(stationId)) {
        throw new Error(`Graph edge '${edge.edge_id}' references unknown station '${stationId}'.`);
      }
    }
    if (edge.upstream_station_id === edge.downstream_station_id && edge.upstream_station_id) {
      throw new Error(`Graph edge '${edge.edge_id}' is a self-loop.`);
    }
    if (
      (edge.relationship_type === 'DIRECT_UPSTREAM'
        || edge.relationship_type === 'DIRECT_DOWNSTREAM')
      && (!edge.upstream_station_id || !edge.downstream_station_id)
    ) {
      throw new Error(`Direct graph edge '${edge.edge_id}' must identify upstream and downstream stations.`);
    }

    const sorted = [...edgeStations].sort();
    const key = `${edge.relationship_type}|${sorted.join('|')}`;
    if (edgeKeys.has(key)) throw new Error(`Hydrology graph contains duplicate edge '${edge.edge_id}'.`);
    edgeKeys.add(key);
  }
  return { valid: true, graph_version: '1.0' };
}

export function loadHydrologyGraph(): { nodes: StationNode[]; edges: GraphEdge[]; graphVersion: string } {
  const dataRoot = path.resolve(process.cwd(), 'src', 'data');
  const metadata = JSON.parse(
    fs.readFileSync(path.join(dataRoot, 'station-metadata.json'), 'utf8'),
  ) as RawMetadata[];
  const artifact = JSON.parse(
    fs.readFileSync(path.join(dataRoot, 'hydrology-graph.json'), 'utf8'),
  ) as GraphArtifact;

  const nodes: StationNode[] = metadata.map((station) => ({
    station_id: station.station_id,
    canonical_station_name: station.canonical_station_name,
    state: station.state,
    district: station.district,
    river: station.river,
    tributary: station.tributary,
    sub_basin: station.sub_basin,
    latitude: station.latitude,
    longitude: station.longitude,
    catchment_area_km2: station.catchment_area_km2,
    station_type: station.station_type,
    seasonal_flag: Boolean(station.seasonal_flag),
    metadata_confidence: station.source_confidence,
    source: station.source,
    source_reference: station.source_reference,
    purpose: station.purpose,
  }));

  if (artifact.nodes.length !== 15) {
    throw new Error(`Hydrology graph artifact must list exactly 15 nodes; found ${artifact.nodes.length}.`);
  }
  if (artifact.nodes.length !== new Set(artifact.nodes).size) {
    throw new Error('Hydrology graph artifact contains duplicate node IDs.');
  }
  const artifactNodeSet = new Set(artifact.nodes);
  const metadataNodeSet = new Set(nodes.map((node) => node.station_id));
  if (
    artifactNodeSet.size !== metadataNodeSet.size
    || [...artifactNodeSet].some((stationId) => !metadataNodeSet.has(stationId))
  ) {
    throw new Error('Hydrology graph nodes do not match station metadata.');
  }

  validateHydrologyGraph(nodes, artifact.edges);
  return { nodes, edges: artifact.edges, graphVersion: artifact.graph_version };
}

function dateText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value).slice(0, 10);
}

export async function getHydrologyNetworkContext(featureDate?: string): Promise<{
  graph_version: string;
  feature_date: string;
  target_date: string | null;
  station_count: number;
  predicted_station_count: number;
  station_coverage: GraphCoverage;
  nodes: StationNode[];
  edges: GraphEdge[];
  sub_basin_groups: Array<{
    sub_basin: string;
    station_ids: string[];
    prediction_coverage: GraphCoverage;
    predictions: PredictionSummary[];
  }>;
  station_context: StationNetworkContext[];
}> {
  const graph = loadHydrologyGraph();
  let dateFilter = '';
  const values: string[] = [];
  if (featureDate) {
    dateFilter = 'WHERE sp.feature_date = ?';
    values.push(featureDate);
  } else {
    dateFilter = 'WHERE sp.feature_date = (SELECT MAX(feature_date) FROM station_predictions)';
  }

  const [predictionRows] = await pool.execute(
    `SELECT sp.station_id, sm.canonical_station_name, sp.feature_date, sp.target_date,
      sp.predicted_class, sp.probability_low, sp.probability_moderate, sp.probability_high,
      sp.confidence, sp.prediction_status, sp.data_coverage, sp.status_reason
     FROM station_predictions sp
     LEFT JOIN station_metadata sm ON sm.station_id = sp.station_id
     ${dateFilter}
     ORDER BY sp.station_id ASC`,
    values,
  );

  const rows = predictionRows as Array<Record<string, unknown>>;
  const predictionByStation = new Map<string, PredictionSummary>();
  let resolvedFeatureDate = featureDate ?? '';
  let resolvedTargetDate: string | null = null;
  for (const row of rows) {
    const stationId = String(row.station_id);
    const rowFeatureDate = dateText(row.feature_date);
    if (rowFeatureDate) resolvedFeatureDate = rowFeatureDate;
    if (resolvedTargetDate === null) resolvedTargetDate = dateText(row.target_date);
    predictionByStation.set(stationId, {
      station_id: stationId,
      canonical_station_name:
        typeof row.canonical_station_name === 'string' ? row.canonical_station_name : null,
      predicted_class:
        row.predicted_class === 'LOW' || row.predicted_class === 'MODERATE'
          || row.predicted_class === 'HIGH'
          ? row.predicted_class
          : null,
      probability_low: typeof row.probability_low === 'number' ? row.probability_low : null,
      probability_moderate:
        typeof row.probability_moderate === 'number' ? row.probability_moderate : null,
      probability_high: typeof row.probability_high === 'number' ? row.probability_high : null,
      confidence: typeof row.confidence === 'number' ? row.confidence : null,
      prediction_status: String(row.prediction_status),
      feature_date: rowFeatureDate ?? '',
      target_date: dateText(row.target_date),
      data_coverage: String(row.data_coverage),
      status_reason: typeof row.status_reason === 'string' ? row.status_reason : null,
      available: row.prediction_status === 'PREDICTED',
    });
  }

  if (!resolvedFeatureDate) {
    const [latestRows] = await pool.execute(
      'SELECT MAX(feature_date) AS feature_date FROM station_predictions',
    );
    resolvedFeatureDate =
      dateText((latestRows as Array<{ feature_date: unknown }>)[0]?.feature_date) ?? '';
  }

  const stationContext: StationNetworkContext[] = graph.nodes.map((node) => {
    const upstreamIds: string[] = [];
    const downstreamIds: string[] = [];
    for (const edge of graph.edges) {
      if (
        edge.relationship_type === 'DIRECT_UPSTREAM'
        && edge.downstream_station_id === node.station_id
        && edge.upstream_station_id
      ) upstreamIds.push(edge.upstream_station_id);
      if (
        edge.relationship_type === 'DIRECT_UPSTREAM'
        && edge.upstream_station_id === node.station_id
        && edge.downstream_station_id
      ) downstreamIds.push(edge.downstream_station_id);
      if (
        edge.relationship_type === 'DIRECT_DOWNSTREAM'
        && edge.upstream_station_id === node.station_id
        && edge.downstream_station_id
      ) downstreamIds.push(edge.downstream_station_id);
      if (
        edge.relationship_type === 'DIRECT_DOWNSTREAM'
        && edge.downstream_station_id === node.station_id
        && edge.upstream_station_id
      ) upstreamIds.push(edge.upstream_station_id);
    }

    const connectedIds = new Set<string>();
    for (const edge of graph.edges) {
      const ids = edge.station_ids?.length
        ? edge.station_ids
        : [edge.upstream_station_id, edge.downstream_station_id].filter(
            (value): value is string => Boolean(value),
          );
      if (ids.includes(node.station_id)) {
        for (const id of ids) if (id !== node.station_id) connectedIds.add(id);
      }
    }

    const upstreamPredictions = upstreamIds
      .map((id) => predictionByStation.get(id))
      .filter((value): value is PredictionSummary => Boolean(value));
    const downstreamPredictions = downstreamIds
      .map((id) => predictionByStation.get(id))
      .filter((value): value is PredictionSummary => Boolean(value));
    const subBasinMembers = graph.nodes.filter((candidate) =>
      Boolean(node.sub_basin)
      && candidate.sub_basin === node.sub_basin,
    );
    const subBasinPredictions = subBasinMembers
      .map((candidate) => predictionByStation.get(candidate.station_id))
      .filter((value): value is PredictionSummary => Boolean(value));
    const ownPrediction = predictionByStation.get(node.station_id) ?? null;

    const availableLogCatchments = graph.nodes
      .map((candidate) => candidate.catchment_area_km2)
      .filter((value): value is number => typeof value === 'number' && value > 0)
      .map((value) => Math.log(value));
    const maximumLogCatchment = availableLogCatchments.length
      ? Math.max(...availableLogCatchments)
      : null;
    const normalizedLogCatchment =
      node.catchment_area_km2 && node.catchment_area_km2 > 0 && maximumLogCatchment
        ? Math.log(node.catchment_area_km2) / maximumLogCatchment
        : null;

    return {
      node,
      upstream_station_count: upstreamIds.length,
      downstream_station_count: downstreamIds.length,
      direct_upstream_station_ids: [...new Set(upstreamIds)].sort(),
      direct_downstream_station_ids: [...new Set(downstreamIds)].sort(),
      connected_station_count: connectedIds.size,
      graph_degree: connectedIds.size,
      upstream_connected_prediction_count: upstreamPredictions.filter((item) => item.available).length,
      downstream_connected_prediction_count:
        downstreamPredictions.filter((item) => item.available).length,
      upstream_prediction_coverage:
        coverage(upstreamIds.length, upstreamPredictions.filter((item) => item.available).length),
      downstream_prediction_coverage:
        coverage(downstreamIds.length, downstreamPredictions.filter((item) => item.available).length),
      sub_basin_station_count: subBasinMembers.length,
      sub_basin_prediction_coverage:
        coverage(
          subBasinMembers.length,
          subBasinPredictions.filter((item) => item.available).length,
        ),
      catchment_area_km2: node.catchment_area_km2,
      normalized_log_catchment_area: normalizedLogCatchment,
      seasonal_flag: node.seasonal_flag,
      metadata_confidence: node.metadata_confidence,
      own_prediction: ownPrediction,
      upstream_station_predictions: upstreamPredictions,
      downstream_station_predictions: downstreamPredictions,
      sub_basin_predictions: subBasinPredictions,
      prediction_coverage: coverage(
        graph.nodes.length,
        [...predictionByStation.values()].filter((item) => item.available).length,
      ),
    };
  });

  const subBasinMap = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (!node.sub_basin) continue;
    subBasinMap.set(
      node.sub_basin,
      [...(subBasinMap.get(node.sub_basin) ?? []), node.station_id],
    );
  }
  const subBasinGroups = [...subBasinMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([subBasin, stationIds]) => {
      const predictions = stationIds
        .map((stationId) => predictionByStation.get(stationId))
        .filter((value): value is PredictionSummary => Boolean(value));
      return {
        sub_basin: subBasin,
        station_ids: stationIds,
        prediction_coverage: coverage(
          stationIds.length,
          predictions.filter((item) => item.available).length,
        ),
        predictions,
      };
    });

  const predictedCount = [...predictionByStation.values()]
    .filter((item) => item.available).length;
  return {
    graph_version: graph.graphVersion,
    feature_date: resolvedFeatureDate,
    target_date: resolvedTargetDate,
    station_count: graph.nodes.length,
    predicted_station_count: predictedCount,
    station_coverage: coverage(graph.nodes.length, predictedCount),
    nodes: graph.nodes,
    edges: graph.edges,
    sub_basin_groups: subBasinGroups,
    station_context: stationContext,
  };
}
