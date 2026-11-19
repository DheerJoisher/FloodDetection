'use client';

import 'leaflet/dist/leaflet.css';

import { useEffect, useState } from 'react';
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';

export interface MapStation {
  station_id: string;
  station_name: string | null;
  canonical_station_name?: string | null;
  state: string | null;
  district: string | null;
  river: string | null;
  tributary: string | null;
  sub_basin: string | null;
  latitude: number | null;
  longitude: number | null;
  predicted_class: 'LOW' | 'MODERATE' | 'HIGH' | null;
  probability_low: number | null;
  probability_moderate: number | null;
  probability_high: number | null;
  confidence: number | null;
  feature_date: string | null;
  target_date: string | null;
  prediction_status: string;
}

interface GodavariRiskMapProps {
  stations: MapStation[];
  affectedStates: string[];
  affectedDistricts: string[];
  alertSeverity: string | null;
  alertTitle: string | null;
  onSelectStation: (station: MapStation) => void;
}

const markerColors: Record<string, string> = {
  LOW: '#18794e',
  MODERATE: '#a56a00',
  HIGH: '#b42318',
  UNKNOWN: '#64748b',
};

function markerColor(station: MapStation): string {
  if (station.prediction_status !== 'PREDICTED') return markerColors.UNKNOWN;
  return station.predicted_class ? markerColors[station.predicted_class] : markerColors.UNKNOWN;
}

function MapExtent({ stations }: { stations: MapStation[] }) {
  const map = useMap();
  useEffect(() => {
    const coordinates = stations
      .filter((station) =>
        typeof station.latitude === 'number'
        && typeof station.longitude === 'number',
      )
      .map((station) =>
        L.latLng(station.latitude as number, station.longitude as number),
      );
    if (coordinates.length > 0) {
      map.fitBounds(L.latLngBounds(coordinates), { padding: [30, 30], maxZoom: 7 });
    }
  }, [map, stations]);
  return null;
}

function percentage(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

export default function GodavariRiskMap(props: GodavariRiskMapProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const plotStations = props.stations.filter((station) =>
    typeof station.latitude === 'number'
    && typeof station.longitude === 'number',
  );

  return (
    <div className="gis-map-wrap">
      <MapContainer
        center={[18.7, 79.8]}
        zoom={6}
        minZoom={5}
        maxZoom={12}
        scrollWheelZoom
        className="gis-map"
        aria-label="Godavari monitoring station map"
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapExtent stations={plotStations} />
        {plotStations.map((station) => {
          const level = station.prediction_status === 'PREDICTED'
            ? station.predicted_class ?? 'UNKNOWN'
            : 'UNKNOWN';
          return (
            <CircleMarker
              key={station.station_id}
              center={[station.latitude as number, station.longitude as number]}
              radius={selected === station.station_id ? 11 : 8}
              pathOptions={{
                color: '#ffffff',
                weight: 2,
                fillColor: markerColor(station),
                fillOpacity: 0.95,
              }}
              eventHandlers={{
                click: () => {
                  setSelected(station.station_id);
                  props.onSelectStation(station);
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={1}>
                {station.canonical_station_name || station.station_name} — {level}
              </Tooltip>
              <Popup>
                <div className="map-popup">
                  <strong>{station.canonical_station_name || station.station_name}</strong>
                  <span>{station.station_id}</span>
                  <span>{station.state ?? 'State unavailable'} · {station.district ?? 'District unavailable'}</span>
                  <span>{station.tributary ? `Godavari / ${station.tributary}` : 'River system unavailable'}</span>
                  <b>Risk: {level === 'UNKNOWN' ? 'INSUFFICIENT / UNKNOWN' : level}</b>
                  <span>Prediction status: {station.prediction_status.replace(/_/g, ' ')}</span>
                  {station.prediction_status === 'PREDICTED' && (
                    <>
                      <span>LOW {percentage(station.probability_low)}</span>
                      <span>MODERATE {percentage(station.probability_moderate)}</span>
                      <span>HIGH {percentage(station.probability_high)}</span>
                      <span>Model confidence {percentage(station.confidence)}</span>
                    </>
                  )}
                  <span>Feature date {station.feature_date ?? '—'}</span>
                  <span>T+1 target {station.target_date ?? '—'}</span>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <div className="map-overlay-panel">
        <div className="map-legend" aria-label="Station risk legend">
          {['LOW', 'MODERATE', 'HIGH', 'UNKNOWN'].map((level) => (
            <span key={level}>
              <i style={{ background: markerColors[level] }} />
              {level === 'UNKNOWN' ? 'INSUFFICIENT / UNKNOWN' : level}
            </span>
          ))}
        </div>
        {props.alertSeverity && (
          <div className="map-alert-note">
            <strong>PROJECT EARLY WARNING · {props.alertSeverity}</strong>
            {props.alertTitle}
          </div>
        )}
        {props.affectedStates.length > 0 && (
          <p className="map-region-note">
            Potentially affected: {props.affectedStates.join(', ')}
            {props.affectedDistricts.length > 0
              ? ` · Districts: ${props.affectedDistricts.join(', ')}`
              : ''}
          </p>
        )}
        <p className="map-coverage-note">
          Station points only. No inferred hydrological linework or administrative boundaries are shown because verified geometry is unavailable.
        </p>
      </div>
    </div>
  );
}
