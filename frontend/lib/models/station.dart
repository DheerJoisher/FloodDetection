class Station {
  const Station({required this.id, required this.name});

  final String id;
  final String? name;

  factory Station.fromJson(Map<String, dynamic> json) {
    return Station(
      id: json['station_id']?.toString() ?? '',
      name: json['station_name'] as String?,
    );
  }

  String get label => name == null || name!.isEmpty ? id : '$name ($id)';
}
