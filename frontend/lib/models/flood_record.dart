class FloodRecord {
  const FloodRecord({
    required this.id,
    required this.date,
    required this.stationId,
    required this.stationName,
    required this.waterlevel,
    required this.discharge,
    required this.rainfall,
    required this.riskLevel,
  });

  final int id;
  final String date;
  final String stationId;
  final String? stationName;
  final double? waterlevel;
  final double? discharge;
  final double? rainfall;
  final String riskLevel;

  factory FloodRecord.fromJson(Map<String, dynamic> json) {
    return FloodRecord(
      id: _asInt(json['id']),
      date: json['date']?.toString() ?? '',
      stationId: json['station_id']?.toString() ?? '',
      stationName: json['station_name'] as String?,
      waterlevel: _asDouble(json['waterlevel']),
      discharge: _asDouble(json['discharge']),
      rainfall: _asDouble(json['rain']),
      riskLevel: json['risk_level'] as String? ?? 'LOW',
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
