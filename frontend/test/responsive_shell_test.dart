import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/models/auth_user.dart';
import 'package:frontend/screens/main_shell.dart';
import 'package:frontend/services/api_service.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  testWidgets('wide navigation and dashboard fit laptop browser widths', (
    tester,
  ) async {
    final api = ApiService(
      client: MockClient((request) async {
        final Object response = switch (request.url.path) {
          '/api/dashboard/stats' => {
              'total_records': 34110,
              'station_count': 15,
              'latest_date': '2026-02-20',
              'latest_waterlevel': 546.37,
              'latest_discharge': 38.88,
              'latest_rainfall': 0,
              'latest_risk_level': 'LOW',
            },
          '/api/stations' => {'data': <Object>[]},
          '/api/flood-data' => {
              'data': <Object>[],
              'pagination': {'total': 0, 'page': 1, 'total_pages': 0},
            },
          '/api/alerts' => {'data': <Object>[]},
          _ => <String, Object>{'message': 'Unexpected test request.'},
        };
        return http.Response(
          jsonEncode(response),
          200,
          headers: {'content-type': 'application/json'},
        );
      }),
    );
    addTearDown(api.dispose);
    addTearDown(() => tester.binding.setSurfaceSize(null));

    for (final width in [
      360.0,
      480.0,
      600.0,
      800.0,
      900.0,
      1024.0,
      1280.0,
      1366.0,
      1440.0,
      1600.0,
      1920.0,
    ]) {
      await tester.binding.setSurfaceSize(Size(width, 800));
      await tester.pumpWidget(
        MaterialApp(
          home: MainShell(
            api: api,
            user: const AuthUser(
              id: 'development-session',
              name: 'Development session',
              email: '',
              role: 'development',
            ),
            onLogout: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull, reason: 'Width: $width');
    }
  });
}
