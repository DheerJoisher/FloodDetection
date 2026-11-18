class DashboardStats {
  const DashboardStats({
    required this.totalRecords,
    required this.stationCount,
    required this.latestDate,
    required this.latestWaterlevel,
    required this.latestDischarge,
    required this.latestRainfall,
    required this.latestRiskLevel,
  });

  final int totalRecords;
  final int stationCount;
  final String? latestDate;
  final double? latestWaterlevel;
  final double? latestDischarge;
  final double? latestRainfall;
  final String? latestRiskLevel;

  factory DashboardStats.fromJson(Map<String, dynamic> json) {
    return DashboardStats(
      totalRecords: _asInt(json['total_records']),
      stationCount: _asInt(json['station_count']),
      latestDate: json['latest_date'] as String?,
      latestWaterlevel: _asDouble(json['latest_waterlevel']),
      latestDischarge: _asDouble(json['latest_discharge']),
      latestRainfall: _asDouble(json['latest_rainfall']),
      latestRiskLevel: json['latest_risk_level'] as String?,
    );
  }

  static int _asInt(Object? value) {
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

  static double? _asDouble(Object? value) {
    if (value is num) return value.toDouble();
    return double.tryParse(value?.toString() ?? '');
  }
}
