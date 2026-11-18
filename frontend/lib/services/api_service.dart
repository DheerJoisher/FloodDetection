import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/alert.dart';
import '../models/auth_user.dart';
import '../models/dashboard_stats.dart';
import '../models/flood_data_page.dart';
import '../models/flood_record.dart';
import '../models/station.dart';

const String apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:5000/api',
);

class ApiException implements Exception {
  const ApiException(this.message);

  final String message;

  @override
  String toString() => message;
}

class ApiService {
  ApiService({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;
  String? _token;

  Future<AuthUser> login(String email, String password) async {
    final response = await _request(
      'POST',
      '/auth/login',
      body: {'email': email.trim(), 'password': password},
    );
    final token = response['token'] as String?;
    final userData = response['user'];
    if (token == null || userData is! Map<String, dynamic>) {
      throw const ApiException(
        'The API returned an incomplete login response.',
      );
    }

    _token = token;
    return AuthUser.fromJson(userData);
  }

  Future<DashboardStats> getDashboardStats() async {
    return DashboardStats.fromJson(await _request('GET', '/dashboard/stats'));
  }

  Future<FloodDataPage> getFloodData({
    String? stationId,
    String? startDate,
    String? endDate,
    int page = 1,
    int limit = 20,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'limit': '$limit',
    };
    if (stationId != null && stationId.isNotEmpty) {
      query['station_id'] = stationId;
    }
    if (startDate != null) {
      query['start_date'] = startDate;
    }
    if (endDate != null) {
      query['end_date'] = endDate;
    }
    return FloodDataPage.fromJson(
      await _request('GET', '/flood-data', query: query),
    );
  }

  Future<FloodRecord> getLatestFloodData() async {
    return FloodRecord.fromJson(await _request('GET', '/flood-data/latest'));
  }

  Future<List<Station>> getStations() async {
    final response = await _request('GET', '/stations');
    final rows = response['data'] as List<dynamic>? ?? const [];
    return rows
        .whereType<Map<String, dynamic>>()
        .map(Station.fromJson)
        .toList();
  }

  Future<List<FloodAlert>> getAlerts() async {
    final response = await _request('GET', '/alerts');
    final rows = response['data'] as List<dynamic>? ?? const [];
    return rows
        .whereType<Map<String, dynamic>>()
        .map(FloodAlert.fromJson)
        .toList();
  }

  Future<FloodAlert> createAlert({
    required String title,
    required String message,
    required String riskLevel,
    String? stationName,
  }) async {
    return FloodAlert.fromJson(
      await _request(
        'POST',
        '/alerts',
        authenticated: true,
        body: {
          'title': title,
          'message': message,
          'risk_level': riskLevel,
          'station_name': stationName,
        },
      ),
    );
  }

  Future<void> deleteAlert(int id) async {
    await _request('DELETE', '/alerts/$id', authenticated: true);
  }

  void logout() {
    _token = null;
  }

  void dispose() {
    _client.close();
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, Object?>? body,
    bool authenticated = false,
  }) async {
    final uri = Uri.parse(
      '$apiBaseUrl$path',
    ).replace(queryParameters: query == null || query.isEmpty ? null : query);
    final headers = <String, String>{'Accept': 'application/json'};
    if (body != null) {
      headers['Content-Type'] = 'application/json';
    }
    if (authenticated) {
      final token = _token;
      if (token == null) {
        throw const ApiException('Please sign in again to continue.');
      }
      headers['Authorization'] = 'Bearer $token';
    }

    try {
      final request = http.Request(method, uri)..headers.addAll(headers);
      if (body != null) {
        request.body = jsonEncode(body);
      }
      final streamed =
          await _client.send(request).timeout(const Duration(seconds: 20));
      final response = await http.Response.fromStream(streamed);
      final decoded = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final message = decoded is Map<String, dynamic>
            ? decoded['message'] as String? ??
                'The request could not be completed.'
            : 'The request could not be completed.';
        throw ApiException(message);
      }
      if (decoded is! Map<String, dynamic>) {
        throw const ApiException('The API returned an unexpected response.');
      }
      return decoded;
    } on TimeoutException {
      throw const ApiException('The API request timed out. Please try again.');
    } on http.ClientException {
      throw const ApiException(
        'Could not reach the backend. Check that it is running at the configured API URL.',
      );
    } on FormatException {
      throw const ApiException('The API returned an invalid response.');
    }
  }
}
