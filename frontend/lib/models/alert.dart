class FloodAlert {
  const FloodAlert({
    required this.id,
    required this.title,
    required this.message,
    required this.riskLevel,
    required this.stationName,
    required this.createdAt,
  });

  final int id;
  final String title;
  final String message;
  final String riskLevel;
  final String? stationName;
  final String? createdAt;

  factory FloodAlert.fromJson(Map<String, dynamic> json) {
    return FloodAlert(
      id: _asInt(json['id']),
      title: json['title'] as String? ?? '',
      message: json['message'] as String? ?? '',
      riskLevel: json['risk_level'] as String? ?? 'LOW',
      stationName: json['station_name'] as String?,
      createdAt: json['created_at']?.toString(),
    );
  }

  static int _asInt(Object? value) {
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }
}
