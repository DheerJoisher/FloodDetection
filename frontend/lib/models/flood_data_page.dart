import 'flood_record.dart';

class FloodDataPage {
  const FloodDataPage({
    required this.records,
    required this.total,
    required this.page,
    required this.totalPages,
  });

  final List<FloodRecord> records;
  final int total;
  final int page;
  final int totalPages;

  factory FloodDataPage.fromJson(Map<String, dynamic> json) {
    final data = json['data'] as List<dynamic>? ?? const [];
    final pagination = json['pagination'] as Map<String, dynamic>? ?? const {};
    return FloodDataPage(
      records: data
          .whereType<Map<String, dynamic>>()
          .map(FloodRecord.fromJson)
          .toList(),
      total: _asInt(pagination['total']),
      page: _asInt(pagination['page']),
      totalPages: _asInt(pagination['total_pages']),
    );
  }

  static int _asInt(Object? value) {
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }
}
